/**
 * GuidedWizard — the LIGHT 3-step creation modal for "Novo projeto".
 *
 * conteudo → roteiro & avatar → voz, then drops blocks on the timeline via
 * onConfirm. Deliberately light (a modal, not an app): it collects only the
 * globally-relevant, cheap decisions (script, avatar identity, voice). It does
 * NOT generate audio, NOT pick a per-block style, and NOT embed the full agent
 * (those live on the timeline — avoids duplication).
 *
 * Reuses the existing import services rather than reinventing them:
 *  - text     → importScriptWithAI (scriptImporter.ts)
 *  - artigo   → fetchArticleFromUrl + generateReelFromContent (scriptFromContentService)
 *  - vídeo    → routed to the existing CreationWizard video flow via onUseVideoFlow
 */

import { useState } from 'react';
import type { ScriptBlock, BlockKind, ReelEmotion } from './types';
import type { ThemeTokens } from './theme';
import { importScriptWithAI } from './scriptImporter';
import { generateReelFromContent, fetchArticleFromUrl } from '../../services/scriptFromContentService';
import { VOICE_OPTIONS } from './voices';
import { loadAvatarPhotos, type AvatarPhoto } from './avatarPhotosStore';

const VIOLET = '#A78BFA';

export interface GuidedExtras {
  useAvatar: boolean;
  photoId?: string;
  voiceId: string;
  emotion: ReelEmotion;
  speed: number;
}

interface GuidedWizardProps {
  open: boolean;
  tokens: ThemeTokens;
  isLight: boolean;
  /** Default voice to preselect (project's current). */
  initialVoiceId?: string;
  onClose: () => void;
  onConfirm: (blocks: ScriptBlock[], extras: GuidedExtras) => void;
  /** Detected a video URL → hand off to the existing full video-import flow. */
  onUseVideoFlow: () => void;
}

type Step = 'conteudo' | 'roteiro' | 'voz';
type InputKind = 'texto' | 'artigo' | 'video';

const detectKind = (v: string): InputKind => {
  const t = v.trim();
  if (/(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|\.mp4)/i.test(t)) return 'video';
  if (/^https?:\/\//i.test(t)) return 'artigo';
  return 'texto';
};

const EMOTIONS: { value: ReelEmotion; label: string }[] = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'happy', label: 'Feliz' },
  { value: 'surprised', label: 'Surpreso' },
  { value: 'sad', label: 'Sério' },
];

export function GuidedWizard({ open, tokens, isLight, initialVoiceId, onClose, onConfirm, onUseVideoFlow }: GuidedWizardProps) {
  const [step, setStep] = useState<Step>('conteudo');
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ScriptBlock[]>([]);
  const [refazer, setRefazer] = useState('');

  // step 2 — avatar
  const [useAvatar, setUseAvatar] = useState(true);
  const [photos] = useState<AvatarPhoto[]>(() => loadAvatarPhotos());
  const [photoId, setPhotoId] = useState<string | undefined>(() => loadAvatarPhotos()[0]?.id);

  // step 3 — voz
  const [voiceId, setVoiceId] = useState(initialVoiceId ?? VOICE_OPTIONS[0].id);
  const [emotion, setEmotion] = useState<ReelEmotion>('neutral');
  const [speed, setSpeed] = useState(1.0);

  if (!open) return null;

  const kind = detectKind(input);
  const canGenerate = input.trim().length > 4 && !generating;

  const runGenerate = async (extraInstr?: string) => {
    setError(null);
    setGenerating(true);
    try {
      let result: ScriptBlock[];
      if (kind === 'artigo') {
        let text = input.trim();
        let sourceUrl: string | undefined;
        let title: string | undefined;
        try {
          const fetched = await fetchArticleFromUrl(input.trim());
          text = fetched.text; sourceUrl = fetched.sourceUrl; title = fetched.title || undefined;
        } catch {
          text = `Gere o roteiro baseado neste artigo/URL: ${input.trim()}`;
          sourceUrl = input.trim();
        }
        const gen = await generateReelFromContent(
          { text, sourceUrl, title },
          { style: 'educational', framework: 'auto', durationSec: 30, extraInstructions: extraInstr || undefined },
        );
        result = gen.blocks;
      } else {
        // texto
        const raw = extraInstr ? `${input.trim()}\n\n(Instrução extra: ${extraInstr})` : input.trim();
        result = await importScriptWithAI(raw);
      }
      if (!result || result.length === 0) throw new Error('Nenhum bloco gerado. Tente um conteúdo mais específico.');
      setBlocks(result);
      setStep('roteiro');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar o roteiro.');
    } finally {
      setGenerating(false);
    }
  };

  const finish = () => {
    const finalBlocks: ScriptBlock[] = useAvatar
      ? blocks
      : blocks.map(b => ({ ...b, kind: 'broll' as BlockKind }));
    onConfirm(finalBlocks, { useAvatar, photoId: useAvatar ? photoId : undefined, voiceId, emotion, speed });
  };

  const steps: { id: Step; label: string }[] = [
    { id: 'conteudo', label: '1 · Conteúdo' },
    { id: 'roteiro', label: '2 · Roteiro & avatar' },
    { id: 'voz', label: '3 · Voz' },
  ];
  const stepIdx = steps.findIndex(s => s.id === step);

  const card = (selected: boolean): React.CSSProperties => ({
    backgroundColor: tokens.bg.elevated,
    border: `1px solid ${selected ? VIOLET : tokens.border.subtle}`,
    boxShadow: selected ? `0 0 0 2px ${VIOLET}33` : 'none',
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm"
      style={{ backgroundColor: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="w-[760px] max-w-full max-h-full flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
      >
        {/* header + progress */}
        <div className="px-6 pt-5">
          <div className="flex items-center justify-between">
            <div className="text-[17px] font-bold">Novo Reels</div>
            <button onClick={onClose} className="text-sm" style={{ color: tokens.text.tertiary, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <div className="flex gap-2 mt-4 mb-1">
            {steps.map((s, i) => (
              <div key={s.id} className="flex-1">
                <div className="h-1 rounded" style={{ backgroundColor: i <= stepIdx ? VIOLET : tokens.border.subtle }} />
                <div className="text-[11px] mt-1.5" style={{ color: i === stepIdx ? tokens.text.primary : tokens.text.tertiary }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg text-[12px]" style={{ backgroundColor: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5' }}>
              {error}
              {error.includes('GOOGLE_API_KEY') && <span> — adicione a chave em Configurações.</span>}
            </div>
          )}

          {step === 'conteudo' && (
            <>
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>Cole o que tiver — o app entende sozinho</div>
              <textarea
                value={input}
                onChange={e => { setInput(e.target.value); setError(null); }}
                placeholder="Cole um texto, link de artigo ou link de vídeo (TikTok / YouTube / Instagram)…"
                className="w-full rounded-xl p-3.5 text-sm resize-none outline-none"
                style={{ minHeight: 130, backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
              />
              <div className="mt-2.5 text-[12px] flex items-center gap-2" style={{ color: tokens.text.tertiary }}>
                🔎 detectado: <b style={{ color: tokens.text.secondary }}>{kind === 'texto' ? 'texto' : kind === 'artigo' ? 'link de artigo' : 'link de vídeo'}</b>
                {kind === 'texto' && ' → gerar roteiro em blocos'}
                {kind === 'artigo' && ' → ler o artigo e virar roteiro'}
                {kind === 'video' && ' → abrir a importação de vídeo'}
              </div>
            </>
          )}

          {step === 'roteiro' && (
            <>
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>Roteiro gerado — ajuste se quiser</div>
              <div className="flex flex-col gap-2 mb-4">
                {blocks.map((b, i) => (
                  <div key={b.id} className="rounded-lg p-2.5 flex gap-2.5" style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}` }}>
                    <div className="text-[10px] font-bold w-3.5 shrink-0" style={{ color: tokens.text.tertiary }}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: tokens.text.tertiary }}>{b.kind === 'avatar' ? '👤 Avatar' : '🎞 B-roll'}</div>
                      <div className="text-[13px] leading-snug">{b.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mb-5">
                <input
                  value={refazer}
                  onChange={e => setRefazer(e.target.value)}
                  placeholder="✨ refazer com instrução: ex 'mais curto e divertido'"
                  className="flex-1 rounded-lg px-3 py-2 text-[12px] outline-none"
                  style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
                />
                <button
                  onClick={() => runGenerate(refazer.trim() || undefined)}
                  disabled={generating}
                  className="px-3.5 py-2 rounded-lg text-[12px] font-medium"
                  style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.secondary, cursor: generating ? 'wait' : 'pointer' }}
                >
                  {generating ? '⏳' : 'Refazer'}
                </button>
              </div>

              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>Avatar</div>
              <div className="flex items-center gap-2.5 mb-3.5">
                <button
                  onClick={() => setUseAvatar(v => !v)}
                  className="relative rounded-full transition-colors"
                  style={{ width: 42, height: 24, backgroundColor: useAvatar ? VIOLET : tokens.border.subtle, border: 'none', cursor: 'pointer' }}
                >
                  <span className="absolute rounded-full bg-white" style={{ width: 20, height: 20, top: 2, left: useAvatar ? 20 : 2, transition: 'left 0.15s' }} />
                </button>
                <span className="text-[13px]">Usar avatar falando nos blocos</span>
              </div>
              {useAvatar && (
                photos.length > 0 ? (
                  <div className="flex gap-2.5 flex-wrap">
                    {photos.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setPhotoId(p.id)}
                        className="rounded-lg overflow-hidden"
                        style={{ width: 54, height: 54, ...card(photoId === p.id), padding: 0, cursor: 'pointer' }}
                        title={p.name}
                      >
                        {p.thumbnailBase64 || p.previewUrl
                          ? <img src={p.thumbnailBase64 || p.previewUrl} alt={p.name} className="w-full h-full object-cover" />
                          : <span className="text-lg">🧑</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] px-3 py-2.5 rounded-lg" style={{ backgroundColor: tokens.bg.elevated, border: `1px dashed ${tokens.border.subtle}`, color: tokens.text.tertiary }}>
                    Nenhuma foto ainda — você adiciona a foto do avatar na timeline (aba Avatar).
                  </div>
                )
              )}
            </>
          )}

          {step === 'voz' && (
            <>
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>Escolha a voz</div>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {VOICE_OPTIONS.map(v => (
                  <button key={v.id} onClick={() => setVoiceId(v.id)} className="rounded-xl p-3 text-left" style={{ ...card(voiceId === v.id), cursor: 'pointer' }}>
                    <div className="text-[13px] font-bold">{v.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>{v.hint}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3.5">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase mb-1.5 font-semibold" style={{ color: tokens.text.tertiary }}>Emoção</label>
                  <select value={emotion} onChange={e => setEmotion(e.target.value as ReelEmotion)} className="w-full rounded-lg px-2.5 py-2 text-[12px] outline-none" style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}>
                    {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] uppercase mb-1.5 font-semibold" style={{ color: tokens.text.tertiary }}>Velocidade</label>
                  <select value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} className="w-full rounded-lg px-2.5 py-2 text-[12px] outline-none" style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}>
                    <option value={0.9}>0.9x</option>
                    <option value={1.0}>1.0x</option>
                    <option value={1.1}>1.1x</option>
                    <option value={1.2}>1.2x</option>
                  </select>
                </div>
              </div>
              <div className="mt-3.5 text-[11px]" style={{ color: tokens.text.tertiary }}>O áudio é gerado depois, na timeline (sem espera aqui).</div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-6 py-3.5 flex items-center justify-between" style={{ borderTop: `1px solid ${tokens.border.subtle}` }}>
          <button
            onClick={() => { if (step === 'conteudo') onClose(); else setStep(step === 'voz' ? 'roteiro' : 'conteudo'); }}
            className="px-4 py-2 rounded-lg text-[13px]"
            style={{ background: 'transparent', border: `1px solid ${tokens.border.subtle}`, color: tokens.text.secondary, cursor: 'pointer' }}
          >
            {step === 'conteudo' ? 'Cancelar' : '← voltar'}
          </button>

          {step === 'conteudo' && (
            kind === 'video' ? (
              <button onClick={onUseVideoFlow} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>
                Abrir importação de vídeo →
              </button>
            ) : (
              <button onClick={() => runGenerate()} disabled={!canGenerate} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? 'pointer' : 'default' }}>
                {generating ? '⏳ Gerando…' : 'Gerar roteiro →'}
              </button>
            )
          )}
          {step === 'roteiro' && (
            <button onClick={() => setStep('voz')} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>Continuar →</button>
          )}
          {step === 'voz' && (
            <button onClick={finish} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>Concluir → timeline</button>
          )}
        </div>
      </div>
    </div>
  );
}
