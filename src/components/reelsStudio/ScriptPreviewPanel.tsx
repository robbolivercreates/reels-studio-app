import React, { useEffect, useRef, useState } from 'react';
import type { ScriptBlock, BlockKind, ToneOption, LanguageOption } from './types';

const TONE_OPTIONS: { value: ToneOption; label: string }[] = [
  { value: 'current', label: 'Atual' },
  { value: 'more-direct', label: 'Mais direto' },
  { value: 'more-casual', label: 'Mais informal' },
  { value: 'more-didactic', label: 'Mais didático' },
];

/** Quick presets the user can click to append common regen instructions. */
const REGEN_PRESETS: { label: string; phrase: string }[] = [
  { label: 'mais persuasivo', phrase: 'mais persuasivo' },
  { label: 'mais direto', phrase: 'mais direto, sem rodeios' },
  { label: 'mais curto', phrase: 'mais curto' },
  { label: 'menos formal', phrase: 'menos formal, conversa de bar' },
  { label: 'tom de história', phrase: 'tom de história pessoal' },
  { label: 'provocativo', phrase: 'mais provocativo, contraintuitivo' },
];

const appendPreset = (current: string, phrase: string): string => {
  const trimmed = current.trim();
  if (!trimmed) return phrase;
  if (trimmed.toLowerCase().includes(phrase.toLowerCase())) return trimmed;
  return `${trimmed}, ${phrase}`;
};

const LANGUAGE_OPTIONS: { value: LanguageOption; label: string }[] = [
  { value: 'auto', label: 'Auto (perfil)' },
  { value: 'pt-BR', label: 'PT-BR' },
  { value: 'en-US', label: 'EN-US' },
  { value: 'es-ES', label: 'ES-ES' },
  { value: 'fr-FR', label: 'FR' },
  { value: 'it-IT', label: 'IT' },
  { value: 'de-DE', label: 'DE' },
];

export type PreviewMode = 'video' | 'article' | 'script';

export interface DetectedHeader {
  format?: string;
  durationSec?: number;
  tone?: string[];
  hookStyle?: string;
  language?: string;
  /** For article mode: framework + rationale from scriptFromContentService. */
  framework?: string;
  rationale?: string;
}

export interface BusyState {
  kind: 'all' | 'block' | 'add';
  blockId?: string;
}

export interface ScriptPreviewPanelProps {
  mode: PreviewMode;
  blocks: ScriptBlock[];
  detectedHeader: DetectedHeader;

  onBlocksChange: (blocks: ScriptBlock[]) => void;
  onRegenerateAll: (extraInstructions: string, tone: ToneOption, language: LanguageOption) => Promise<void>;
  onRegenerateBlock: (blockId: string, extraInstructions: string, language: LanguageOption) => Promise<void>;
  onAddBlock: (kind: BlockKind, prompt: string, language: LanguageOption) => Promise<void>;
  /** Called when the user approves. Receives the chosen language override so the
   * caller can apply it to the TTS step (or 'auto' to fall back to voice profile). */
  onApprove: (language: LanguageOption) => void;
  onCancel: () => void;

  busy?: BusyState;
  /** Optional initial language pick from the pre-generation form. Default 'auto'. */
  initialLanguage?: LanguageOption;
}

const formatDuration = (sec: number | undefined): string => {
  if (!sec || sec <= 0) return '';
  if (sec < 60) return `~${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `~${m}m${s ? ` ${s}s` : ''}`;
};

export const ScriptPreviewPanel: React.FC<ScriptPreviewPanelProps> = ({
  mode,
  blocks,
  detectedHeader,
  onBlocksChange,
  onRegenerateAll,
  onRegenerateBlock,
  onAddBlock,
  onApprove,
  onCancel,
  busy,
  initialLanguage,
}) => {
  const [tone, setTone] = useState<ToneOption>('current');
  const [language, setLanguage] = useState<LanguageOption>(initialLanguage ?? 'auto');
  const [globalInstructions, setGlobalInstructions] = useState('');
  const [showRegenerateAllForm, setShowRegenerateAllForm] = useState(false);
  const [activeBlockRegenId, setActiveBlockRegenId] = useState<string | null>(null);
  const [blockInstructions, setBlockInstructions] = useState('');
  const [showAddBlockForm, setShowAddBlockForm] = useState(false);
  const [addBlockKind, setAddBlockKind] = useState<BlockKind>('avatar');
  const [addBlockPrompt, setAddBlockPrompt] = useState('');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragSourceRef = useRef<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const initialBlocksRef = useRef<string>(JSON.stringify(blocks.map(b => ({ kind: b.kind, text: b.text }))));

  const hasUnsavedEdits = (): boolean => {
    const current = JSON.stringify(blocks.map(b => ({ kind: b.kind, text: b.text })));
    return current !== initialBlocksRef.current;
  };

  // Reset initial snapshot whenever a fresh regeneration replaces all blocks.
  // We detect that by comparing length+ids; a same-length identical set of ids
  // means just an in-place edit.
  useEffect(() => {
    const sig = blocks.map(b => b.id).join('|');
    const prevSig = (initialBlocksRef as { _sig?: string })._sig ?? '';
    if (sig !== prevSig) {
      initialBlocksRef.current = JSON.stringify(blocks.map(b => ({ kind: b.kind, text: b.text })));
      (initialBlocksRef as { _sig?: string })._sig = sig;
    }
  }, [blocks]);

  const updateBlockText = (id: string, text: string) => {
    onBlocksChange(blocks.map(b => (b.id === id ? { ...b, text } : b)));
  };

  const toggleKind = (id: string) => {
    onBlocksChange(blocks.map(b => (b.id === id ? { ...b, kind: b.kind === 'avatar' ? 'broll' : 'avatar' } : b)));
  };

  const removeBlock = (id: string) => {
    onBlocksChange(blocks.filter(b => b.id !== id));
  };

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    dragSourceRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(idx);
  };

  const handleDragLeave = () => setDragOverIndex(null);

  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    setDragOverIndex(null);
    dragSourceRef.current = null;
    if (src == null || src === idx) return;
    const next = [...blocks];
    const [moved] = next.splice(src, 1);
    next.splice(idx, 0, moved);
    onBlocksChange(next);
  };

  const submitRegenerateAll = async () => {
    setShowRegenerateAllForm(false);
    await onRegenerateAll(globalInstructions, tone, language);
    setGlobalInstructions('');
  };

  const submitRegenerateBlock = async (id: string) => {
    setActiveBlockRegenId(null);
    const text = blockInstructions;
    setBlockInstructions('');
    await onRegenerateBlock(id, text, language);
  };

  const submitAddBlock = async () => {
    setShowAddBlockForm(false);
    const prompt = addBlockPrompt;
    setAddBlockPrompt('');
    await onAddBlock(addBlockKind, prompt, language);
  };

  const tryCancel = () => {
    if (hasUnsavedEdits() && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    onCancel();
  };

  const isBusyAll = busy?.kind === 'all';
  const isBusyAdd = busy?.kind === 'add';
  const blockBusy = (id: string) => busy?.kind === 'block' && busy.blockId === id;
  const anyBusy = !!busy;

  const avatarCount = blocks.filter(b => b.kind === 'avatar').length;
  const brollCount = blocks.length - avatarCount;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-semibold mb-1">
              ✨ Roteiro proposto
            </div>
            <div className="text-[13px] text-zinc-200 font-medium leading-snug mb-2">
              {mode === 'video' && 'Análise do vídeo de referência'}
              {mode === 'article' && 'Geração a partir do conteúdo'}
              {mode === 'script' && 'Segmentação do texto'}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[10.5px] text-zinc-400">
              {detectedHeader.format && (
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
                  {detectedHeader.format}
                </span>
              )}
              {detectedHeader.framework && (
                <span className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-200">
                  {detectedHeader.framework}
                </span>
              )}
              {detectedHeader.durationSec ? (
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
                  {formatDuration(detectedHeader.durationSec)}
                </span>
              ) : null}
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
                {blocks.length} blocos · {avatarCount} avatar / {brollCount} B-roll
              </span>
              {detectedHeader.language && (
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/5 font-mono">
                  {detectedHeader.language}
                </span>
              )}
            </div>
            {detectedHeader.hookStyle && (
              <div className="mt-2 text-[11px] text-zinc-500">
                <span className="text-zinc-600">Hook: </span>
                <span className="text-zinc-300 italic">"{detectedHeader.hookStyle}"</span>
              </div>
            )}
            {detectedHeader.rationale && (
              <div className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">
                {detectedHeader.rationale}
              </div>
            )}
          </div>
          <button
            onClick={tryCancel}
            disabled={anyBusy}
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40 shrink-0"
            title="Cancelar revisão"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Confirm cancel banner */}
        {confirmCancel && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/30 flex items-center gap-3">
            <span className="text-[11px] text-amber-200 flex-1">
              Você tem edições não aprovadas. Cancelar vai descartar tudo.
            </span>
            <button
              onClick={() => setConfirmCancel(false)}
              className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[10.5px] text-zinc-200"
            >
              Voltar
            </button>
            <button
              onClick={onCancel}
              className="px-2 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-[10.5px] text-red-100"
            >
              Descartar
            </button>
          </div>
        )}
      </div>

      {/* Tom */}
      <div className="px-6 pt-4 pb-2 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Tom</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {TONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTone(opt.value)}
              disabled={anyBusy}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all disabled:opacity-40 ${
                tone === opt.value
                  ? 'bg-violet-500/20 border border-violet-500/40 text-violet-100'
                  : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-2 text-[10px] text-zinc-600 italic">aplica ao regenerar</span>
        </div>
      </div>

      {/* Idioma */}
      <div className="px-6 pt-2 pb-3 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Idioma</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {LANGUAGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setLanguage(opt.value)}
              disabled={anyBusy}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all disabled:opacity-40 ${
                language === opt.value
                  ? 'bg-violet-500/20 border border-violet-500/40 text-violet-100'
                  : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-2 text-[10px] text-zinc-600 italic">
            {language === 'auto' ? 'usa o idioma do perfil' : 'sobrescreve o perfil'}
          </span>
        </div>
      </div>

      {/* Blocks */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-1 mb-2">Blocos</div>

        {blocks.map((b, i) => {
          const isAvatar = b.kind === 'avatar';
          const busyHere = blockBusy(b.id);
          const showRegen = activeBlockRegenId === b.id;
          return (
            <div
              key={b.id}
              draggable={!anyBusy}
              onDragStart={handleDragStart(i)}
              onDragOver={handleDragOver(i)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(i)}
              className={`relative px-3 py-2.5 rounded-lg border transition-all ${
                dragOverIndex === i
                  ? 'border-violet-400/50 bg-violet-500/5'
                  : 'border-white/5 bg-black/30'
              } ${busyHere ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-zinc-600 cursor-grab select-none text-sm" title="Arrastar para reordenar">⠿</span>
                <button
                  onClick={() => toggleKind(b.id)}
                  disabled={anyBusy}
                  className={`text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                    isAvatar
                      ? 'text-violet-200 bg-violet-500/15 hover:bg-violet-500/25'
                      : 'text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25'
                  }`}
                  title="Trocar entre Avatar e B-roll"
                >
                  {isAvatar ? '👤 Avatar' : '🖥️ B-roll'}
                </button>
                <span className="text-[9px] text-zinc-600 font-mono">#{i + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => {
                      setBlockInstructions('');
                      setActiveBlockRegenId(showRegen ? null : b.id);
                    }}
                    disabled={anyBusy}
                    className="p-1 rounded text-zinc-500 hover:text-violet-300 hover:bg-violet-500/10 transition-colors disabled:opacity-40"
                    title="Regenerar este bloco"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeBlock(b.id)}
                    disabled={anyBusy}
                    className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    title="Remover bloco"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <textarea
                value={b.text}
                onChange={e => updateBlockText(b.id, e.target.value)}
                disabled={busyHere}
                rows={2}
                className="w-full text-[12.5px] text-zinc-100 leading-relaxed bg-transparent outline-none resize-none placeholder:text-zinc-600"
                placeholder="(vazio)"
                style={{ minHeight: 36 }}
              />

              {busyHere && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
                  <div className="text-[11px] text-violet-300 animate-pulse">Regenerando bloco…</div>
                </div>
              )}

              {showRegen && !busyHere && (
                <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">O que mudar nesse bloco?</div>
                  <textarea
                    value={blockInstructions}
                    onChange={e => setBlockInstructions(e.target.value)}
                    rows={2}
                    placeholder="ex: mais provocativo, sem rodeios"
                    className="w-full text-[11px] bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-400/50"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    {REGEN_PRESETS.map(p => (
                      <button
                        key={p.label}
                        onClick={() => setBlockInstructions(prev => appendPreset(prev, p.phrase))}
                        className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-violet-500/15 border border-white/10 hover:border-violet-400/30 text-[10px] text-zinc-300 hover:text-violet-100"
                      >
                        + {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      onClick={() => {
                        setActiveBlockRegenId(null);
                        setBlockInstructions('');
                      }}
                      className="px-2 py-1 rounded text-[10.5px] text-zinc-400 hover:text-zinc-200"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => submitRegenerateBlock(b.id)}
                      className="px-2.5 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-[10.5px] font-semibold text-violet-100"
                    >
                      Regenerar →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add block button / inline form */}
        {!showAddBlockForm ? (
          <button
            onClick={() => {
              setAddBlockKind('avatar');
              setAddBlockPrompt('');
              setShowAddBlockForm(true);
            }}
            disabled={anyBusy}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-white/10 hover:border-violet-400/40 text-[11px] text-zinc-500 hover:text-violet-200 transition-colors disabled:opacity-40"
          >
            + Adicionar bloco com IA
          </button>
        ) : (
          <div className="px-3 py-2.5 rounded-lg border border-violet-400/30 bg-violet-500/5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">Novo bloco com IA</div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500">Tipo:</span>
              <button
                onClick={() => setAddBlockKind('avatar')}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  addBlockKind === 'avatar'
                    ? 'bg-violet-500/25 border border-violet-400/40 text-violet-100'
                    : 'bg-white/5 border border-white/10 text-zinc-400'
                }`}
              >
                👤 Avatar
              </button>
              <button
                onClick={() => setAddBlockKind('broll')}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  addBlockKind === 'broll'
                    ? 'bg-emerald-500/25 border border-emerald-400/40 text-emerald-100'
                    : 'bg-white/5 border border-white/10 text-zinc-400'
                }`}
              >
                🖥️ B-roll
              </button>
            </div>
            <textarea
              value={addBlockPrompt}
              onChange={e => setAddBlockPrompt(e.target.value)}
              rows={2}
              placeholder="Sobre o que? (opcional — deixa vazio pra preencher o gap entre vizinhos)"
              className="w-full text-[11px] bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-400/50"
            />
            <div className="flex items-center gap-1.5 justify-end">
              <button
                onClick={() => {
                  setShowAddBlockForm(false);
                  setAddBlockPrompt('');
                }}
                className="px-2 py-1 rounded text-[10.5px] text-zinc-400 hover:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={submitAddBlock}
                disabled={isBusyAdd}
                className="px-2.5 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-[10.5px] font-semibold text-violet-100 disabled:opacity-50"
              >
                {isBusyAdd ? 'Gerando…' : 'Gerar →'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-white/5 bg-black/30 shrink-0 space-y-2">
        {showRegenerateAllForm && !isBusyAll && (
          <div className="px-3 py-2.5 rounded-lg bg-black/40 border border-white/10 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">O que mudar no roteiro inteiro?</div>
            <textarea
              value={globalInstructions}
              onChange={e => setGlobalInstructions(e.target.value)}
              rows={2}
              placeholder="ex: mais direto, corta o final, foca só no problema"
              className="w-full text-[11px] bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-400/50"
            />
            <div className="flex items-center gap-1 flex-wrap">
              {REGEN_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setGlobalInstructions(prev => appendPreset(prev, p.phrase))}
                  className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-violet-500/15 border border-white/10 hover:border-violet-400/30 text-[10px] text-zinc-300 hover:text-violet-100"
                >
                  + {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              <button
                onClick={() => {
                  setShowRegenerateAllForm(false);
                  setGlobalInstructions('');
                }}
                className="px-2 py-1 rounded text-[10.5px] text-zinc-400 hover:text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={submitRegenerateAll}
                className="px-2.5 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-[10.5px] font-semibold text-violet-100"
              >
                Regenerar tudo →
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={tryCancel}
            disabled={anyBusy}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-zinc-300 transition-colors disabled:opacity-40"
          >
            ← Voltar
          </button>
          <button
            onClick={() => setShowRegenerateAllForm(s => !s)}
            disabled={anyBusy}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-zinc-300 transition-colors disabled:opacity-40"
          >
            {isBusyAll ? 'Regenerando…' : '↻ Refazer roteiro inteiro'}
          </button>
          <div className="flex-1"></div>
          <button
            onClick={() => onApprove(language)}
            disabled={anyBusy || blocks.length === 0}
            className="px-4 py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-[12px] font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Usar este roteiro →
          </button>
        </div>
      </div>
    </div>
  );
};
