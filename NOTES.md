# Reels Studio — Notes

Live working doc for ongoing discussions and decisions.
Updated: 2026-05-09

---

## Topic 1: Multi-asset por bloco (carrossel sequencial)

### What you want

Quando você anexa **mais de um asset** ao mesmo bloco (ex: 3 screenshots),
eles devem aparecer em **sequência fluida dentro do bloco**, não todos ao
mesmo tempo. Tipo carrossel automático:

```
Bloco de 6s, com [foto1.png, foto2.png, foto3.png] anexadas:
  0–2s: foto1 entra (scale + fade), idle, sai
  2–4s: foto2 entra, idle, sai
  4–6s: foto3 entra, idle, sai
```

### Apple-coerent design

A Apple não trataria isso como "carrossel" técnico. Tratariam como
**"asset playlist"** — o bloco tem uma sequência ordenada de visuais, e o
motion ENGINE distribui o tempo entre eles automaticamente, com transição
suave entre slides.

Princípios:
1. **Ordem visível** — cada asset tem um número (1, 2, 3) na UI, drag pra reordenar
2. **Distribuição automática** — duração de cada slide = block_duration / N
3. **Transição padrão** — fade + 4% scale (subtle, não swoosh)
4. **Override por slide** — usuário pode editar duração individual depois

### State shape (decisão)

Mudar `attachedAsset?: AttachedAsset` para:

```ts
attachedAssets?: AttachedAsset[]  // ordered list
```

Backwards-compat: ler `attachedAsset` legado e converter pra array de 1
elemento na hidração.

### UI

No `AssetPickerModal`, o usuário pode:
- Selecionar múltiplos (clique = adiciona à lista, clique de novo = remove)
- Lista visível mostra ordem com badges 1/2/3
- Drag-to-reorder

No card do bloco, badge no chip Asset:
- 1 asset: `📎 foto.png`
- N assets: `📎 3 slides`

### Prompt change

Quando há multi-asset, o prompt do Gemini ganha:
- Lista numerada de slides com timing pré-distribuído
- Instrução: "renderiza cada slide como uma cena com clip-shell, only
  one visible at a time, fade transitions between"

---

## Topic 2: UX do card (Apple senior)

### The problem

Hoje o header do card tem **6+ botões em linha**:
`[👤 Avatar/B-roll] [🎨 Motion ✓] [⚙️] [📎 Asset] [🎨 Bold pop ▼] [↑↓✕]`

Em blocos compactos vira ruído visual. Apple não faria isso.

### Apple senior treatment

Princípio: **only show what matters AT THIS STATE**. A maioria dos botões
só importa quando você está **trabalhando naquele bloco**.

**Solution: collapse non-essential controls into a single "⋯" menu**

Estado **idle** (bloco não selecionado):
```
┌──────────────────────────────────────┐
│ 👤 Avatar       2.4s         ⋯       │
│ "Olha só o que rolou no Canva..."    │
└──────────────────────────────────────┘
```
Apenas: kind toggle (clicável pra alternar), duração, menu `⋯`.

Estado **active** (bloco selecionado, expanded):
```
┌──────────────────────────────────────┐
│ 👤 Avatar  ·  🎨 Motion ✓  ·  ⋯      │
│ "Olha só o que rolou no Canva..."    │
│ [textarea]                            │
│ ─────────────────────────             │
│ Layout · Asset · Estilo · Visibilidade│
└──────────────────────────────────────┘
```
Header com 2 ações principais (kind + motion). Outras ações em
**inspector horizontal** abaixo do textarea, segmented-control-style.

**Menu `⋯` (sempre visível, mas discreto):**
- Mover acima ↑
- Mover abaixo ↓
- Pular pra este bloco
- Duplicar bloco (não temos hoje, vale a pena)
- Remover bloco

### Visual hierarchy

- **Primary action** (Motion) ganha cor + tamanho
- **Secondary** (Asset, Estilo, Layout) são chips menores na linha de inspector
- **Tertiary** (mover, duplicar, remover) somem no `⋯`

### O que muda na prática

- 6 botões → 2 botões + 1 menu (idle), e 4 chips inspector (active)
- Hover/focus deixa de ser necessário pra ver tudo
- Card respira mais

---

## Pending decisions

| # | Topic | Status | Note |
|---|---|---|---|
| 1 | Multi-asset carrossel sequencial | ✅ **shipped** (não testado em runtime ainda) | |
| 2 | UX redesign do card | ✅ **shipped** (não testado em runtime ainda) | Header reduzido pra 3 elementos · `⋯` menu · Inspector strip |
| 3 | Asset não anexado vazando pro Gemini | parked | Resolvido como side effect do #1 (não passar projectAssets quando block já tem attachedAssets) |
| 4 | Câmera virtual (Onda B do Hyperframes) | ✅ **shipped** | Técnica N adicionada ao GSAP_TECHNIQUES com 5 padrões (dolly-in/out, pan, drift, dolly-into-a-point) |

---

## Plano detalhado — Multi-asset (Topic 1)

### 1. State migration (types.ts + reducer.ts + persistence)

**Schema atual:**
```ts
ScriptBlock.attachedAsset?: AttachedAsset
```

**Schema novo:**
```ts
ScriptBlock.attachedAssets?: AttachedAsset[]  // ordered list, undefined = no assets
```

**Backwards-compat na hidratação:** quando carregar bloco antigo do
IndexedDB com `attachedAsset` (single), converter pra
`attachedAssets: [legacy]` durante hidratação. Depois disso, save sempre
emite `attachedAssets`.

**Reducer actions (atualmente uma só, viram quatro):**
| Atual | Novo |
|---|---|
| `set-block-asset { id, asset?: AttachedAsset }` | `set-block-assets { id, assets?: AttachedAsset[] }` (substitui lista inteira) |
| | `add-block-asset { id, asset: AttachedAsset }` (append) |
| | `remove-block-asset { id, index: number }` (remove por índice) |
| | `reorder-block-assets { id, fromIndex, toIndex }` (drag reorder) |

Layout derivation continua igual: avatar + qualquer asset → `media-top`,
broll + qualquer asset → `media-only`. Lista vazia ou undefined → sem
override de layout.

### 2. AssetPickerModal — multi-select + reorder

Mudança de UX:
- Click numa thumb da pasta → **adiciona** ao bloco (não substitui)
- Thumbs já anexadas mostram badge `1`, `2`, `3` (ordem na lista)
- Painel separado embaixo: **"Anexados ao bloco"** com:
  - Lista horizontal com thumbs + número + botão `×` pra remover
  - Drag-and-drop pra reordenar
- Botão `Salvar e fechar` confirma a lista nova

Comportamento Apple-coerente:
- Click numa thumb anexada → **remove** (toggle)
- Click numa não-anexada → **anexa no fim**
- Vazio = motion sem asset (volta ao default)

### 3. Chip do card

| Estado | Label |
|---|---|
| 0 assets | `📎 Asset` (cinza, default) |
| 1 asset | `📎 foto.png` (violeta sólido — igual hoje) |
| 2-9 assets | `📎 3 slides` (violeta sólido) |
| 10+ assets | `📎 12 slides` (violeta sólido + warning amber) |

### 4. Motion generation (handleAutoMotion + motionService)

**No call site (`handleAutoMotion`):**
- Loop sobre `block.attachedAssets`, chama `copy_asset_to_motion` pra cada
- Constrói `pinnedAssets: PinnedAsset[]` com `relativeUrl` por item
- Passa pro `generateMotionHtml`

**No prompt (`motionService.ts`):**
- `pinnedAsset?: PinnedAsset` vira `pinnedAssets?: PinnedAsset[]`
- Quando lista tem 1 → comportamento atual (asset protagonista único)
- Quando lista tem N>1 → seção PINNED CAROUSEL:
  - Cada slide tem clip-shell próprio com `data-start` / `data-duration` calculados
  - Slot 0 = 0 → durSec/N
  - Slot 1 = durSec/N → 2·durSec/N
  - ...
  - Transição padrão: fade out 200ms antes do fim do slot, fade in do próximo
  - Headline + decorative elements compartilham track 9 (over all slides)
  - Cada slide ocupa o "centro do slot" (split-top ou replace conforme kind)

### 5. Stale detection (assetSnapshot)

**Schema atual:**
```ts
motion.assetSnapshot?: { path: string; name: string }
```

**Schema novo:**
```ts
motion.assetSnapshots?: Array<{ path: string; name: string }>
```

**Comparação de stale:**
- length diferente → stale
- qualquer path diferente em qualquer índice → stale
- Mantém os 3 estados visuais (asset-added, asset-removed, asset-changed)

### 6. Files modificados (resumo)

| File | Mudanças |
|---|---|
| [src/components/reelsStudio/types.ts](src/components/reelsStudio/types.ts) | `attachedAsset` → `attachedAssets[]`. 4 actions novas. `assetSnapshots[]`. |
| [src/components/reelsStudio/reducer.ts](src/components/reelsStudio/reducer.ts) | 4 handlers novos. Layout derivation por presença de array. `toggle-block-kind` lê `.length`. |
| [src/components/reelsStudio/persistence.ts](src/components/reelsStudio/persistence.ts) | Hidratação migra legacy `attachedAsset` → `[asset]`. |
| [src/components/reelsStudio/AssetPickerModal.tsx](src/components/reelsStudio/AssetPickerModal.tsx) | Multi-select + lista anexados + reorder. |
| [src/components/reelsStudio/motionLibrary.ts](src/components/reelsStudio/motionLibrary.ts) | `assetSnapshot` → `assetSnapshots`. |
| [src/components/ReelsStudio.tsx](src/components/ReelsStudio.tsx) | Card chip count. handleAutoMotion loop. Stale detection array. |
| [src/services/motionService.ts](src/services/motionService.ts) | `pinnedAsset` → `pinnedAssets[]`. Carousel section no prompt. |

**Nada no Rust.** `copy_asset_to_motion` continua single-shot, chamado N vezes.

### 7. Risks / regressões a watch

- Hidratação: blocos antigos no IndexedDB de usuários existentes têm
  `attachedAsset`. Migration na hidratação tem que ser **total** (todos
  os blocos) e silenciosa. Testar abrindo um projeto antigo.
- Stale detection: motion gerado com `assetSnapshot` (legacy) vs novo
  bloco com `attachedAssets[]`. Comparação tem que aceitar os dois.
- Export pipeline (CapCut/MP4): NÃO toca asset diretamente, só motion
  videos. Sem mudança esperada, mas verificar.
- Prompt size: lista grande de assets + carousel template pode estourar
  contexto. Cap em 6 assets por bloco (com warning amber no chip).

---

## Order of attack

Decisão: **Multi-asset primeiro**, depois **UX redesign**.

Razão: multi-asset é uma feature nova (vai mudar shape do state e prompt).
UX redesign é refactor visual — fazer depois evita refazer o layout duas
vezes (uma com 1 asset, outra com N).

---

## TODO — Karaokê sync (rebuild as native preset)

**Status:** preset `karaoke-captions` está **HIDDEN** em
`presetCategory.ts:HIDDEN_PRESET_IDS` desde 2026-05-18.

### Problema observado

Quando gerado via Gemini, o karaokê fica **fora de sincronia com o TTS**:
- Palavras erradas piscam ativas no momento errado
- Stagger uniforme substitui o timing real dos word timestamps
- Cada regeneração produz timing diferente (não-determinístico)

### Por que Gemini não consegue

O brief manda o Gemini ler `WORD TIMESTAMPS` injetadas no prompt e gerar
GSAP que dispara cada palavra em `wordStart` exato (transição idle →
active → spoken com 0.10/0.15/0.18s). Em teoria suficiente. Na prática:

- Gemini frequentemente interpreta como "stagger uniforme com base na
  duração total" em vez de cada palavra ter seu próprio cue
- A timeline GSAP gerada às vezes esquece palavras ou duplica IDs
- Como é texto puro (sem creatividade visual genuína), o LLM não tem
  margem pra "criar" — é puramente matemática + timing exato, exatamente
  o tipo de coisa que código determinístico faz melhor que LLM

### Solução: NATIVE preset (como `claude-ui`)

`claude-ui` já é um preset onde o HTML é gerado programaticamente em
`motionService.ts:_buildClaudeUiHtml`, bypassando Gemini. Replicar:

1. Adicionar `karaoke-captions` ao `NATIVE_PRESET_IDS` em
   `presetCategory.ts` (junto com `claude-ui`) E removê-lo de
   `HIDDEN_PRESET_IDS` (volta a aparecer no picker depois).
2. Implementar `_buildKaraokeHtml(input)` em `motionService.ts`:
   - Loop pelas `input.wordTimestamps`, gera um `<span class="clip"
     id="word-N">` por palavra com `data-start`/`data-duration`
     calculados de `wordStart`/`wordEnd - wordStart`.
   - Cada span ganha um animation timeline GSAP determinística (color
     interpolation, scale punch back.out(1.6), text-shadow bloom).
   - Estilo: `.font-display` weight 900, 120-180px, white default,
     accent color (brandPrimaryColor ou #ffd93c) na palavra ativa.
3. `generateMotionHtml` já tem o branch `if preset is native, bypass
   Gemini` — precisa só estender pra cobrir o novo native id.
4. Atualizar o `effectDetector.ts` rule 6 (atualmente desabilitada) pra
   voltar a sugerir karaoke-captions quando `block.kind === 'avatar'`,
   `audioWordCount > 0`, duration < 8s.

### Custo estimado

- ~120 LOC de função builder (semelhante a `_buildClaudeUiHtml`)
- ~10 LOC de wiring no `generateMotionHtml`
- ~3 LOC pra reativar a regra no detector
- 1 commit, ~30min reais

### Default temporário (enquanto karaokê hidden)

`effectDetector.ts` agora cai em **`bold-pop`** pra primeiro bloco
(hook) ou **`glass-tech`** pra demais blocos avatar quando nenhuma outra
regra bate. Karaokê seria a sugestão "premium" pra hooks com TTS, mas
até voltar nativo, bold-pop cobre o caso de "energia + foco em texto".

---

## Onda Hyperframes Catalog (shipped 2026-05-18)

Reels Studio passa a citar componentes do catálogo Hyperframes diretamente
nos prompts do Gemini, e o renderer Rust auto-instala os referenciados antes
do lint. Resultado: motions deixam de hand-rolar UIs/efeitos que o catálogo
já entrega pré-testados, on-brand e lint-aprovados.

### Como funciona

1. **Prompt (`motionService.ts`)** — SYSTEM_PROMPT ganhou:
   - `EASING & DURATION VOCABULARY` (tabela canônica do guia oficial)
   - `HYPERFRAMES CATALOG` (whitelist de 12 slugs com pattern de sub-comp)
   - `detectAppMention()` injeta `APP MENTION` quando bloco fala
     Instagram/TikTok/Spotify/YouTube/Reddit/X/macOS

2. **Briefs por preset (`motionStylePresets.ts`)** — cada Style preset (8)
   + 3 Effect presets (`phone-mockup`, `social-cta-follow`, `notification-pop`)
   ganhou seção `PREFERRED HYPERFRAMES COMPONENTS` com slugs específicos +
   easing/duration row recomendada.

3. **`illustrated-explainer` ganhou ILLUSTRATION VOCABULARY** — 6 archetypes
   (icon stack / diagram / process flow / comparison / marker chart /
   annotated UI), topic→archetype mapping, animated-connector rules, hard
   rule contra transcrever a fala. Esse é o preset principal pro perfil de
   apresentações ilustradas do usuário.

4. **`phone-mockup` agora prefere `vfx-iphone-device`** — iPhone GLTF 3D real
   com HTML live na tela em vez de CSS frame. Fallback CSS só quando sem asset.

5. **Render Rust (`src-tauri/src/motions.rs`)** — antes do lint:
   - `referenced_catalog_slugs(html)` parseia o HTML procurando
     `data-composition-src="(compositions/|components/)?<slug>.html"`
     contra a `HYPERFRAMES_WHITELIST` (mesma lista do TS).
   - Pra cada slug encontrado, roda `npx hyperframes@0.6.7 add <slug>` no
     motion dir. Erros não-fatais.
   - Lint depois pega referências quebradas (whitelist mismatch).

### Whitelist (19 slugs permitidos)

- Captions (4): caption-editorial-emphasis, caption-clip-wipe,
  caption-gradient-fill, caption-kinetic-slam
- Overlays (3): grain-overlay, vignette, shimmer-sweep
- Backgrounds WebGL (2): vfx-liquid-glass, vfx-liquid-background
- UI mockups (8): vfx-iphone-device, instagram-follow, tiktok-follow,
  x-post, spotify-card, yt-lower-third, macos-notification, reddit-post
- Transitions (2): transitions-dissolve, transitions-push

### Logs

`[motion/audit]` agora inclui `appMention=` e
`hyperframesCatalogInjected=true`. Pra debugar:
- DevTools console → buscar `[motion/audit]` → confirma detecção.
- Terminal stderr → `[motions] Installed catalog component: <slug>` por slug.

### Próximas ondas (relacionadas)

- **Lint feedback loop**: capturar erros do lint e mandar de volta pro Gemini
  como repair turn (1 retry automático).
- **Cache local do catálogo**: empacotar os 19 HTMLs em `public/hyperframes-catalog/`
  pra eliminar dependência de rede no `hyperframes add`.
- **Karaokê**: voltar a habilitar usando `caption-pill-karaoke` sub-comp em vez
  de native builder (cancelar o plano original).
