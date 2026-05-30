import React, { useState, useRef } from 'react';
import {
  generateSpeech,
  saveClonedVoice,
  DEFAULT_VOICE_SETTINGS,
  type MinimaxCloneModel,
} from '../../services/minimaxService';

interface Props {
  onClose: () => void;
  onSaved: (voiceId: string) => void;
}

const MODELS: { id: MinimaxCloneModel; label: string; hint: string }[] = [
  { id: 'speech-02-hd',    label: 'speech-02-hd',    hint: 'Recomendado · qualidade máxima' },
  { id: 'speech-02-turbo', label: 'speech-02-turbo', hint: 'Mais rápido · custo menor' },
  { id: 'speech-01-hd',    label: 'speech-01-hd',    hint: 'Geração antiga · HD' },
  { id: 'speech-01-turbo', label: 'speech-01-turbo', hint: 'Geração antiga · turbo' },
];

const TEST_TEXT = 'Olá, isso é um teste da minha voz. Tudo certo?';

export const SaveVoiceModal: React.FC<Props> = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [model, setModel] = useState<MinimaxCloneModel>('speech-02-hd');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canSave = name.trim().length > 0 && voiceId.trim().length > 0;
  const canTest = voiceId.trim().length > 0 && !testing;

  const handleTest = async () => {
    setTesting(true);
    setTestResult('idle');
    setTestError(null);
    if (testUrl) URL.revokeObjectURL(testUrl);
    setTestUrl(null);
    try {
      const blob = await generateSpeech(TEST_TEXT, voiceId.trim(), DEFAULT_VOICE_SETTINGS, 'Portuguese');
      const url = URL.createObjectURL(blob);
      setTestUrl(url);
      setTestResult('success');
      // Auto-play preview
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      setTestResult('error');
      setTestError(err instanceof Error ? err.message : 'Falha ao testar');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const now = Date.now();
    saveClonedVoice({
      id: `local_${now}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      voiceId: voiceId.trim(),
      previewUrl: testUrl ?? undefined,
      model,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
    onSaved(voiceId.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Salvar voz do Minimax</div>
            <div className="text-xs text-zinc-500">Cole o voice_id que você já tem e dê um nome.</div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 pb-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Nome</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Rob, Minha voz, Voz do podcast..."
              className="mt-1 w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-violet-400/50 transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Voice ID</label>
            <input
              value={voiceId}
              onChange={e => { setVoiceId(e.target.value); setTestResult('idle'); }}
              placeholder="Cole aqui o voice_id do Minimax"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-violet-400/50 transition-colors font-mono"
            />
            <div className="mt-1 text-[10px] text-zinc-600">Geralmente começa com letras maiúsculas/números. Ex: <span className="font-mono text-zinc-400">moss_audio_xxxxxxxx</span></div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Modelo</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`px-2 py-2 rounded-lg border text-left transition-colors ${
                    model === m.id
                      ? 'bg-violet-500/15 border-violet-400/50 text-violet-200'
                      : 'bg-black/20 border-white/10 text-zinc-400 hover:border-white/20'
                  }`}
                >
                  <div className="text-[11px] font-medium font-mono">{m.label}</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Test panel */}
        <div className="px-6 py-4 bg-black/30 border-y border-white/5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-zinc-400 font-medium">Testar antes de salvar</div>
            <button
              onClick={handleTest}
              disabled={!canTest}
              className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? '⏳ Gerando...' : '▶ Testar voz'}
            </button>
          </div>
          <div className="text-[10px] text-zinc-500 italic">"{TEST_TEXT}"</div>
          {testResult === 'success' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                Funcionou
              </span>
              <audio ref={audioRef} controls className="flex-1 h-7" style={{ filter: 'invert(1) hue-rotate(180deg)' }} />
            </div>
          )}
          {testResult === 'error' && (
            <div className="mt-2 text-[10px] text-red-400">⚠ {testError}</div>
          )}
        </div>

        <div className="px-6 py-4 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Salvar voz
          </button>
        </div>
      </div>
    </div>
  );
};
