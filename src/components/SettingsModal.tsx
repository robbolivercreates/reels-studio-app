import React, { useState, useEffect } from 'react';
import { VoiceProfilesPanel } from './reelsStudio/VoiceProfilesPanel';
import { confirmDialog } from './reelsStudio/confirmService';
import type { AppTheme } from './reelsStudio/types';
import { useModalChrome } from './reelsStudio/modalChrome';
import {
  loadClonedVoices,
  saveClonedVoice,
  deleteClonedVoice,
  type ClonedVoice,
  type MinimaxCloneModel,
} from '../services/minimaxService';
import { AgentSettingsTab } from './agent/AgentSettingsTab';
import { loadUserIdentity, saveUserIdentity, type UserIdentity } from './reelsStudio/userIdentity';
import {
  SUPPORTED_MOTION_MODELS,
  DEFAULT_MOTION_MODEL,
  MOTION_MODEL_STORAGE_KEY,
  type MotionModelId,
} from '../services/motionService';

const MOTION_MODEL_OPTIONS: { id: MotionModelId; label: string; hint: string }[] = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash',         hint: 'recomendado · stable · rápido' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview',   hint: 'qualidade máxima · preview' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview',   hint: 'mais barato · preview' },
];

export type SettingsTab = 'api-keys' | 'voice' | 'voices' | 'agents' | 'identity';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  initialTab?: SettingsTab;
  onVoiceProfileChange?: () => void;
  /** Called whenever the saved-voices list changes so the voice picker refreshes. */
  onClonedVoicesChange?: () => void;
  appTheme?: AppTheme;
}

interface KeyConfig {
  storageKey: string;
  label: string;
  placeholder: string;
  hint: string;
  required: boolean;
  helpUrl?: string;
  validate?: (key: string) => Promise<{ ok: boolean; message: string }>;
}

const validateFalKey = async (key: string): Promise<{ ok: boolean; message: string }> => {
  try {
    // fal doesn't have a clean health endpoint, so call the queue status
    // for a known model. 401/403 = bad key, anything else = key works.
    const res = await fetch('https://queue.fal.run/health', {
      method: 'GET',
      headers: { 'Authorization': `Key ${key}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Chave rejeitada (401/403)' };
    return { ok: true, message: 'Chave aceita' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Erro de rede' };
  }
};

const validateGoogleKey = async (key: string): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: 'GET' },
    );
    if (res.status === 200) return { ok: true, message: 'Chave aceita · Gemini disponível' };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, message: `Chave rejeitada (${res.status})` };
    }
    return { ok: false, message: `Resposta inesperada (${res.status})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Erro de rede' };
  }
};

const validateHeyGenKey = async (key: string): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch('https://api.heygen.com/v1/voice.list', {
      method: 'GET',
      headers: { 'X-Api-Key': key },
    });
    if (res.status === 200) return { ok: true, message: 'Chave aceita · HeyGen acessível' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Chave rejeitada (${res.status})` };
    return { ok: false, message: `Resposta inesperada (${res.status})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Erro de rede' };
  }
};

const KEYS: KeyConfig[] = [
  {
    storageKey: 'FAL_KEY',
    label: 'fal.ai API Key',
    placeholder: 'fal-...',
    hint: 'Para Minimax (TTS) e upload de áudio.',
    required: true,
    helpUrl: 'https://fal.ai/dashboard/keys',
    validate: validateFalKey,
  },
  {
    storageKey: 'GOOGLE_API_KEY',
    label: 'Google AI Studio API Key',
    placeholder: 'AIza...',
    hint: 'Para roteiro com IA, motion graphics e brand research (Gemini 3.1).',
    required: true,
    helpUrl: 'https://aistudio.google.com/app/apikey',
    validate: validateGoogleKey,
  },
  {
    storageKey: 'HEYGEN_API_KEY',
    label: 'HeyGen API Key',
    placeholder: '...',
    hint: 'Para gerar clipes de avatar (Avatar 4).',
    required: true,
    helpUrl: 'https://app.heygen.com/settings?nav=api',
    validate: validateHeyGenKey,
  },
];

const maskKey = (key: string): string => {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 24)) + key.slice(-4);
};

type ValidationState = 'idle' | 'validating' | 'ok' | 'error';

interface FieldState {
  value: string;
  editing: boolean;
  visible: boolean;
  validation: ValidationState;
  validationMessage: string;
}

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialTab = 'api-keys', onVoiceProfileChange, onClonedVoicesChange, appTheme }) => {
  const chrome = useModalChrome(appTheme);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  // Vozes tab state.
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>(() => loadClonedVoices());
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceId, setNewVoiceId] = useState('');
  const [newVoiceModel, setNewVoiceModel] = useState<MinimaxCloneModel>('speech-02-hd');
  const [voiceFormError, setVoiceFormError] = useState<string | null>(null);

  // Motion HTML generation model — read on open, persisted on Salvar.
  const [motionModel, setMotionModel] = useState<MotionModelId>(DEFAULT_MOTION_MODEL);
  const [allowProFallback, setAllowProFallback] = useState(false);
  const [brandResearchEnabled, setBrandResearchEnabled] = useState(false);

  const refreshClonedVoices = () => setClonedVoices(loadClonedVoices());

  // Creator identity (used by social CTA motions — follow card etc).
  const [identity, setIdentity] = useState<UserIdentity>(() => loadUserIdentity());
  const [identitySaved, setIdentitySaved] = useState(false);
  const patchIdentity = (patch: Partial<UserIdentity>) => {
    setIdentity(prev => ({ ...prev, ...patch }));
    setIdentitySaved(false);
  };
  const handleIdentitySave = () => {
    saveUserIdentity(identity);
    setIdentitySaved(true);
  };
  const handleAvatarUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Imagem maior que 2MB. Use uma foto menor.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') patchIdentity({ avatarDataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const handleAddVoice = () => {
    const name = newVoiceName.trim();
    const voiceId = newVoiceId.trim();
    if (!name) { setVoiceFormError('Dê um nome pra essa voz.'); return; }
    if (!voiceId) { setVoiceFormError('Cole o voice_id do Minimax.'); return; }
    if (clonedVoices.some(v => v.voiceId === voiceId)) {
      setVoiceFormError('Já tem uma voz com esse ID salva.');
      return;
    }
    const now = Date.now();
    saveClonedVoice({
      id: `manual-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      voiceId,
      model: newVoiceModel,
      createdAt: now,
      expiresAt: now + 365 * 24 * 60 * 60 * 1000, // 1 year — manually-added voices don't expire by usage
    });
    refreshClonedVoices();
    onClonedVoicesChange?.();
    setNewVoiceName('');
    setNewVoiceId('');
    setVoiceFormError(null);
  };

  const handleDeleteVoice = async (id: string, name: string) => {
    if (!(await confirmDialog(`Remover "${name}" da lista?`))) return;
    deleteClonedVoice(id);
    refreshClonedVoices();
    onClonedVoicesChange?.();
  };

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    refreshClonedVoices();
    setIdentity(loadUserIdentity());
    setIdentitySaved(false);
    const next: Record<string, FieldState> = {};
    for (const k of KEYS) {
      const stored = localStorage.getItem(k.storageKey) ?? '';
      next[k.storageKey] = {
        value: stored,
        editing: !stored, // start in edit mode if no key yet
        visible: false,
        validation: 'idle',
        validationMessage: '',
      };
    }
    setFields(next);
    // Motion model preference.
    const storedModel = localStorage.getItem(MOTION_MODEL_STORAGE_KEY);
    setMotionModel(
      storedModel && (SUPPORTED_MOTION_MODELS as readonly string[]).includes(storedModel)
        ? (storedModel as MotionModelId)
        : DEFAULT_MOTION_MODEL,
    );
    setAllowProFallback(localStorage.getItem('ALLOW_PRO_FALLBACK') === 'true');
    setBrandResearchEnabled(localStorage.getItem('BRAND_RESEARCH_ENABLED') === 'true');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const isVoice = activeTab === 'voice';
  const isVoices = activeTab === 'voices';
  const isAgents = activeTab === 'agents';
  const isIdentity = activeTab === 'identity';
  const widthClass = isVoice ? 'max-w-5xl' : 'max-w-lg';

  const patchField = (storageKey: string, patch: Partial<FieldState>) => {
    setFields(prev => ({ ...prev, [storageKey]: { ...prev[storageKey], ...patch } }));
  };

  const canSave = KEYS.filter(k => k.required).every(k => fields[k.storageKey]?.value?.trim().length > 0);

  const handleSave = () => {
    for (const k of KEYS) {
      const v = fields[k.storageKey]?.value?.trim();
      if (v) localStorage.setItem(k.storageKey, v);
      else localStorage.removeItem(k.storageKey);
    }
    // Persist motion model preference. Default is also explicitly written so
    // a downgrade from a non-default + Salvar takes effect immediately.
    localStorage.setItem(MOTION_MODEL_STORAGE_KEY, motionModel);
    localStorage.setItem('ALLOW_PRO_FALLBACK', allowProFallback ? 'true' : 'false');
    localStorage.setItem('BRAND_RESEARCH_ENABLED', brandResearchEnabled ? 'true' : 'false');
    onSave();
  };

  const handleValidate = async (k: KeyConfig) => {
    const v = fields[k.storageKey]?.value?.trim();
    if (!v) return;
    if (!k.validate) {
      patchField(k.storageKey, { validation: 'ok', validationMessage: 'Chave salva.' });
      return;
    }
    patchField(k.storageKey, { validation: 'validating', validationMessage: 'Testando…' });
    try {
      const result = await k.validate(v);
      patchField(k.storageKey, {
        validation: result.ok ? 'ok' : 'error',
        validationMessage: result.message,
      });
    } catch (e) {
      patchField(k.storageKey, {
        validation: 'error',
        validationMessage: e instanceof Error ? e.message : 'Erro desconhecido',
      });
    }
  };

  const handleClear = async (k: KeyConfig) => {
    if (!(await confirmDialog(`Remover a chave ${k.label}?`))) return;
    patchField(k.storageKey, { value: '', editing: true, validation: 'idle', validationMessage: '' });
  };

  const tabBtn = (id: SettingsTab, label: string) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
        activeTab === id
          ? 'bg-blue-500/20 border border-blue-500/40 text-blue-100'
          : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[100] p-6" style={chrome.backdrop}>
      <div className={`rounded-2xl ${widthClass} w-full overflow-hidden flex flex-col max-h-[90vh]`} style={chrome.card}>
        <div className="px-6 pt-6 pb-3 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Configurações</div>
            <div className="text-xs text-zinc-500">
              {isVoice
                ? 'Estilo de escrita aplicado em todo roteiro gerado por IA.'
                : isVoices
                  ? 'Adicione vozes do Minimax usando voice_id. Aparecem no seletor de voz junto com as clonadas.'
                  : isAgents
                    ? 'Conecte o Claude Code para conversar com seu projeto via chat. Usa sua assinatura — não precisa de chave de API.'
                    : 'Suas chaves ficam salvas localmente — nunca saem do app.'}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-3 flex items-center gap-2 border-b border-white/5">
          {tabBtn('api-keys', 'Chaves de API')}
          {tabBtn('identity', 'Identidade')}
          {tabBtn('voice', 'Voz e estilo')}
          {tabBtn('voices', `Vozes${clonedVoices.length > 0 ? ` (${clonedVoices.length})` : ''}`)}
          {tabBtn('agents', 'Agents')}
        </div>

        {isAgents ? (
          <>
          <AgentSettingsTab />
          <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
          </div>
          </>
        ) : isIdentity ? (
          <>
          <div className="px-6 pt-4 pb-4 flex-1 overflow-y-auto space-y-5">
            <div className="text-xs leading-relaxed text-zinc-400">
              Sua identidade nas redes — aparece nos motions de CTA tipo "siga @perfil" no fim do reel.
              Salva no dispositivo, vale pra todos os projetos.
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="flex items-start gap-4">
                {/* Avatar preview + upload */}
                <div className="shrink-0">
                  <label className="cursor-pointer group">
                    <div
                      className="w-20 h-20 rounded-full border-2 border-dashed border-white/20 group-hover:border-blue-400 flex items-center justify-center overflow-hidden bg-white/5 transition-colors"
                      title="Clique pra escolher uma foto"
                    >
                      {identity.avatarDataUrl ? (
                        <img src={identity.avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-zinc-500 text-center px-2">
                          Foto<br/>de perfil
                        </span>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }}
                    />
                  </label>
                  {identity.avatarDataUrl && (
                    <button
                      onClick={() => patchIdentity({ avatarDataUrl: undefined })}
                      className="mt-1 w-full text-[9px] text-zinc-500 hover:text-red-300 transition-colors"
                    >
                      Remover
                    </button>
                  )}
                </div>

                <div className="flex-1 space-y-2.5">
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">Nome de exibição</label>
                    <input
                      value={identity.displayName}
                      onChange={e => patchIdentity({ displayName: e.target.value })}
                      placeholder="Rob Boliver"
                      className="w-full px-3 py-1.5 rounded bg-black/30 border border-white/10 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1 block">@ do perfil</label>
                    <input
                      value={identity.handle}
                      onChange={e => patchIdentity({ handle: e.target.value })}
                      placeholder="robboliver"
                      className="w-full px-3 py-1.5 rounded bg-black/30 border border-white/10 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-400 focus:outline-none font-mono"
                    />
                    <div className="text-[9px] text-zinc-600 mt-1">O "@" é adicionado automaticamente.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">Plataforma principal</label>
                      <select
                        value={identity.primaryPlatform ?? 'instagram'}
                        onChange={e => patchIdentity({ primaryPlatform: e.target.value as UserIdentity['primaryPlatform'] })}
                        className="w-full px-2 py-1.5 rounded bg-black/30 border border-white/10 text-xs text-zinc-200 focus:border-blue-400 focus:outline-none"
                      >
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="youtube">YouTube</option>
                        <option value="generic">Outra</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">Seguidores <span className="opacity-60">(opcional)</span></label>
                      <input
                        value={identity.followerCount ?? ''}
                        onChange={e => patchIdentity({ followerCount: e.target.value || undefined })}
                        placeholder="12.4K"
                        className="w-full px-3 py-1.5 rounded bg-black/30 border border-white/10 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-400 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-apply follow CTA toggle. When on, every export auto-injects
                the social-cta-follow preset into the last block — saves the
                user from doing it manually on every reel. */}
            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 cursor-pointer hover:bg-white/[0.05] transition-colors">
              <input
                type="checkbox"
                checked={identity.autoFollowCta ?? true}
                onChange={e => patchIdentity({ autoFollowCta: e.target.checked })}
                className="mt-0.5 accent-blue-400"
              />
              <div className="flex-1">
                <div className="text-xs font-medium text-zinc-200">Card "siga @perfil" no final do reel</div>
                <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                  Aplica automaticamente o template Social Follow no último bloco usando os dados acima.
                  Desligue se quiser controle manual bloco a bloco.
                </div>
              </div>
            </label>

            {/* Live preview of the follow card so the user sees what motions will render. */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Como vai aparecer no motion</div>
              <div className="rounded-lg bg-gradient-to-br from-zinc-900 to-black p-4 flex items-center justify-center">
                <div className="bg-[#1a1a1a] rounded-full px-3 py-2 pr-3 flex items-center gap-3 shadow-lg">
                  <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-zinc-600 to-zinc-800 shrink-0">
                    {identity.avatarDataUrl ? (
                      <img src={identity.avatarDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-zinc-400 text-sm">👤</div>
                    )}
                  </div>
                  <div className="min-w-[120px]">
                    <div className="text-white text-xs font-semibold leading-tight">{identity.displayName || 'Seu nome'}</div>
                    <div className="text-zinc-500 text-[10px] leading-tight">@{(identity.handle.trim().replace(/^@+/, '') || 'seu.perfil')}</div>
                  </div>
                  <div
                    className="text-white text-[11px] font-semibold px-3 py-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        identity.primaryPlatform === 'tiktok' ? '#fe2c55'
                        : identity.primaryPlatform === 'youtube' ? '#ff0000'
                        : identity.primaryPlatform === 'instagram' ? '#0095f6'
                        : '#888',
                    }}
                  >
                    Seguir
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2 items-center">
            {identitySaved && <span className="text-[11px] text-emerald-400">✓ Salvo</span>}
            <button onClick={onClose} className="ml-auto py-2.5 px-4 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
            <button
              onClick={handleIdentitySave}
              className="py-2.5 px-5 rounded-lg bg-blue-500 hover:bg-blue-400 text-xs font-semibold text-white transition-colors"
            >
              Salvar
            </button>
          </div>
          </>
        ) : isVoice ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <VoiceProfilesPanel
              onActiveChange={() => onVoiceProfileChange?.()}
              onClose={onClose}
            />
          </div>
        ) : isVoices ? (
          <>
          <div className="px-6 pt-4 pb-4 flex-1 overflow-y-auto space-y-5">

            {/* Add-voice form */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Adicionar voz</div>

              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Nome (como vai aparecer no seletor)</label>
                <input
                  value={newVoiceName}
                  onChange={e => setNewVoiceName(e.target.value)}
                  placeholder="Ex: Marina narradora"
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-blue-400/50 transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">voice_id do Minimax</label>
                <input
                  value={newVoiceId}
                  onChange={e => setNewVoiceId(e.target.value)}
                  placeholder="custom_voice_xxxxxxxxxxxx"
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-blue-400/50 transition-colors font-mono"
                />
                <div className="mt-1 text-[10px] text-zinc-600">
                  O ID que o Minimax retorna ao clonar uma voz. Aceita IDs próprios (do fal.ai) ou IDs públicos do catálogo Minimax.
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Modelo</label>
                <select
                  value={newVoiceModel}
                  onChange={e => setNewVoiceModel(e.target.value as MinimaxCloneModel)}
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-blue-400/50"
                >
                  <option value="speech-02-hd">speech-02-hd · qualidade máxima (recomendado)</option>
                  <option value="speech-02-turbo">speech-02-turbo · mais rápido</option>
                  <option value="speech-01-hd">speech-01-hd · legado</option>
                  <option value="speech-01-turbo">speech-01-turbo · legado rápido</option>
                </select>
              </div>

              {voiceFormError && (
                <div className="text-[10.5px] text-red-300">⚠ {voiceFormError}</div>
              )}

              <button
                onClick={handleAddVoice}
                className="w-full py-2 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white transition-all"
              >
                Salvar voz
              </button>
            </div>

            {/* Saved voices list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Vozes salvas</div>
                <div className="text-[10px] text-zinc-600">{clonedVoices.length} no total</div>
              </div>
              {clonedVoices.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-zinc-500 border border-dashed border-white/10 rounded-lg">
                  Nenhuma voz salva ainda. Use o formulário acima.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                  {clonedVoices.map(v => (
                    <div key={v.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                        {v.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium text-zinc-100 truncate">{v.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate" title={v.voiceId}>{v.voiceId}</div>
                      </div>
                      <div className="text-[9.5px] text-zinc-600 shrink-0 hidden sm:block">{v.model}</div>
                      <button
                        onClick={() => { void navigator.clipboard.writeText(v.voiceId); }}
                        className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 shrink-0"
                        title="Copiar voice_id"
                      >
                        copiar
                      </button>
                      <button
                        onClick={() => handleDeleteVoice(v.id, v.name)}
                        className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-zinc-400 shrink-0"
                        title="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
          </div>
          </>
        ) : (
        <>
        <div className="px-6 pt-4 pb-2 flex-1 overflow-y-auto space-y-5">
          {/* Motion model selector — sits above the API keys because it's
              the most frequently-touched preference once keys are configured. */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Modelo de Motion
              </label>
            </div>
            <select
              value={motionModel}
              onChange={e => setMotionModel(e.target.value as MotionModelId)}
              className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-blue-400/50 transition-colors"
            >
              {MOTION_MODEL_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} · {opt.hint}
                </option>
              ))}
            </select>
             <div className="mt-1.5 text-[10px] text-zinc-600 mb-2">
              Aplica nos próximos motions gerados. Em caso de erro, o app cai automaticamente nos outros modelos.
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer py-1 mt-2.5">
              <input
                type="checkbox"
                checked={allowProFallback}
                onChange={e => setAllowProFallback(e.target.checked)}
                className="mt-0.5 accent-blue-400 shrink-0"
              />
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-200">Permitir Fallback para Gemini Pro</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
                  Se desativado, o app usará apenas modelos Flash mais baratos, impedindo gastos altos acidentais.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer py-1 mt-1.5">
              <input
                type="checkbox"
                checked={brandResearchEnabled}
                onChange={e => setBrandResearchEnabled(e.target.checked)}
                className="mt-0.5 accent-blue-400 shrink-0"
              />
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-zinc-200">Pesquisa de marca via Google (custo extra)</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
                  Desligado por padrão: logos reais e cores oficiais das ~35 marcas mapeadas já vêm de graça.
                  Ligue só pra marcas obscuras — usa Gemini com Google Search (2–3× o custo) no 1º motion de cada reel.
                </div>
              </div>
            </label>
          </div>

          {KEYS.map(k => {
            const f = fields[k.storageKey] ?? { value: '', editing: true, visible: false, validation: 'idle' as ValidationState, validationMessage: '' };
            const hasStored = !!localStorage.getItem(k.storageKey);
            const validationDot = f.validation === 'ok' ? 'bg-emerald-400' : f.validation === 'error' ? 'bg-red-400' : f.validation === 'validating' ? 'bg-amber-400 animate-pulse' : '';
            const validationCls = f.validation === 'ok' ? 'text-emerald-300' : f.validation === 'error' ? 'text-red-300' : 'text-zinc-400';
            return (
              <div key={k.storageKey}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    {k.label}
                    {k.required && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  {validationDot && <span className={`w-1.5 h-1.5 rounded-full ${validationDot}`}></span>}
                  <div className="ml-auto flex items-center gap-2">
                    {k.helpUrl && (
                      <a
                        href={k.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-blue-300 hover:text-blue-200"
                      >
                        pegar →
                      </a>
                    )}
                  </div>
                </div>

                {f.editing ? (
                  <input
                    type={f.visible ? 'text' : 'password'}
                    value={f.value}
                    onChange={e => patchField(k.storageKey, { value: e.target.value, validation: 'idle', validationMessage: '' })}
                    placeholder={k.placeholder}
                    className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-blue-400/50 transition-colors font-mono"
                  />
                ) : (
                  <div className="w-full px-3 py-2 rounded-lg bg-black/20 border border-white/5 text-sm text-zinc-300 font-mono flex items-center justify-between">
                    <span className="truncate">{f.visible ? f.value : maskKey(f.value)}</span>
                    {!f.value && <span className="text-zinc-600 italic">não configurada</span>}
                  </div>
                )}

                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <div className="text-[10px] text-zinc-600 flex-1 min-w-0">{k.hint}</div>

                  {f.value && (
                    <button
                      onClick={() => patchField(k.storageKey, { visible: !f.visible })}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {f.visible ? 'esconder' : 'ver'}
                    </button>
                  )}

                  {!f.editing && f.value && (
                    <button
                      onClick={() => patchField(k.storageKey, { editing: true })}
                      className="text-[10px] text-blue-300 hover:text-blue-200 transition-colors"
                    >
                      editar
                    </button>
                  )}

                  {f.editing && hasStored && f.value === (localStorage.getItem(k.storageKey) ?? '') && (
                    <button
                      onClick={() => patchField(k.storageKey, { editing: false, visible: false })}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      cancelar
                    </button>
                  )}

                  {f.value && (
                    <button
                      onClick={() => handleValidate(k)}
                      disabled={f.validation === 'validating'}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-200 transition-colors disabled:opacity-50"
                    >
                      {f.validation === 'validating' ? 'testando…' : 'testar'}
                    </button>
                  )}

                  {f.value && (
                    <button
                      onClick={() => handleClear(k)}
                      className="text-[10px] text-red-400/70 hover:text-red-300 transition-colors"
                    >
                      remover
                    </button>
                  )}
                </div>

                {f.validationMessage && (
                  <div className={`mt-1.5 text-[10.5px] ${validationCls}`}>
                    {f.validation === 'ok' && '✓ '}
                    {f.validation === 'error' && '⚠ '}
                    {f.validationMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Salvar
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
