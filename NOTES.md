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

## Wave correction #2 — motion volta a ser ilustração (2026-05-18)

Cirurgia após segundo teste do usuário:

> "esta adicoinando como se fossem legenas / captios, e isso nao tinha
> antes... a ideia do motion é ilustrar tralvez aparece com uma palavra
> ou outro que ilustre, as captions posso colocar de forma separada"

> "Dai deixamos como padrao o glass tech como estava antes?"

Diagnóstico: minhas correções da onda Hyperframes (`ada6060`, `44e6661`)
introduziram **3 estruturas de captions no SYSTEM_PROMPT que não existiam
em `44e8e54`**:

1. Seção `CAPTIONS — TONE-DETECTED, NOT PRESET-LOCKED` (~30 linhas
   incluindo a tabela tom→tipografia + word grouping + position rules)
2. Bloco `CAPTION VARIETY` no STORYBOARD CONTINUITY
3. Linha "Captions: follow the TONE-DETECTED table" em 7 Style briefs

Gemini começou a gerar caption-bar sincronizada por palavra na parte
inferior de cada motion. A detecção automática de tom estava embutida
nessa tabela — sai junto.

Adicionalmente, `glass-tech` deixou de ser o default visual da app
quando minhas correções do "dois selecionados" (`96197e2`) trocaram
o `currentPresetId = stylePresetOverride ?? 'glass-tech'` por
`effectivePresetId`. O detector tinha rule 12 (primeiro bloco avatar
→ bold-pop) brigando com o default literal — bug visual real, mas o
fix tirou glass-tech do trono.

### Mudanças desta correção

- Removida seção CAPTIONS — TONE-DETECTED do SYSTEM_PROMPT
- Removido bloco CAPTION VARIETY do STORYBOARD CONTINUITY
- Removidas 7 linhas "Captions: follow" dos Style briefs (editorial-clean,
  bold-pop, glass-tech, soft-pastel, cinematic-dark, apple-system,
  warm-editorial)
- Redirect dentro do HYPERFRAMES CATALOG trocado: agora diz "DO NOT
  add caption tracks by default — text is part of the visual composition
  via PRINCIPLE 2 (1-5 words/shot, 120-280px, integrated)"
- Removida rule 12 do effectDetector (primeiro bloco avatar → bold-pop).
  Agora rule 12 é o que era rule 13 (avatar → glass-tech). Default
  histórico volta naturalmente.
- Restaurado o atalho de clicar no chip `glass-tech` → envia `undefined`
  (limpa override = "voltar pro padrão")

### Mantido intacto (80%+ da onda Hyperframes)

- UI mockups reais (vfx-iphone-device, instagram-follow, tiktok-follow,
  x-post, spotify-card, yt-lower-third, macos-notification, reddit-post)
- Overlays atmosféricos (grain-overlay, vignette, shimmer-sweep)
- Backgrounds WebGL (vfx-liquid-glass, vfx-liquid-background)
- Transitions (transitions-dissolve, transitions-push)
- detectAppMention() helper + APP MENTION userBrief section
- HYPERFRAMES_WHITELIST + Rust install loop antes do lint
- EASING & DURATION VOCABULARY table
- AI DESIGN TELLS section (lista oficial Hyperframes de defaults a evitar)
- ILLUSTRATION VOCABULARY em `illustrated-explainer` (6 archetypes)
- Sync `set-block-style-preset` após MotionPickerModal save

### Comportamento final

Avatar block sem override → `glass-tech` (como em `44e8e54`).
Texto no motion segue PRINCIPLE 2: 1-5 palavras, 120-280px, integrado
visualmente, NÃO faixa de subtitle no rodapé. Captions sincronizadas
viram opt-in via toggle no Inspector numa onda futura, se o usuário
pedir.

---

## Wave correction — captions tone-detected (2026-05-18)

Cirurgia em cima da onda Hyperframes (abaixo) após primeiro teste do
usuário: motions do primeiro bloco saíam parecendo karaokê toda vez.

Causa raiz: o brief de `bold-pop` (preset padrão pro primeiro bloco
avatar via `effectDetector` rule 12) recomendava
`caption-kinetic-slam` — que é literalmente "full-screen single word
alternating directions". Gemini estava cumprindo a recomendação ao pé
da letra.

Auditoria contra a doc oficial do Hyperframes
(github.com/heygen-com/hyperframes/tree/main/skills/hyperframes)
confirmou: captions devem ser **tom-detected**, não preset-locked.
A `references/captions.md` traz tabela canônica
Hype/Corporate/Tutorial/Storytelling/Social → font weight + animação
+ cor + size, tudo hand-rolled.

Correção em 2 commits cirúrgicos (sem revert dos 3 commits da onda):

1. **`ada6060` — prompt corretivo**: remove o sub-bloco CAPTIONS dos
   4 slugs no SYSTEM_PROMPT; adiciona seção `CAPTIONS —
   TONE-DETECTED` com a tabela oficial; adiciona seção
   `AI DESIGN TELLS` (lista de defaults preguiçosos a evitar);
   estende STORYBOARD CONTINUITY com regra CAPTION VARIETY
   (Block 0 emphasis / middle cycle by index modulo 4 / final
   understated).
2. **(este commit) — cirurgia nos briefs**: remove a linha
   `captions: caption-X` de 7 Style briefs (editorial-clean,
   bold-pop, glass-tech, soft-pastel, cinematic-dark, apple-system,
   warm-editorial). Substitui por: "Captions: follow the
   TONE-DETECTED table in the system prompt". `illustrated-explainer`
   continua proibindo captions (alinhado com seu archetype
   vocabulary). Effects que citam blocks de UI real
   (`phone-mockup → vfx-iphone-device`, `social-cta-follow →
   instagram-follow/etc.`, `notification-pop → macos-notification`)
   ficam intactos — usos alinhados com a doc oficial.

Resultado esperado: primeiro bloco para de defaultar pra karaokê;
captions saem variadas, hand-rolled, respeitando o tom detectado;
80% da onda Hyperframes original (overlays, backgrounds WebGL, UI
mockups reais, install loop, app detector, ILLUSTRATION VOCABULARY,
easing table) fica intacta.

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

---

## ⏸ Checkpoint — 2026-05-18 22:00 BRT — antes do revert ao SYSTEM_PROMPT enxuto

### Onde estamos

HEAD: `56cabc4` (fix pt-BR language override).

Última verificação visual do usuário: motion `split-bottom` + `glass-tech` saindo
**simplista** — globo cyan genérico ao centro com 3 linhas de texto "TRADUZIR
TUDO / PRA QUALQUER / IDIOMA". Apesar de várias correções terem acertado coisas
importantes (idioma, paleta, sem caption-bar), o motion ainda parece "ícone
barato".

### O que foi corrigido nesta sessão (mantém valor)

1. **pt-BR override** (`56cabc4`) — `buildMotionLanguageSection` agora dispara
   pra pt-BR também. Antes Gemini gerava texto visível em inglês porque o
   SYSTEM_PROMPT é majoritariamente em inglês.
2. **Dark fallback preset-aware** (`f9512c0`) — fallback de paleta quando brand
   research falha deixou de ser "STRICT BLACK & WHITE" e passou a usar
   `preset.atmosphere.warmGlow.color` + `coolGlow.color` (cyan/amber pro
   glass-tech, etc).
3. **B-roll click glass-tech sem bounce** (`f67951f`) — atalho "click glass-tech
   limpa override" agora é condicional ao tipo do bloco (só aplica em avatar,
   que tem rule 12 do detector recomendando glass-tech).
4. **Glass-tech volta como default** (`4495d3a`) — rule 12 do effectDetector
   removida (primeiro avatar → bold-pop era reliquia do tempo karaokê);
   captions saem do SYSTEM_PROMPT; atalho de clique glass-tech reativado.
5. **Sync modal ↔ Inspector** (`6254cb6`) — `set-block-style-preset` agora é
   dispatched depois do MotionPickerModal save, mantendo chip e
   `motion.presetId` em sincronia.
6. **B-roll click bounce fix** (`89bb51e`) — primeiro fix do atalho glass-tech
   (regrediu em `4495d3a`, corrigido de novo em `f67951f`).
7. **Two-preset highlight fix** (`96197e2`) — `currentPresetId` derivado de
   `effectivePresetId` em vez do `?? 'glass-tech'` literal. Acabou com o
   "default mentiroso" que mostrava glass-tech selecionado mesmo quando o
   detector recomendava outro preset.

### Por que ainda parece "ícone barato" mesmo com tudo corrigido

Hipótese (não confirmada experimentalmente): o SYSTEM_PROMPT cresceu ~50%
desde `44e8e54` (estado bom). As camadas adicionadas pela onda Hyperframes
+ correções subsequentes:

- `EASING & DURATION VOCABULARY` table (~15 linhas)
- `HYPERFRAMES CATALOG` section + sub-composition emit pattern (~70 linhas)
- `AI DESIGN TELLS` section (~15 linhas)
- `ILLUSTRATION VOCABULARY` em illustrated-explainer (~52 linhas)
- `PREFERRED HYPERFRAMES COMPONENTS` em 8 Style briefs + 3 Effect briefs
  (~80-100 linhas no total)

Cada uma faz sentido isolada. Juntas viraram restrições que Gemini interpreta
como "delegue pro catálogo / use vocabulário mínimo / evite designs". Resultado:
composições simplistas.

A skill oficial Hyperframes (github.com/heygen-com/hyperframes) diz literalmente
**"Write HTML. Render video. Built for agents."** — filosofia é menos prescrição,
mais liberdade.

### Plano aprovado (próximos 2 commits)

**Commit A: `revert(motion): remove SYSTEM_PROMPT layers added by Hyperframes wave`**
- Remove EASING & DURATION VOCABULARY
- Remove HYPERFRAMES CATALOG section + emit pattern
- Remove AI DESIGN TELLS
- Mantém intactos: 8 PRINCIPLES, animation grammar, technical requirements, OUTPUT shape, pt-BR override, dark fallback, App Mention, HYPERFRAMES_WHITELIST export

**Commit B: `revert(motion-presets): remove PREFERRED HYPERFRAMES blocks + illustration vocabulary`**
- Remove "PREFERRED HYPERFRAMES COMPONENTS" de 8 Style + 3 Effect briefs
- Reverte brief de `illustrated-explainer` pro estado `44e8e54` (sem 6 archetypes)
- Mantém: refinos individuais de palette / NEVER lists / MOTION specs em cada preset (`d79fe3f`, `227e386`, `7135f3b`, `b62882f`, `0942ee8`, `bf7c05d`)

### O que ESTE commit faz

Só documenta. Zero mudança de código. Serve de checkpoint pra que, se os 2
commits seguintes não resolverem ou piorarem algo, possamos reverter pra cá
com clareza do que estava aqui e por quê.

### Cache de motion existente

Importante: motions JÁ gerados ficam intactos no IndexedDB (`block.motion.html`).
Pra testar o novo prompt, usar botão **"↻ Regerar motion"** (não apenas
re-renderizar). Re-renderizar usa HTML cacheado.

---

## Wave correction #3 — instrutivo, UI sempre, texto destilado (2026-05-19)

Filosofia explicada pelo usuário: vídeos são **instrutivos**, motion **ilustra
o que está sendo falado**, enfatizando palavras-chave sem fórmula rígida.

Diagnóstico: o SYSTEM_PROMPT em `42a294e` (11/05, super primeiro com UI
recreation) é **idêntico** ao HEAD atual nos PRINCIPLES 2 e 9. Os vídeos
bonitos que ele compartilhou foram gerados pelo mesmo prompt. O que mudou
foi o estilo dos blocos do usuário — em 11/05 ele usava verbos UI
("vai em", "abre"), agora descreve mais sem verbo → PRINCIPLE 9 não disparava
→ Gemini caía em texto solto.

### Mudanças desta correção

1. **Style presets consolidados pra 4 visíveis** — `editorial-clean`,
   `bold-pop`, `glass-tech`, `illustrated-explainer`. Ficaram **hidden**:
   `soft-pastel`, `cinematic-dark`, `apple-system`, `warm-editorial`
   (continuam no union pra motions antigos renderizarem; só somem do picker).
   `roleDetector.ts` redirecionado: comparison→bold-pop, problem/quote/
   reflection/list→editorial-clean.

2. **PRINCIPLE 9 (UI RECREATION) com trigger expandido** — agora dispara
   em QUALQUER menção de app/SaaS/produto, sem precisar verbo UI. Bloco
   "no Canva tem um Kit de Marca" → desenha sidebar Canva. Adicionada
   regra explícita: "NEVER fall back to centered text on dark bg when
   an app is described".

3. **PRINCIPLE 2 ganha bloco "HERO TEXT — DESTILE, NÃO TRANSCREVA"** —
   instrução de extrair 2-4 keywords da fala com 3 exemplos. SEM fórmula
   rígida two-tone — Gemini escolhe como destacar (color, weight,
   underline, scale punch). Texto sempre destila, nunca transcreve a
   sentença falada.

### Não mudou

- Brand research via Google Search continua intacto
- FontSets ('brand' = Anton + Space Grotesk + Inter ativo nos 4 visíveis)
- Preset briefs curtos (commit 1ac9f17)
- TECHNICAL REQUIREMENTS / ANIMATION GRAMMAR / FORBIDDEN PATTERNS

### Lembrete

Pra testar o novo prompt: clicar **"↻ Regerar motion"**, não apenas
re-renderizar. Re-renderizar usa o HTML cacheado no IndexedDB.

---

## Bug fix — Travada de ~180ms no último frame entre blocos (2026-05-19)

Sintoma reportado: tanto no **preview** quanto no **MP4 exportado**, cada
bloco "travava" por ~100-200ms no último frame antes de transicionar pro
próximo. Acontecia em todos os tipos (avatar, motion, b-roll).

### Causa

A duração bate exatamente com o `TAIL_PADDING_SEC = 0.18s` em
`audioSlicer.ts` — esse padding é mandado pra HeyGen pra evitar corte de
fonema na última palavra, mas vira frame congelado quando o clip dura
mais que o bloco. Três pontos somavam pro mesmo sintoma:

1. **Avatar fade curto demais** em `mp4Renderer.ts:113`:
   `AVATAR_OVERRUN_FADE = 3 / FRAMERATE` (100ms) cobria só metade do
   overrun real (~180ms).
2. **Motion overlay sem fade nenhum** — clamp duro `Math.min(localT, motionDur - 0.05)` segurava o penúltimo frame parado.
3. **Preview swap de `<video>`** entre blocos: ao mudar `currentBlock`, o
   browser segurava o último frame do video antigo enquanto o novo
   carregava.

### Correção

**Render (`mp4Renderer.ts`):**
- `avatarOverrunAlpha` renomeado pra `overrunAlpha` (generalizado).
- Fade window aumentado de 3 → **6 frames (200ms)**, batendo com `FADE_FRAMES`.
- Aplicado também aos motion layers (`replace`, `split-*`, `overlay`).
- B-roll mantido sem fade — `mapBrollTime` faz loop, nunca congela.

**Preview (`ReelsStudio.tsx`):**
- Novo `blockFadeOpacity` calculado a partir do slot + playhead.
- Aplicado via `opacity` no `<video>` do avatar, wrapper do b-roll e
  wrapper do `MotionLayerOverlay`. Fade in nos primeiros 200ms do bloco +
  fade out nos últimos 200ms.

### Não mudou

- `TAIL_PADDING_SEC = 0.18s` (proposital — resolve corte de fonema da HeyGen).
- Cross-dissolve inter-bloco no export (já existia, FADE_FRAMES = 6).
- B-roll loop via `mapBrollTime` (já não freezava).
- Carousel preview (slides estáticos, sem transição automática).

### Follow-up — 2 bugs mais profundos descobertos via análise frame-a-frame

Análise SSIM frame-a-frame de um MP4 exportado mostrou freeze REAL de
**300-400ms** entre blocos (não 180ms). Duas raízes adicionais:

**Bug A — motionDur usava intent em vez da duração real do MP4.**
`composeForBlock` lia `block.motion?.durationSec || 4`. Esse campo é o
**alvo** da animação (4s default), não a duração efetiva do MP4 do
Hyperframes. Quando Gemini gera um motion de 6.7s pra um bloco de 7.1s,
o player segura o último frame por 400ms. Fix: usar
`clipDurations.get(motionUrl)` (que já tem a duração medida do MP4
preloaded — `mp4Renderer.ts:668`) como fonte de verdade, com fallback
pra `block.motion.durationSec` quando ainda não medido.

**Bug B — cross-dissolve em mode='out' era NO-OP.**
`applyTransition` em mode='out' chamava `prependFrom`/`appendTo` que
mutavam `toLayers` (= `next.layers`, **nunca renderizado**) em vez de
mutarem o `layers` do caller. Resultado: nos últimos 200ms do bloco,
nenhuma mistura com o próximo acontecia — só o frame congelado do bloco
atual. Fix: ambos helpers agora resolvem o "visible container" pelo
mode (`toLayers` em 'in', `fromLayers` em 'out'). Confirma frame-a-frame:
SSIM de 1.000000 entre frames consecutivos antes do corte (= freeze
puro). Depois do fix, cross-dissolve real entre own@(1-t) e next@(t).

Bugs A e B se reforçavam: o motion congelava nos últimos 400ms, e a
cross-dissolve que deveria mascarar o freeze nunca rodava.

---

## Sessão 2026-05-20 — Model tracking, asset gate, single-block regen, frame-pacing

Commit: `f5e3e14`. Reúne 8 mudanças relacionadas em torno do fluxo
motion/avatar + qualidade do export.

### Problema 1 — Não dava pra saber qual modelo Gemini gerou o motion

O badge no MotionPickerModal mostrava o modelo **selecionado agora**, não
o que efetivamente foi usado pra gerar cada motion. Se o usuário trocasse
de 3.5 Flash → 3.1 Pro nas Configurações depois de gerar, abrir um motion
antigo mostrava "3.1 Pro" no badge — mas ele tinha sido feito com 3.5
Flash. Engana.

**Fix:** `GenerationOutput.modelUsed` + `MotionConfig.modelUsed` (string).
Loop do Gemini grava qual modelo do fallback chain efetivamente funcionou
(`motionService.ts`). Native `claude-ui` preset retorna `'native-claude-ui'`.
Helper `getMotionModelLabel(id?)` traduz pra label curto (3.5 Flash / 3.1
Pro / 3 Flash / Nativo / Claude / —). UI:
- Badge **verde** no MotionPickerModal quando `motion.html` existe (modelo
  que gerou); **violeta** quando ainda não gerado (modelo que vai rodar).
- Mesma lógica no InspectorPanel, ao lado do status strip.

### Problema 2 — `<video />` self-closing quebrando HyperFrames

Gemini 3.5 Flash emite `<video src="..." />` com self-closing — HTML
inválido. HyperFrames lint catches com `[self_closing_media_tag]` e
aborta o render. Cada motion gerado falhava no exit code 1 do CLI.

**Fix:** Sanitizador em `motionService.ts:2105-2125`. Regex substitui
`<(video|audio|source|track|img) ... />` por `<tag ...></tag>` antes do
`htmlBody` ser retornado. Log `[motion/sanitize] rewrote self-closing
media tags` quando aciona. Idempotente — tags já com closing explícito
passam intactas.

### Problema 3 — Gemini se confundia com assets quando bloco não tinha pinned

Quando a pasta de assets do projeto tinha vídeos/imagens mas o bloco
atual não tinha nenhum anexado, a code path em `ReelsStudio.tsx:1072`
caía em `universalAssetsToSend` (lista do projeto inteiro). Gemini então
"escolhia" um asset random pra ilustrar o bloco — gerava HTML referenciando
paths que o runtime não resolvia, ou aleatorizava qual asset usar por
bloco. HyperFrames falhava com erros diversos.

**Decisão do usuário:** "Sempre que tiver assets numa pasta, precisam ser
associados a cada bloco antes de gerar."

**Fix:** Novo helper `src/components/reelsStudio/motionGating.ts` com
`requiresAssetAttachment(block, projectAssetsCount)`. Gate aplicado em:
1. `handleAutoMotion` — early return + abre `AssetPickerModal` no bloco
2. `handleAutoMotionMany` — skip com log `[batch-motion] block X skipped`
3. Chip do card — vira amber **"📎 Anexar asset primeiro"**; click abre
   AssetPicker em vez de gerar
4. InspectorPanel — status strip mostra **"⚠ Anexe um asset antes de
   gerar"** em amber; botão Gerar vira amber "📎 Anexar asset"
5. Toolbar batch — `Gerar motions (N) · M aguardam asset` quando há
   bloqueados; só roda os prontos

Estado novo: `projectAssetsCount` em `ReelsStudio.tsx` refresca on mount,
on AssetPicker close, on `reveal_assets_dir` click.

### Problema 4 — "Gerar todos os motions" parecia travar no primeiro

Cada motion leva ~30s (Gemini + HyperFrames). Com 5 blocos, batch demora
~2.5min. O label do botão mostrava só "Gerando motions… (1)" o tempo
todo (motionBusyCount = sempre 1 num loop sequencial), então o usuário
achava que parou.

**Fix:** `batchMotionProgress` state em `ReelsStudio.tsx` rastreia
`{current, total, blockId}`. Atualizado a cada iteração no loop. Label do
botão vira **"Gerando motion 2 de 5…"**. `try/finally` garante limpeza
do chip mesmo se o loop crashar. Logs verbosos `[batch-motion] iteration
X/Y · blockId=… · DONE/FAILED` pra debug.

### Problema 5 — Avatar ruim num bloco específico exigia regerar tudo

Não dava pra regenerar só 1 bloco de avatar. Quando o lipsync saía
torto num bloco, o jeito era voltar pro modal global "Gerar clipes de
avatar" e rodar tudo de novo (custo HeyGen).

**Fix:** Botão no canto direito de cada bloco avatar na timeline:
- **Violeta + ✨** quando não tem clipe (gerar primeira vez)
- **Âmbar + ↻** quando ready (regerar)
- **Vermelho + ✨** quando erro (retry)

Click abre modal de confirmação com:
- Trecho do texto do bloco
- 3 pílulas de seletor de modelo (Avatar V / 4 / 3) com preço por segundo
- Custo total estimado (atualiza ao vivo conforme troca modelo)
- Cancelar / Gerar|Regerar

Implementação: `runRegenerateOneClip(blockId, modelOverride?)` em
`ReelsStudio.tsx` — mesmo pipeline do `runGenerateClips` (slice + HeyGen),
mas com `ranges` e `talkingPhotoIdByBlock` limitados ao bloco alvo.
`generatingClips` flag global previne conflito com batch run.

### Problema 6 — Frame-skip e dessincronia no export MP4

Sintomas verificados via ffprobe + extração de frames sequenciais:
- 30fps CFR está correto (`r_frame_rate == avg_frame_rate == 30/1`)
- Bitrate real do export era **2.17 Mbps** (lite mode 2.5 Mbps target)
- Frames sendo capturados corretamente, mas motion graphics em movimento
  rápido (expansão de janela, traçado de gráfico, click animations)
  sofriam smearing/blocking — **bitrate starvation** clássico

Mais 4 issues estruturais no `mp4Renderer.ts`:

**A — `overrunAlpha` retornava 1 quando `clipDur` era undefined.** Clips
não-medidos congelavam no último frame sem fade. Para avatar clips que
não estavam em `clipDurations` (preload race), o resultado era freeze.
Fix: helper aceita `fallbackDur` (intent do bloco: `avatarVisibleSec` ou
duração) e pega o `Math.min(measured, fallback)` quando ambos válidos.

**B — Seek race no draw loop.** `seekVideo` resolvia no `seeked` event
mas o decoder podia ainda não ter apresentado o frame para o canvas.
`drawImage` lia frame stale. Fix: verificação pós-seek — se
`|currentTime - target| > 0.05s` (1.5 frame), re-seek 1x. Log
`[render] currentTime mismatch after seek`.

**C — `brokenVideoUrls` era global no export.** 3 timeouts seguidos
marcavam o vídeo como permanentemente quebrado pelo resto do export.
Em transições multi-layer com 4 vídeos × 400ms timeout, fácil de
explodir sem o vídeo estar realmente broken. Fix: reset do `timeoutCount`
em cada boundary de bloco (rastreado via `lastFrameBlockId`).
`brokenVideoUrls` continua válido — só pega quem timeoutar 3x no MESMO
bloco.

**D — `prevLocalT` negativo clampava em 0.** Em transições onde o bloco
anterior é curto demais (< 0.2s), `prevLocalT` ia negativo. `Math.max(0,
prevLocalT)` mostrava o **primeiro** frame do bloco anterior (= jump
visual para trás no tempo). Fix: quando negativo, usar `prevDur -
1/FRAMERATE` (último frame disponível).

### Problema 7 — "Piscada" entre blocos no preview

Sintoma visível tanto no preview quanto no MP4. Causa raiz:

`ReelsStudio.tsx:2866` declarava o avatar `<video>` com **key dinâmico**:
```tsx
<video key={`${currentBlock?.id}-${currentClip.videoUrl}`} ... />
```

Toda mudança de bloco → key muda → React **unmounta** o `<video>` antigo
e **mounta** um novo. Por 1-2 frames o elemento não existe. `blockFadeOpacity`
ainda interpola opacidade nessa janela vazia → flash preto visível.

Comparativo: `MotionLayerOverlay` usa key estável e só troca `src` +
force-seek — não tem o problema.

**Fix:** `key="avatar-preview-video"` (estático). Adicionado useEffect
que reage a `currentClip?.videoUrl` change — em `loadedmetadata` do
novo src, força `currentTime = target` (mesmo padrão de
`MotionLayerOverlay.tsx:84-92`). O elemento DOM persiste; só `src`
troca. `blockFadeOpacity` (200ms) continua produzindo o cross-fade
suave.

### Problema 8 — Export degradava motion graphics em movimento rápido

Confirmado via ffprobe + observação visual em 3 timestamps específicos
(00:02-09 expansão de janela, 00:11-14 traçado de gráfico, 00:29-33
clicks). Bitrate starvation produzia "teleporte" e edges borradas.

**Fix:**
1. `bitrateFor` em `mp4Renderer.ts:61` — `high` 5.5 → **10 Mbps**, `lite`
   2.5 → **5 Mbps**. 10 Mbps é o industry standard pra 1080p H.264 com
   motion graphics; visualmente lossless. ~50 MB para um Reel de 40s.
2. Keyframe forçado no primeiro frame de cada bloco novo. Usa o
   `lastFrameBlockId` já rastreado (Problema 6C). `keyFrame:
   blockBoundaryNow || frame % (FRAMERATE * 2) === 0`. Custo: ~1 I-frame
   extra por bloco. Benefício: primeiro frame do bloco novo é I-frame
   limpo, sem dependência de P-frame motion comp através de mudança
   visual grande.

### Sumário dos arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/services/motionService.ts` | `modelUsed` no GenerationOutput, helper `getMotionModelLabel`, sanitizer de self-closing tags |
| `src/components/reelsStudio/motionLibrary.ts` | Campo `modelUsed` no MotionConfig |
| `src/components/reelsStudio/motionGating.ts` | Helper `requiresAssetAttachment` (novo) |
| `src/components/reelsStudio/MotionPickerModal.tsx` | Badge de modelo (verde/violeta) |
| `src/components/reelsStudio/InspectorPanel.tsx` | Badge no status strip + gate amber quando bloqueado |
| `src/components/agent/useAgentToolBridge.ts` | `modelUsed: 'claude-passthrough'` nos 2 paths Claude |
| `src/components/reelsStudio/mp4Renderer.ts` | overrunAlpha fallback, seek verify, broken-counter scope, prevLocalT clamp, bitrate bump, keyframe at boundary |
| `src/components/ReelsStudio.tsx` | `projectAssetsCount` state + gate em handleAutoMotion[Many], `batchMotionProgress`, regen button + modal, stable key avatar `<video>` |

---

## Sessão 2026-05-20 (cont.) — Piscada entre blocos no export, finalmente resolvida

**Sintoma persistente:** Mesmo após bitrate bump (10 Mbps), keyframe-at-boundary e
skip do overrun fade pra motions que cobrem o bloco, o MP4 exportado **continuava
piscando** em todas as transições. Visualmente: bloco A toca limpo, na transição
o conteúdo de B aparece, depois SUME, depois reaparece — 1-2 frames de
"descontinuidade luminosa" perceptíveis como flash.

### Investigação frame-a-frame

Extração via `ffmpeg -ss 4.60 -frames:v 12` nos 400ms ao redor do boundary
4.8s no MP4 do usuário. 4 frames consecutivos (33ms cada) mostraram:

| Frame | localT projeto | Conteúdo |
|---|---|---|
| 5 | 4.73s | 100% bloco A (composição pequena) |
| 6 | 4.77s | 100% bloco A — **sem indício de blend** |
| 7 | 4.80s | 100% bloco B (composição maior) |
| 8 | 4.83s | 100% bloco B |

Se o cross-dissolve estivesse rodando, os frames 5-6 deveriam mostrar B fazendo
fade-in sobre A. Os frames 7-8 deveriam mostrar A fazendo fade-out sob B. Nada
disso aparecia — corte seco.

### Causa raiz #1 — Matemática do cross-blend em `applyTransition`

Em [`mp4Renderer.ts:407-413`](src/components/reelsStudio/mp4Renderer.ts:407),
o caso `'dissolve'` aplicava:
```ts
const leavingAlpha = 1 - t;
const enteringAlpha = t;
```

Com canvas2d `source-over`, drawImage com alpha faz `dest = source*α + dest*(1-α)`.
Sequência de draws (background black → leaving layer → entering layer):
```
canvas = black
canvas = leaving * (1-t) + black * t              = leaving*(1-t)
canvas = entering * t + leaving*(1-t) * (1-t)
      = entering*t + leaving*(1-t)²
```

No meio do fade (`t=0.5`): leaving contribui com 25% (em vez dos 50% esperados).
**Midpoint do fade fica 25% mais escuro** — lido pelo olho humano como
"piscada escura".

**Fix:** leaving fica em `alpha=1`, só o entering varia com `alpha=t`. Com
`source-over` isso produz a fórmula correta `entering*t + leaving*(1-t)`.

### Causa raiz #2 — Descontinuidade na alpha do entering entre boundaries

Tracing manual frame a frame:
- Último frame de A (localFrame=143 num bloco de 144 frames): `t_out = (143-138)/6 = 0.83` →
  B com alpha **0.83** via `applyTransition('out')`
- Primeiro frame de B (localFrame=0): `t_in = 0/6 = 0` →
  B com alpha **0** via `applyTransition('in')`

Entre dois frames consecutivos (33ms), a opacidade de B **caiu de 0.83 para 0**.
O fade rodava em **dois lados do boundary** (último 200ms de A E primeiro 200ms
de B), com salto bruto no meio. O olho lia esse salto como a piscada.

**Fix:** desabilitar o `applyTransition` no `outFadeRegion` quando a transição é
`dissolve` (ou similar cross-fade). Toda a lógica de mistura passa pro
`inFadeRegion` apenas — A toca puro até o último frame, B aparece prepended em
`alpha=1` no início do seu próprio bloco e fade in via `t = 0 → 1` ao longo de
6 frames. Sem descontinuidade.

### Implementação

[`mp4Renderer.ts:407-419`](src/components/reelsStudio/mp4Renderer.ts:407):
```ts
case 'dissolve': {
  const enteringAlpha = t;
  prependFrom(l => ({ ...l, alpha: l.alpha ?? 1 }));  // leaving NO LONGER multiplied by (1-t)
  appendTo(l => ({ ...l, alpha: (l.alpha ?? 1) * enteringAlpha }));
  return;
}
```

[`mp4Renderer.ts:346-356`](src/components/reelsStudio/mp4Renderer.ts:346):
```ts
if (outFadeRegion) {
  if (outgoingTransition === 'fade' || !nextBlock) {
    fadeAlpha = Math.min(fadeAlpha, (totalBlockFrames - localFrame) / FADE_FRAMES);
  }
  // 'dissolve' / outras cross-fade intencionalmente PULAM o outgoing region
  // — todo o blend acontece só no incoming do próximo bloco.
}
```

### Confirmação

Usuário re-exportou: "no último vídeo que acabei de criar parece que o problema
da transição não está mais aqui". Cross-fade visual smooth, sem flash perceptível.

### Lição

Cross-fade visual requer **DOIS cuidados simultâneos**:
1. Matemática correta de blending (não duplicar `(1-t)` no leaving sob source-over)
2. Continuidade de alpha entre frames consecutivos no boundary (fade em UM lado só)

Falhar em qualquer um produz um artefato visual perceptível. Os 2 bugs estavam
combinados — o fade no outgoing region fazia B aparecer parcialmente antes do
boundary, mas a math errada já degradava o brilho, e o reset no incoming criava
o salto final. Resolver só um dos 2 não eliminava a piscada.

---

## Sessão 2026-05-20 (cont.) — Opt-out per-block do gate de assets

**Problema:** O gate `requiresAssetAttachment` (implementado anteriormente) força
o usuário a anexar um asset em **todo bloco** quando a pasta do projeto tem
arquivos. Mas alguns blocos são intencionalmente text-only (sem asset) — não
há como "destravar" um bloco específico sem esvaziar a pasta inteira.

**Fix:** novo campo `block.skipAssetGate?: boolean` (em `types.ts`) + action
`set-block-skip-asset-gate` no reducer. O helper `requiresAssetAttachment`
agora retorna `false` quando o flag está true, independente do conteúdo da
pasta.

UI: `AssetPickerModal` ganha duas props novas (`gateActive`, `onSkipGate`) e,
quando o gate está ativo + bloco sem assets, surge um botão **"Continuar sem
asset"** no footer (cinza, ao lado do "Concluído"). Click → dispatch +
fecha modal → bloco fica destravado para gerar motion text-only.

Reset: anexar qualquer asset depois remove o flag implicitamente (o helper
não checa skipAssetGate quando `attachedAssets.length > 0`). Para reverter
explicitamente, basta dispatch com `skip: false` (não exposto em UI ainda).

Arquivos: `types.ts`, `reducer.ts`, `motionGating.ts`, `AssetPickerModal.tsx`,
`ReelsStudio.tsx` (props no JSX do modal).

