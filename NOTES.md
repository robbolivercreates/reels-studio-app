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
| 4 | Câmera virtual (Onda B do Hyperframes) | parked | Voltar depois |

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
