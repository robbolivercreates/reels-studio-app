import React, { useEffect, useRef, useState } from 'react';
import {
  ensureProfiles,
  upsertProfile,
  deleteProfile,
  setActiveProfileId,
  createBlankProfile,
  REWRITE_LABELS,
  LANGUAGE_OPTIONS,
  SIMPLICITY_LABELS,
  VOICE_DOC_MAX_CHARS,
  EXTRA_INSTRUCTIONS_MAX_CHARS,
  VOICE_DOC_TEMPLATE,
  VOZ_ROB_BOLIVER,
  type VoiceProfile,
  type RewriteLevel,
  type OutputLanguage,
  type LanguageSimplicity,
} from './voiceProfile';

interface Props {
  /** Called whenever the active profile changes (id or content). Modal uses this. */
  onActiveChange?: (profile: VoiceProfile) => void;
  onClose: () => void;
}

const REWRITE_ORDER: RewriteLevel[] = ['faithful', 'translate', 'adapt', 'reimagine'];

export const VoiceProfilesPanel: React.FC<Props> = ({ onActiveChange, onClose }) => {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const { profiles, activeId } = ensureProfiles();
    setProfiles(profiles);
    setActiveId(activeId);
    const active = profiles.find(p => p.id === activeId);
    if (active && onActiveChange) onActiveChange(active);
    // Open the first edit on mount so the panel always shows something useful.
    setEditing(active ?? profiles[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    const { profiles, activeId } = ensureProfiles();
    setProfiles(profiles);
    setActiveId(activeId);
  };

  const handleSelectActive = (id: string) => {
    setActiveProfileId(id);
    setActiveId(id);
    const next = profiles.find(p => p.id === id);
    if (next && onActiveChange) onActiveChange(next);
    setEditing(next ?? null);
  };

  const handleSave = () => {
    if (!editing) return;
    const next = upsertProfile(editing);
    setProfiles(next);
    if (editing.id === activeId && onActiveChange) onActiveChange(editing);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleNew = () => {
    const fresh = createBlankProfile(`Novo perfil ${profiles.length + 1}`);
    const next = upsertProfile(fresh);
    setProfiles(next);
    setEditing(fresh);
  };

  const handleDelete = (id: string) => {
    if (profiles.length <= 1) return;
    if (!confirm('Apagar este perfil?')) return;
    const next = deleteProfile(id);
    setProfiles(next);
    refresh();
    setEditing(next[0] ?? null);
  };

  const handleLoadMd = async (file: File) => {
    if (!editing) return;
    const text = await file.text();
    const trimmed = text.length > VOICE_DOC_MAX_CHARS ? text.slice(0, VOICE_DOC_MAX_CHARS) : text;
    setEditing({ ...editing, voiceDoc: trimmed });
  };

  const patch = <K extends keyof VoiceProfile>(key: K, value: VoiceProfile[K]) => {
    if (!editing) return;
    setEditing({ ...editing, [key]: value });
  };

  if (!editing) return null;

  return (
    <div className="flex h-[520px]">
      {/* Sidebar — list of profiles */}
      <div className="w-44 shrink-0 border-r border-white/5 bg-black/20 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Perfis</span>
          <button onClick={handleNew} className="text-zinc-400 hover:text-zinc-200 text-xs" title="Novo perfil">＋</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {profiles.map(p => (
            <div
              key={p.id}
              onClick={() => setEditing(p)}
              className={`px-3 py-2 cursor-pointer flex items-center gap-2 group transition-colors ${
                editing.id === p.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
              }`}
            >
              <button
                onClick={e => { e.stopPropagation(); handleSelectActive(p.id); }}
                className={`w-3 h-3 rounded-full shrink-0 border transition-colors ${
                  activeId === p.id ? 'bg-violet-500 border-violet-300' : 'border-zinc-600 hover:border-zinc-400'
                }`}
                title={activeId === p.id ? 'Perfil ativo' : 'Ativar este perfil'}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-200 truncate">{p.name}</div>
                <div className="text-[9px] text-zinc-500 truncate">
                  {p.outputLanguage === 'source' ? 'idioma original' : p.outputLanguage} · {REWRITE_LABELS[p.rewriteLevel].label.toLowerCase()}
                </div>
              </div>
              {profiles.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-300 text-[10px]"
                  title="Apagar perfil"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <input
            value={editing.name}
            onChange={e => patch('name', e.target.value)}
            placeholder="Nome do perfil"
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-violet-400/50"
          />
          {activeId !== editing.id && (
            <button
              onClick={() => handleSelectActive(editing.id)}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-zinc-300"
            >
              Ativar
            </button>
          )}
        </div>

        {/* Language */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Idioma de saída
          </label>
          <select
            value={editing.outputLanguage}
            onChange={e => patch('outputLanguage', e.target.value as OutputLanguage)}
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-violet-400/50"
          >
            {LANGUAGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="text-[10px] text-zinc-500 mt-1">
            O áudio é gerado pelo Minimax HD 2.8 — texto é otimizado pra ouvido (números por extenso, sem símbolos).
          </div>
        </div>

        {/* Rewrite level */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Nível de reescrita
          </label>
          <div className="grid grid-cols-2 gap-2">
            {REWRITE_ORDER.map(level => (
              <button
                key={level}
                onClick={() => patch('rewriteLevel', level)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  editing.rewriteLevel === level
                    ? 'bg-violet-500/15 border-violet-500/40'
                    : 'bg-black/20 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="text-xs font-medium text-zinc-100">{REWRITE_LABELS[level].label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{REWRITE_LABELS[level].hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Simple language */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Simplicidade da linguagem
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['default', 'simple', 'very-simple'] as LanguageSimplicity[]).map(level => (
              <button
                key={level}
                onClick={() => patch('simpleLanguage', level)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  editing.simpleLanguage === level
                    ? 'bg-violet-500/15 border-violet-500/40'
                    : 'bg-black/20 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="text-xs font-medium text-zinc-100">{SIMPLICITY_LABELS[level].label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{SIMPLICITY_LABELS[level].hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Extra instructions */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Instruções extras pro Gemini
          </label>
          <textarea
            value={editing.extraInstructions}
            onChange={e => patch('extraInstructions', e.target.value.slice(0, EXTRA_INSTRUCTIONS_MAX_CHARS))}
            rows={3}
            placeholder='Ex: "Comece sempre com uma pergunta direta. Use tu, não você. Termine com `salva e segue` em vez de `like e share`."'
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-400/50 leading-relaxed resize-y"
          />
          <div className="flex justify-end text-[9px] text-zinc-600 font-mono mt-0.5">
            {editing.extraInstructions.length} / {EXTRA_INSTRUCTIONS_MAX_CHARS}
          </div>
        </div>

        {/* Voice doc */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Documento de voz (Markdown)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (editing.voiceDoc.trim().length > 0 && !confirm('Substituir o conteúdo atual pela Voz do Rob?')) return;
                  setEditing({ ...editing, voiceDoc: VOZ_ROB_BOLIVER });
                }}
                className="text-[10px] text-emerald-300 hover:text-emerald-200 underline font-medium"
                title="Carrega a voz do Rob Boliver (verbatim, com hooks, CTAs e bordões reais)"
              >
                🎤 Voz do Rob
              </button>
              <button
                onClick={() => {
                  if (editing.voiceDoc.trim().length > 0 && !confirm('Substituir o conteúdo atual pelo template em branco?')) return;
                  setEditing({ ...editing, voiceDoc: VOICE_DOC_TEMPLATE });
                }}
                className="text-[10px] text-violet-300 hover:text-violet-200 underline"
                title="Esqueleto vazio pra preencher com sua própria voz"
              >
                📝 Template em branco
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([editing.voiceDoc || VOICE_DOC_TEMPLATE], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `voz-${editing.name.replace(/[\/\\:*?"<>|]+/g, '_').trim() || 'perfil'}.md`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1500);
                }}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
              >
                ⬇ Baixar
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
              >
                📄 Carregar .md
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleLoadMd(f); }}
              />
            </div>
          </div>
          <textarea
            value={editing.voiceDoc}
            onChange={e => patch('voiceDoc', e.target.value.slice(0, VOICE_DOC_MAX_CHARS))}
            rows={12}
            placeholder="Clique em 📝 Inserir template pra começar com a estrutura recomendada, ou cole seu próprio doc."
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-zinc-100 outline-none focus:border-violet-400/50 leading-relaxed resize-y"
          />
          <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-0.5">
            <span>Quanto mais específico (com exemplos REAIS de reels seus), melhor o resultado.</span>
            <span>{editing.voiceDoc.length} / {VOICE_DOC_MAX_CHARS}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
          <button
            onClick={handleSave}
            className="flex-1 py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.4)] transition-all"
          >
            {savedFlash ? '✓ Salvo' : 'Salvar perfil'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-300"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
};
