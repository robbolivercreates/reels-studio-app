// Bilingual (PT/EN) string table for the agent panel.
//
// Why an inline dictionary instead of i18next: only ~60 keys for the agent
// surface, and the rest of the app is PT-only for now. If we ever
// internationalize the full app, migrate this to i18next at that point.
//
// Locale resolution order:
//   1. localStorage['reels.agent.locale'] if set to 'pt' or 'en'
//   2. navigator.language starts with 'pt' → 'pt'; otherwise 'en'
//
// The same locale is forwarded to the Rust subprocess so the system prompt
// (and therefore Claude's responses) match the UI.

import { useCallback, useEffect, useState } from 'react';

export type Locale = 'pt' | 'en';

type StringTable = Record<string, string>;

const STRINGS: Record<Locale, StringTable> = {
  pt: {
    // Header
    'header.title': 'Agente do Reels Studio',
    'header.connected': 'Claude Code conectado',
    'header.notConnected': 'Configure em Settings → Agents',
    'header.clear': 'limpar',
    'header.close': 'Fechar (⌘L)',

    // Welcome screen
    'welcome.intro': 'Converse com o agente para criar, editar e exportar Reels. Ele usa sua assinatura do Claude — sem chave de API.',
    'welcome.capabilities': 'O que o agente pode fazer',
    'welcome.suggestions': 'Sugestões',
    'welcome.showRest': 'ver as outras {n} →',

    // Suggestions (clickable chips)
    'suggestion.list': 'Liste os blocos do projeto',
    'suggestion.regen': 'Regenere o bloco 2 com tom mais agressivo',
    'suggestion.silences': 'Remova os silêncios do áudio',
    'suggestion.cta': 'Adicione um novo bloco final tipo CTA',

    // Capabilities cards (12 entries)
    'cap.list.label': 'Listar blocos',
    'cap.list.desc': 'Veja todos os blocos do roteiro com texto, kind e layout.',
    'cap.read.label': 'Ler bloco',
    'cap.read.desc': 'Detalhes completos de um bloco específico (texto, assets, motion).',
    'cap.status.label': 'Status do projeto',
    'cap.status.desc': 'Formato, voz, status do áudio, análises persistidas.',
    'cap.edit.label': 'Editar texto',
    'cap.edit.desc': 'Mude o texto de um bloco mantendo tudo mais igual.',
    'cap.regen.label': 'Regenerar bloco',
    'cap.regen.desc': 'Reescreve com IA — mais agressivo, mais curto, novo tom.',
    'cap.add.label': 'Adicionar bloco',
    'cap.add.desc': 'Cria um novo bloco (avatar ou B-roll) com IA.',
    'cap.remove.label': 'Remover bloco',
    'cap.remove.desc': 'Apaga um bloco do roteiro.',
    'cap.layout.label': 'Mudar layout',
    'cap.layout.desc': 'Avatar inteiro, split, mídia em cima — escolha por bloco.',
    'cap.audio.label': 'Gerar áudio',
    'cap.audio.desc': 'TTS do roteiro inteiro com a voz ativa.',
    'cap.broll.label': 'Anexar B-roll',
    'cap.broll.desc': 'Adiciona imagem ou vídeo a um bloco.',
    'cap.silences.label': 'Cortar silêncios',
    'cap.silences.desc': 'Detecta e remove pausas — natural / fast / super.',
    'cap.voice.label': 'Trocar voz',
    'cap.voice.desc': 'Aplica outra voz built-in ou clonada ao projeto.',

    // Input area
    'input.placeholder': 'Pergunte ao agente o que fazer…',
    'input.disabledPlaceholder': 'Conecte o Claude Code primeiro',
    'input.hint.enter': 'Enter envia',
    'input.hint.toggle': '⌘L fecha',
    'input.send': 'Enviar',
    'input.attach': 'Anexar arquivo',
    'input.attachHint': 'Arraste imagens ou vídeos aqui',

    // Busy + cancel
    'busy.thinking': 'Agente pensando…',
    'busy.cancel': 'cancelar',
    'busy.cancelled': 'Cancelado',

    // Attachments
    'attach.remove': 'Remover',
    'attach.video': 'Vídeo',
    'attach.image': 'Imagem',

    // Approval card
    // Draft preview card
    'draft.titleReel': 'Pronto pra aplicar · {n} blocos',
    'draft.titleCarousel': 'Pronto pra aplicar · {n} slides',
    'draft.apply': 'Aplicar ao roteiro',
    'draft.discard': 'Descartar',
    'draft.applied': 'Aplicado ao roteiro',
    'draft.discarded': 'Descartado',

    'approval.title': 'Aprovação necessária',
    'approval.subtitle': 'O agente quer executar {tool}',
    'approval.viewArgs': 'ver argumentos',
    'approval.allow': 'Aprovar',
    'approval.reject': 'Rejeitar',
    'approval.allowed': '✓ Aprovado',
    'approval.rejected': '✗ Rejeitado',

    // Tool progress — "doing" form (present-continuous)
    'tool.listBlocks.doing': 'Lendo os blocos…',
    'tool.readBlock.doing': 'Lendo o bloco…',
    'tool.getStatus.doing': 'Conferindo o projeto…',
    'tool.editText.doing': 'Editando texto…',
    'tool.regenBlock.doing': 'Regenerando bloco com IA…',
    'tool.addBlock.doing': 'Criando bloco novo…',
    'tool.removeBlock.doing': 'Removendo bloco…',
    'tool.setLayout.doing': 'Mudando layout…',
    'tool.setKind.doing': 'Mudando tipo do bloco…',
    'tool.regenDraftBlock.doing': 'Refazendo bloco do draft…',
    'tool.replaceDraftBlock.doing': 'Editando bloco do draft…',
    'tool.setMotion.doing': 'Animando bloco…',
    'tool.genAudio.doing': 'Gerando áudio…',
    'tool.addBroll.doing': 'Anexando B-roll…',
    'tool.silences.doing': 'Cortando silêncios…',
    'tool.setVoice.doing': 'Trocando voz…',
    'tool.approvalPrompt.doing': 'Esperando sua aprovação…',
    // Tool progress — "done" form (past tense, short)
    'tool.listBlocks.done': 'Leu {n} bloco(s)',
    'tool.readBlock.done': 'Leu o bloco',
    'tool.getStatus.done': 'Conferiu o projeto',
    'tool.editText.done': 'Texto editado',
    'tool.regenBlock.done': 'Bloco regenerado',
    'tool.addBlock.done': 'Bloco criado',
    'tool.removeBlock.done': 'Bloco removido',
    'tool.setLayout.done': 'Layout aplicado',
    'tool.setKind.done': 'Tipo trocado',
    'tool.regenDraftBlock.done': 'Bloco do draft refeito',
    'tool.replaceDraftBlock.done': 'Bloco do draft editado',
    'tool.setMotion.done': 'Animação aplicada',
    'tool.genAudio.done': 'Áudio gerando…',
    'tool.addBroll.done': 'B-roll anexado',
    'tool.silences.done': 'Silêncios cortados',
    'tool.setVoice.done': 'Voz trocada',
    'tool.approvalPrompt.done': 'Aprovação resolvida',
    // Wave 1 — imports
    'tool.importVideoUrl.doing': 'Baixando e analisando o vídeo…',
    'tool.importVideoUrl.done': 'Reel importado · {n} blocos',
    'tool.importArticle.doing': 'Lendo artigo e montando o roteiro…',
    'tool.importArticle.done': 'Roteiro pronto · {n} blocos',
    'tool.importScript.doing': 'Classificando script…',
    'tool.importScript.done': 'Script importado · {n} blocos',
    'tool.recreateScript.doing': 'Reescrevendo roteiro inteiro…',
    'tool.recreateScript.done': 'Roteiro refeito',
    'tool.genCarousel.doing': 'Gerando carrossel…',
    'tool.genCarousel.done': 'Carrossel pronto · {n} slides',
    // Wave 2 — visual
    'tool.listPresets.doing': 'Buscando vibes…',
    'tool.listPresets.done': 'Vibes disponíveis',
    'tool.applyPreset.doing': 'Aplicando vibe…',
    'tool.applyPreset.done': 'Vibe aplicada',
    'tool.applyPresetCascade.doing': 'Aplicando vibe em todos os blocos…',
    'tool.applyPresetCascade.done': 'Vibe cascateada',
    'tool.genMotion.doing': 'Gerando motion com IA…',
    'tool.genMotion.done': 'Motion gerado',
    'tool.genMotionBatch.doing': 'Gerando motions em lote (em série)…',
    'tool.genMotionBatch.done': 'Motions prontos · {n} blocos',
    'tool.renderMotions.doing': 'Renderizando motions…',
    'tool.renderMotions.done': 'Motions renderizados',
    'tool.genAvatarClips.doing': 'Gerando clipes de avatar…',
    'tool.genAvatarClips.done': 'Clipes em produção',
    'tool.listPhotos.doing': 'Buscando photos…',
    'tool.listPhotos.done': 'Photos disponíveis',
    'tool.pickPhoto.doing': 'Aguardando você escolher a photo…',
    'tool.pickPhoto.done': 'Photo escolhida',
    'tool.setPhoto.doing': 'Aplicando photo…',
    'tool.setPhoto.done': 'Photo selecionada',
    'tool.uploadPhoto.doing': 'Subindo foto pro HeyGen…',
    'tool.uploadPhoto.done': 'Foto cadastrada e selecionada',
    'tool.setAvatarModel.doing': 'Trocando modelo HeyGen…',
    'tool.setAvatarModel.done': 'Modelo HeyGen aplicado',
    // Wave 3 — caption + config + motion edit
    'tool.genCaption.doing': 'Escrevendo a descrição…',
    'tool.genCaption.done': 'Descrição pronta',
    'tool.setEmotion.doing': 'Ajustando emoção…',
    'tool.setEmotion.done': 'Emoção ajustada',
    'tool.setAppTheme.doing': 'Trocando o tema…',
    'tool.setAppTheme.done': 'Tema trocado',
    'tool.setProjectName.doing': 'Renomeando o projeto…',
    'tool.setProjectName.done': 'Projeto renomeado',
    'tool.editMotionHtml.doing': 'Atualizando motion…',
    'tool.editMotionHtml.done': 'Motion atualizado',
    // Wave 3 — voice
    'tool.listVoices.doing': 'Listando vozes…',
    'tool.listVoices.done': 'Vozes disponíveis',
    'tool.pickVoice.doing': 'Aguardando você escolher a voz…',
    'tool.pickVoice.done': 'Voz escolhida',
    'tool.setVoiceSpeed.doing': 'Ajustando velocidade da voz…',
    'tool.setVoiceSpeed.done': 'Velocidade ajustada',
    'tool.cloneVoice.doing': 'Clonando voz…',
    'tool.cloneVoice.done': 'Voz clonada',
    // Wave 3 — assets + references
    'tool.listAssets.doing': 'Listando assets do projeto…',
    'tool.listAssets.done': 'Assets do projeto',
    'tool.attachAsset.doing': 'Anexando ao bloco…',
    'tool.attachAsset.done': 'Asset anexado',
    'tool.listRefs.doing': 'Listando referências…',
    'tool.listRefs.done': 'Referências salvas',
    'tool.deleteRef.doing': 'Apagando referência…',
    'tool.deleteRef.done': 'Referência apagada',
    'tool.reanalyse.doing': 'Re-analisando vídeo…',
    'tool.reanalyse.done': 'Reanálise pronta',
    'tool.unknown.doing': 'Trabalhando…',
    'tool.unknown.done': 'Pronto',

    // Locale toggle
    'locale.toggle': 'Idioma',

    // Model picker hints
    'model.opus.hint': 'Melhor para tarefas complexas',
    'model.sonnet.hint': 'Melhor para o dia a dia',
    'model.haiku.hint': 'Mais barato e rápido',
  },

  en: {
    'header.title': 'Reels Studio Agent',
    'header.connected': 'Claude Code connected',
    'header.notConnected': 'Configure in Settings → Agents',
    'header.clear': 'clear',
    'header.close': 'Close (⌘L)',

    'welcome.intro': 'Chat with the agent to create, edit and export Reels. It uses your Claude subscription — no API key needed.',
    'welcome.capabilities': 'What the agent can do',
    'welcome.suggestions': 'Suggestions',
    'welcome.showRest': 'show the other {n} →',

    'suggestion.list': 'List the project\'s blocks',
    'suggestion.regen': 'Regenerate block 2 with a more aggressive tone',
    'suggestion.silences': 'Remove the audio silences',
    'suggestion.cta': 'Add a CTA block at the end',

    'cap.list.label': 'List blocks',
    'cap.list.desc': 'See every script block with text, kind and layout.',
    'cap.read.label': 'Read block',
    'cap.read.desc': 'Full details of a single block (text, assets, motion).',
    'cap.status.label': 'Project status',
    'cap.status.desc': 'Format, voice, audio status, persisted analyses.',
    'cap.edit.label': 'Edit text',
    'cap.edit.desc': 'Change a block\'s text without touching anything else.',
    'cap.regen.label': 'Regenerate block',
    'cap.regen.desc': 'Rewrite with AI — more aggressive, shorter, new tone.',
    'cap.add.label': 'Add block',
    'cap.add.desc': 'Create a new block (avatar or B-roll) with AI.',
    'cap.remove.label': 'Remove block',
    'cap.remove.desc': 'Delete a block from the script.',
    'cap.layout.label': 'Change layout',
    'cap.layout.desc': 'Full avatar, split, media on top — per block.',
    'cap.audio.label': 'Generate audio',
    'cap.audio.desc': 'TTS for the whole script using the active voice.',
    'cap.broll.label': 'Attach B-roll',
    'cap.broll.desc': 'Add an image or video to a block.',
    'cap.silences.label': 'Trim silences',
    'cap.silences.desc': 'Detect and remove pauses — natural / fast / super.',
    'cap.voice.label': 'Switch voice',
    'cap.voice.desc': 'Apply another built-in or cloned voice to the project.',

    'input.placeholder': 'Ask the agent to do something…',
    'input.disabledPlaceholder': 'Connect Claude Code first',
    'input.hint.enter': 'Enter to send',
    'input.hint.toggle': '⌘L to toggle',
    'input.send': 'Send',
    'input.attach': 'Attach file',
    'input.attachHint': 'Drag images or videos here',

    'busy.thinking': 'Agent thinking…',
    'busy.cancel': 'cancel',
    'busy.cancelled': 'Cancelled',

    'attach.remove': 'Remove',
    'attach.video': 'Video',
    'attach.image': 'Image',

    // Draft preview card
    'draft.titleReel': 'Ready to apply · {n} blocks',
    'draft.titleCarousel': 'Ready to apply · {n} slides',
    'draft.apply': 'Apply to script',
    'draft.discard': 'Discard',
    'draft.applied': 'Applied to script',
    'draft.discarded': 'Discarded',

    'approval.title': 'Approval needed',
    'approval.subtitle': 'The agent wants to run {tool}',
    'approval.viewArgs': 'view arguments',
    'approval.allow': 'Allow',
    'approval.reject': 'Reject',
    'approval.allowed': '✓ Allowed',
    'approval.rejected': '✗ Rejected',

    'tool.listBlocks.doing': 'Reading the blocks…',
    'tool.readBlock.doing': 'Reading the block…',
    'tool.getStatus.doing': 'Checking the project…',
    'tool.editText.doing': 'Editing text…',
    'tool.regenBlock.doing': 'Regenerating block with AI…',
    'tool.addBlock.doing': 'Creating a new block…',
    'tool.removeBlock.doing': 'Removing block…',
    'tool.setLayout.doing': 'Changing layout…',
    'tool.setKind.doing': 'Switching block kind…',
    'tool.regenDraftBlock.doing': 'Rewriting draft block…',
    'tool.replaceDraftBlock.doing': 'Editing draft block…',
    'tool.setMotion.doing': 'Animating block…',
    'tool.genAudio.doing': 'Generating audio…',
    'tool.addBroll.doing': 'Attaching B-roll…',
    'tool.silences.doing': 'Trimming silences…',
    'tool.setVoice.doing': 'Switching voice…',
    'tool.approvalPrompt.doing': 'Waiting for your approval…',
    'tool.listBlocks.done': 'Read {n} block(s)',
    'tool.readBlock.done': 'Read the block',
    'tool.getStatus.done': 'Checked the project',
    'tool.editText.done': 'Text edited',
    'tool.regenBlock.done': 'Block regenerated',
    'tool.addBlock.done': 'Block created',
    'tool.removeBlock.done': 'Block removed',
    'tool.setLayout.done': 'Layout applied',
    'tool.setKind.done': 'Kind switched',
    'tool.regenDraftBlock.done': 'Draft block rewritten',
    'tool.replaceDraftBlock.done': 'Draft block edited',
    'tool.setMotion.done': 'Animation applied',
    'tool.genAudio.done': 'Audio generating…',
    'tool.addBroll.done': 'B-roll attached',
    'tool.silences.done': 'Silences trimmed',
    'tool.setVoice.done': 'Voice switched',
    'tool.approvalPrompt.done': 'Approval handled',
    // Wave 1 — imports
    'tool.importVideoUrl.doing': 'Downloading and analysing the video…',
    'tool.importVideoUrl.done': 'Reel imported · {n} blocks',
    'tool.importArticle.doing': 'Reading the article and drafting the script…',
    'tool.importArticle.done': 'Script ready · {n} blocks',
    'tool.importScript.doing': 'Classifying script…',
    'tool.importScript.done': 'Script imported · {n} blocks',
    'tool.recreateScript.doing': 'Rewriting the full script…',
    'tool.recreateScript.done': 'Script rewritten',
    'tool.genCarousel.doing': 'Generating carousel…',
    'tool.genCarousel.done': 'Carousel ready · {n} slides',
    // Wave 2 — visual
    'tool.listPresets.doing': 'Fetching style presets…',
    'tool.listPresets.done': 'Style presets',
    'tool.applyPreset.doing': 'Applying preset…',
    'tool.applyPreset.done': 'Preset applied',
    'tool.applyPresetCascade.doing': 'Applying preset across blocks…',
    'tool.applyPresetCascade.done': 'Preset cascaded',
    'tool.genMotion.doing': 'Generating motion with AI…',
    'tool.genMotion.done': 'Motion generated',
    'tool.genMotionBatch.doing': 'Batching motions (sequential render)…',
    'tool.genMotionBatch.done': 'Motions ready · {n} blocks',
    'tool.renderMotions.doing': 'Rendering motions…',
    'tool.renderMotions.done': 'Motions rendered',
    'tool.genAvatarClips.doing': 'Generating avatar clips…',
    'tool.genAvatarClips.done': 'Clips in production',
    'tool.listPhotos.doing': 'Fetching photos…',
    'tool.listPhotos.done': 'Available photos',
    'tool.pickPhoto.doing': 'Waiting for you to pick a photo…',
    'tool.pickPhoto.done': 'Photo picked',
    'tool.setPhoto.doing': 'Applying photo…',
    'tool.setPhoto.done': 'Photo selected',
    'tool.uploadPhoto.doing': 'Uploading photo to HeyGen…',
    'tool.uploadPhoto.done': 'Photo uploaded and selected',
    'tool.setAvatarModel.doing': 'Switching HeyGen model…',
    'tool.setAvatarModel.done': 'HeyGen model applied',
    // Wave 3 — caption + config + motion edit
    'tool.genCaption.doing': 'Writing the caption…',
    'tool.genCaption.done': 'Caption ready',
    'tool.setEmotion.doing': 'Adjusting voice emotion…',
    'tool.setEmotion.done': 'Emotion adjusted',
    'tool.setAppTheme.doing': 'Switching theme…',
    'tool.setAppTheme.done': 'Theme switched',
    'tool.setProjectName.doing': 'Renaming the project…',
    'tool.setProjectName.done': 'Project renamed',
    'tool.editMotionHtml.doing': 'Updating motion…',
    'tool.editMotionHtml.done': 'Motion updated',
    // Wave 3 — voice
    'tool.listVoices.doing': 'Listing voices…',
    'tool.listVoices.done': 'Available voices',
    'tool.pickVoice.doing': 'Waiting for you to pick a voice…',
    'tool.pickVoice.done': 'Voice picked',
    'tool.setVoiceSpeed.doing': 'Adjusting voice speed…',
    'tool.setVoiceSpeed.done': 'Speed adjusted',
    'tool.cloneVoice.doing': 'Cloning voice…',
    'tool.cloneVoice.done': 'Voice cloned',
    // Wave 3 — assets + references
    'tool.listAssets.doing': 'Listing project assets…',
    'tool.listAssets.done': 'Project assets',
    'tool.attachAsset.doing': 'Attaching to block…',
    'tool.attachAsset.done': 'Asset attached',
    'tool.listRefs.doing': 'Listing references…',
    'tool.listRefs.done': 'Saved references',
    'tool.deleteRef.doing': 'Deleting reference…',
    'tool.deleteRef.done': 'Reference deleted',
    'tool.reanalyse.doing': 'Re-analysing video…',
    'tool.reanalyse.done': 'Re-analysis done',
    'tool.unknown.doing': 'Working…',
    'tool.unknown.done': 'Done',

    'locale.toggle': 'Language',

    'model.opus.hint': 'Best for complex tasks',
    'model.sonnet.hint': 'Best for daily use',
    'model.haiku.hint': 'Cheapest and fastest',
  },
};

const STORAGE_KEY = 'reels.agent.locale';

function loadStored(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'pt' || raw === 'en') return raw;
  } catch {
    // localStorage unavailable in some sandboxes — fall through.
  }
  const lang = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
  return lang.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

// Tiny event bus so every hook instance stays in sync when one changes locale.
const subs = new Set<(l: Locale) => void>();

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const [locale, setLocaleState] = useState<Locale>(loadStored);

  useEffect(() => {
    const handler = (l: Locale) => setLocaleState(l);
    subs.add(handler);
    return () => {
      subs.delete(handler);
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable — runtime state still updates.
    }
    for (const sub of subs) sub(next);
  }, []);

  return { locale, setLocale };
}

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = STRINGS[locale] ?? STRINGS.en;
  let raw = dict[key];
  if (raw == null) raw = STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(`{${k}}`, String(v));
    }
  }
  return raw;
}

/// Convenience hook: returns a bound translator for the current locale.
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const { locale } = useLocale();
  return useCallback((key, vars) => t(locale, key, vars), [locale]);
}
