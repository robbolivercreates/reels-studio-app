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
import { generateReelFromContent, fetchArticleFromUrl, type DurationTarget } from '../../services/scriptFromContentService';
import { generateCarouselScript, carouselSlidesToBlocks, type DetectedBrand } from '../../services/carouselScriptService';
import { generateCoverImage, hasCoverImageKey } from '../../services/openaiImageService';
import { fetchBrandLogoAsDataUri } from '../../services/logoFetchService';
import { generateCarouselCaption } from '../../services/carouselCaptionService';
import { CoverSlideEditor } from './CoverSlideEditor';
import { generateHooks, researchViralHooks, buildHookReelSource, HOOK_REEL_INSTRUCTION, type Hook } from '../../services/hookGeneratorService';
import { VOICE_OPTIONS } from './voices';
import { loadAvatarPhotos, type AvatarPhoto } from './avatarPhotosStore';
import { ensureProfiles, upsertProfile, LANGUAGE_OPTIONS, type OutputLanguage, type VoiceProfile } from './voiceProfile';
import { loadClonedVoices, type ClonedVoice } from '../../services/minimaxService';
import { YAP_TYPE_OPTIONS, loadSpeechStyleConfig, saveSpeechStyleConfig, type SpeechStyleConfig } from '../../services/speechStyle';

const VIOLET = '#60A5FA';

/** Read the active voice profile (the one that carries the default language). */
const activeProfile = (): VoiceProfile => {
  const { profiles, activeId } = ensureProfiles();
  return profiles.find(p => p.id === activeId) ?? profiles[0];
};

export type WizardFormat = 'reel' | 'carousel';

export interface GuidedExtras {
  format: WizardFormat;
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
  /** Pre-select the output format (defaults to 'reel'). */
  initialFormat?: WizardFormat;
  onClose: () => void;
  onConfirm: (blocks: ScriptBlock[], extras: GuidedExtras) => void;
  /** Detected a video URL → hand off to the existing full video-import flow,
   *  passing the URL so the next wizard can skip its own source-picker step. */
  onUseVideoFlow: (url: string) => void;
}

type Step = 'conteudo' | 'hooks' | 'roteiro' | 'voz';
type InputKind = 'texto' | 'artigo' | 'video';
/** Origem do reel: conteúdo pronto (texto/link/vídeo) ou só um tema (gera hooks). */
type SourceMode = 'conteudo' | 'tema';

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

export function GuidedWizard({ open, tokens, isLight, initialVoiceId, initialFormat, onClose, onConfirm, onUseVideoFlow }: GuidedWizardProps) {
  const [step, setStep] = useState<Step>('conteudo');
  const [format, setFormat] = useState<WizardFormat>(initialFormat ?? 'reel');
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  // Optional fine-grained status shown on the generate button (e.g. the viral
  // research phase before hooks). Falls back to the generic "Gerando…" label.
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ScriptBlock[]>([]);
  const [refazer, setRefazer] = useState('');
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [coverImagePrompt, setCoverImagePrompt] = useState<string | null>(null);
  const [coverImageEditedPrompt, setCoverImageEditedPrompt] = useState<string | null>(null);
  const [coverImageReferencePhoto, setCoverImageReferencePhoto] = useState<string | null>(null);
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null);
  const [coverImageGenerating, setCoverImageGenerating] = useState(false);
  const [coverImageError, setCoverImageError] = useState<string | null>(null);
  // Brand logo detection + fetch
  const [detectedBrand, setDetectedBrand] = useState<DetectedBrand | null>(null);
  // null = not loaded yet, false = fetch failed, string = data URI
  const [brandLogoDataUri, setBrandLogoDataUri] = useState<string | null | false>(null);
  // Instagram caption
  const [carouselCaption, setCarouselCaption] = useState<string | null>(null);
  const [captionGenerating, setCaptionGenerating] = useState(false);

  // Modo de origem (reel): 'conteudo' (cola texto/link/vídeo) ou 'tema' (só um
  // tema → gera hooks → escolhe → roteiro). Opcional e aditivo — default segue
  // o comportamento de sempre.
  const [sourceMode, setSourceMode] = useState<SourceMode>('conteudo');
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selectedHookIdx, setSelectedHookIdx] = useState<number | null>(null);

  // step 2 — avatar
  const [useAvatar, setUseAvatar] = useState(true);
  const [photos] = useState<AvatarPhoto[]>(() => loadAvatarPhotos());
  const [photoId, setPhotoId] = useState<string | undefined>(() => loadAvatarPhotos()[0]?.id);

  // step 3 — voz
  const [voiceId, setVoiceId] = useState(initialVoiceId ?? VOICE_OPTIONS[0].id);
  const [emotion, setEmotion] = useState<ReelEmotion>('neutral');
  const [speed, setSpeed] = useState(1.0);
  // Cloned voices (Minimax voice clones the user has saved in Settings →
  // Voices). Loaded once when the wizard mounts; surfaced as a "Minhas
  // vozes" group at the top of the picker so the user's own voice wins
  // visibility over the built-in defaults.
  const [clonedVoices] = useState<ClonedVoice[]>(() => loadClonedVoices());

  // Default output language — seeded from the active voice profile (the global
  // default). Changing it here persists back to that profile, so it becomes the
  // default for every future generation + the TTS step.
  const [language, setLanguage] = useState<OutputLanguage>(() => activeProfile().outputLanguage);

  // Speech style — per-generation choice (Padrão vs Yap + subtipo + vivência).
  // Seeded from the last choice; saved back on generate so timeline/agent
  // regeneration keeps the same voice.
  const [speechStyle, setSpeechStyle] = useState<SpeechStyleConfig>(() => loadSpeechStyleConfig());

  // Target length controls — applied before the first generation. Duration
  // drives reel generation; slide count drives carousel. Defaults match what
  // the services already use when unspecified.
  const [durationSec, setDurationSec] = useState<DurationTarget>(30);
  const [slideCount, setSlideCount] = useState<number>(6);
  // Free-text guidance for the model ("deixe mais detalhado", "tom mais sério",
  // "foque em iniciantes"). Goes through as extraInstructions on the first
  // generation, and is also offered as the seed for step-2 "Refazer".
  const [extraInstr, setExtraInstr] = useState('');

  if (!open) return null;

  // The profile to drive generation with — the active one, but forced to the
  // language the user picked in this wizard.
  const profileForGen = (): VoiceProfile => ({ ...activeProfile(), outputLanguage: language, speechStyle });
  // Persist the chosen language as the new default on the active profile.
  const persistLanguageDefault = (lang: OutputLanguage) => {
    upsertProfile({ ...activeProfile(), outputLanguage: lang });
  };

  const kind = detectKind(input);
  const canGenerate = input.trim().length > 4 && !generating;

  const runGenerate = async (regenInstr?: string) => {
    setError(null);
    setGenerating(true);
    // Save the picked language as the global default before generating.
    persistLanguageDefault(language);
    saveSpeechStyleConfig(speechStyle);
    const profile = profileForGen();
    // Merge the step-1 guidance with any step-2 refazer override into a single
    // string the model receives. Step-2 override wins on key conflicts because
    // it's the latest user intent.
    const mergedInstr = [extraInstr.trim(), regenInstr?.trim()].filter(Boolean).join('\n');
    const effectiveInstr = mergedInstr || undefined;
    try {
      let result: ScriptBlock[];
      if (format === 'carousel') {
        // Carousel path: fetch article when link, otherwise use raw text.
        let topic = input.trim();
        if (kind === 'artigo') {
          try {
            const fetched = await fetchArticleFromUrl(input.trim());
            topic = fetched.text;
          } catch {
            topic = `Gere o carrossel baseado neste artigo/URL: ${input.trim()}`;
          }
        }
        if (effectiveInstr) topic = `${topic}\n\n(Instrução extra: ${effectiveInstr})`;
        const gen = await generateCarouselScript(topic, slideCount, 'educativo');
        result = carouselSlidesToBlocks(gen.slides);
        setCoverImagePrompt(gen.coverImagePrompt ?? null);
        setCoverImageEditedPrompt(gen.coverImagePrompt ?? null);
        setCoverImageDataUrl(null);
        setCoverImageError(null);
        setCarouselCaption(null);
        // Brand logo auto-fetch
        const brand = gen.detectedBrand ?? null;
        setDetectedBrand(brand);
        setBrandLogoDataUri(brand ? null : false);
        if (brand?.domain) {
          fetchBrandLogoAsDataUri(brand.domain)
            .then(uri => setBrandLogoDataUri(uri ?? false))
            .catch(() => setBrandLogoDataUri(false));
        }
      } else if (kind === 'artigo') {
        const fetched = await fetchArticleFromUrl(input.trim());
        const gen = await generateReelFromContent(
          { text: fetched.text, sourceUrl: fetched.sourceUrl, title: fetched.title || undefined },
          { style: 'educational', framework: 'auto', durationSec, extraInstructions: effectiveInstr, voiceProfile: profile },
        );
        result = gen.blocks;
      } else {
        // texto — duration hint goes inline since importScriptWithAI's segmenter
        // doesn't take a structured duration param.
        const hints = [
          `Alvo de duração total: ~${durationSec} segundos falados.`,
          effectiveInstr ? `Instrução extra: ${effectiveInstr}` : null,
        ].filter(Boolean).join(' ');
        const raw = hints ? `${input.trim()}\n\n(${hints})` : input.trim();
        result = await importScriptWithAI(raw, undefined, profile);
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

  const handleGenerateCoverImage = async () => {
    const prompt = coverImageEditedPrompt?.trim() || coverImagePrompt;
    if (!prompt) return;
    setCoverImageGenerating(true);
    setCoverImageError(null);
    try {
      const logo = typeof brandLogoDataUri === 'string' ? brandLogoDataUri : undefined;
      const url = await generateCoverImage(prompt, coverImageReferencePhoto ?? undefined, logo);
      setCoverImageDataUrl(url);
    } catch (e) {
      setCoverImageError(e instanceof Error ? e.message : 'Erro ao gerar imagem.');
    } finally {
      setCoverImageGenerating(false);
    }
  };

  // Tema → pesquisa tendências virais (Google Search) → gera 9 ganchos
  // viesados pro que está bombando → vai pro passo de escolha.
  const runGenerateHooks = async () => {
    setError(null);
    setGenerating(true);
    persistLanguageDefault(language);
    saveSpeechStyleConfig(speechStyle);
    const profile = profileForGen();
    try {
      // Etapa 1 — pesquisa tendências virais reais pro tema. Resiliente:
      // researchViralHooks devolve null em qualquer falha, então a geração
      // segue sem o viés de tendência (nunca trava o fluxo principal).
      setGenMsg('🔍 Pesquisando tendências…');
      const viralContext = await researchViralHooks(input.trim(), { voiceProfile: profile });
      // Etapa 2 — gera os 9 ganchos, agora com o contexto viral injetado.
      setGenMsg('✍️ Escrevendo ganchos…');
      const list = await generateHooks(input.trim(), { voiceProfile: profile, viralContext });
      setHooks(list);
      setSelectedHookIdx(null);
      setStep('hooks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar os ganchos.');
    } finally {
      setGenerating(false);
      setGenMsg(null);
    }
  };

  // Gancho escolhido → roteiro. Reusa o generateReelFromContent travando o hook
  // como abertura (sem serviço novo de geração de roteiro).
  const runGenerateFromHook = async () => {
    if (selectedHookIdx === null) return;
    setError(null);
    setGenerating(true);
    saveSpeechStyleConfig(speechStyle);
    const profile = profileForGen();
    const hook = hooks[selectedHookIdx];
    const extra = [HOOK_REEL_INSTRUCTION, extraInstr.trim()].filter(Boolean).join('\n');
    try {
      const gen = await generateReelFromContent(
        buildHookReelSource(input.trim(), hook),
        { style: 'viral', framework: 'auto', durationSec, extraInstructions: extra, voiceProfile: profile },
      );
      if (!gen.blocks?.length) throw new Error('Nenhum bloco gerado. Tente outro gancho.');
      setBlocks(gen.blocks);
      setStep('roteiro');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar o roteiro.');
    } finally {
      setGenerating(false);
    }
  };

  const finish = () => {
    if (format === 'carousel') {
      // Carousel has no avatar/voice — pass through blocks as-is.
      onConfirm(blocks, { format, useAvatar: false, voiceId, emotion, speed });
      return;
    }
    const finalBlocks: ScriptBlock[] = useAvatar
      ? blocks
      : blocks.map(b => ({ ...b, kind: 'broll' as BlockKind }));
    onConfirm(finalBlocks, { format, useAvatar, photoId: useAvatar ? photoId : undefined, voiceId, emotion, speed });
  };

  const steps: { id: Step; label: string }[] = format === 'carousel'
    ? [
        { id: 'conteudo', label: '1 · Conteúdo' },
        { id: 'roteiro', label: '2 · Slides' },
      ]
    : sourceMode === 'tema'
    ? [
        { id: 'conteudo', label: '1 · Tema' },
        { id: 'hooks', label: '2 · Hook' },
        { id: 'roteiro', label: '3 · Roteiro & avatar' },
        { id: 'voz', label: '4 · Voz' },
      ]
    : [
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
              {/* DECISÃO 1 — o que criar (formato de saída). Rótulo próprio +
                  espaçamento pra não conflar com a decisão de origem abaixo.
                  Antes as duas perguntas viviam sob um único "FORMATO" e duas
                  tiles acendiam juntas, parecendo multi-select bugado. */}
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: tokens.text.tertiary }}>O que você quer criar?</div>
              <div className="grid grid-cols-2 gap-2 mb-5">
                <button
                  onClick={() => setFormat('reel')}
                  className="rounded-xl p-3 text-left"
                  style={{ ...card(format === 'reel'), cursor: 'pointer' }}
                >
                  <div className="text-[13px] font-bold flex items-center gap-2">🎬 Reels</div>
                  <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>Vídeo vertical com avatar + voz.</div>
                </button>
                <button
                  onClick={() => setFormat('carousel')}
                  className="rounded-xl p-3 text-left"
                  style={{ ...card(format === 'carousel'), cursor: 'pointer' }}
                >
                  <div className="text-[13px] font-bold flex items-center gap-2">🖼 Carrossel</div>
                  <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>Slides 4:5 animados (sem voz).</div>
                </button>
              </div>

              {/* DECISÃO 2 — por onde começar (fonte do conteúdo). Só pra reel.
                  Rótulo próprio deixa claro que é OUTRA pergunta, não mais formato. */}
              {format === 'reel' && (
                <>
                  <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: tokens.text.tertiary }}>Por onde começamos?</div>
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    <button onClick={() => { setSourceMode('conteudo'); setError(null); }} className="rounded-xl p-3 text-left" style={{ ...card(sourceMode === 'conteudo'), cursor: 'pointer' }}>
                      <div className="text-[13px] font-bold">📋 Já tenho o conteúdo</div>
                      <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>Cola texto, link ou vídeo.</div>
                    </button>
                    <button onClick={() => { setSourceMode('tema'); setError(null); }} className="rounded-xl p-3 text-left" style={{ ...card(sourceMode === 'tema'), cursor: 'pointer' }}>
                      <div className="text-[13px] font-bold">💡 Só a ideia</div>
                      <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>A IA pesquisa tendências e gera os ganchos.</div>
                    </button>
                  </div>
                </>
              )}

              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>
                {sourceMode === 'tema' && format === 'reel' ? 'Sobre o que é o reel?' : 'Cole o que tiver — o app entende sozinho'}
              </div>
              <textarea
                value={input}
                    spellCheck={false}
                    autoCorrect="off"
                    onChange={e => { setInput(e.target.value); setError(null); }}
                placeholder={sourceMode === 'tema' && format === 'reel'
                  ? 'ex: produtividade pra quem tem TDAH · marketing pra dentistas · como começar a investir…'
                  : 'Cole um texto, link de artigo ou link de vídeo (TikTok / YouTube / Instagram)…'}
                className="w-full rounded-xl p-3.5 text-sm resize-none outline-none"
                style={{ minHeight: 130, backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
              />
              {!(sourceMode === 'tema' && format === 'reel') && (
                <div className="mt-2.5 text-[12px] flex items-center gap-2" style={{ color: tokens.text.tertiary }}>
                  🔎 detectado: <b style={{ color: tokens.text.secondary }}>{kind === 'texto' ? 'texto' : kind === 'artigo' ? 'link de artigo' : 'link de vídeo'}</b>
                  {format === 'carousel' && kind !== 'video' && ' → gerar slides do carrossel'}
                  {format === 'reel' && kind === 'texto' && ' → gerar roteiro em blocos'}
                  {format === 'reel' && kind === 'artigo' && ' → ler o artigo e virar roteiro'}
                  {kind === 'video' && ' → abrir a importação de vídeo'}
                </div>
              )}

              {/* Estilo de fala — escolha por geração (não é campo do perfil).
                  Yap = monólogo conversacional em 1ª pessoa; subtipo muda a
                  estrutura, o toggle separa vivência de comentário. Carrossel
                  fica fora: não vira voz. */}
              {format === 'reel' && (
                <div className="mt-4">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Estilo de fala</span>
                    {([
                      { id: 'default' as const, label: 'Padrão' },
                      { id: 'yap' as const, label: '🗣️ Yap' },
                    ]).map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSpeechStyle(s.id === 'default'
                          ? { style: 'default' }
                          : { style: 'yap', yapType: speechStyle.yapType ?? 'storytime', yapLived: speechStyle.yapLived !== false })}
                        className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                        style={{
                          backgroundColor: speechStyle.style === s.id ? VIOLET : tokens.bg.elevated,
                          color: speechStyle.style === s.id ? '#fff' : tokens.text.secondary,
                          border: `1px solid ${speechStyle.style === s.id ? VIOLET : tokens.border.subtle}`,
                          cursor: 'pointer',
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                    {speechStyle.style === 'yap' && (
                      <span className="text-[10px]" style={{ color: tokens.text.tertiary }}>monólogo 1ª pessoa, papo reto</span>
                    )}
                  </div>
                  {speechStyle.style === 'yap' && (
                    <>
                      <div className="grid grid-cols-2 gap-2 mt-2.5">
                        {YAP_TYPE_OPTIONS.map(y => (
                          <button
                            key={y.id}
                            onClick={() => setSpeechStyle({ ...speechStyle, yapType: y.id, yapLived: y.id === 'storytime' ? true : speechStyle.yapLived })}
                            className="rounded-xl p-2.5 text-left"
                            style={{ ...card(speechStyle.yapType === y.id), cursor: 'pointer' }}
                          >
                            <div className="text-[12.5px] font-bold flex items-center gap-1.5">{y.emoji} {y.label}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>{y.desc}</div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2.5 flex items-center gap-2.5 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Você viveu isso?</span>
                        {([
                          { lived: true, label: '✅ Vivi isso' },
                          { lived: false, label: '💬 Só comentando' },
                        ]).map(o => (
                          <button
                            key={String(o.lived)}
                            onClick={() => setSpeechStyle({ ...speechStyle, yapLived: o.lived })}
                            className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                            style={{
                              backgroundColor: (speechStyle.yapLived !== false) === o.lived ? VIOLET : tokens.bg.elevated,
                              color: (speechStyle.yapLived !== false) === o.lived ? '#fff' : tokens.text.secondary,
                              border: `1px solid ${(speechStyle.yapLived !== false) === o.lived ? VIOLET : tokens.border.subtle}`,
                              cursor: 'pointer',
                            }}
                          >
                            {o.label}
                          </button>
                        ))}
                        <span className="text-[10px]" style={{ color: tokens.text.tertiary }}>Comentando = não inventa vivência, só reage/anuncia</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Default language — seeded from the active voice profile; changing
                  it here saves it as the global default for all future reels. */}
              <div className="mt-4 flex items-center gap-2.5 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Idioma</span>
                <select
                  value={language}
                  onChange={e => { const v = e.target.value as OutputLanguage; setLanguage(v); persistLanguageDefault(v); }}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
                  style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
                  title="Idioma do roteiro e do áudio. A escolha vira o padrão pros próximos reels."
                >
                  {LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="text-[10px]" style={{ color: tokens.text.tertiary }}>✓ salvo como padrão</span>
              </div>

              {/* Duration (reel) or slide count (carousel). Direct toggles so
                  the user can fight "roteiro raso" by picking a longer target
                  upfront without entering an extra wizard step. */}
              {format === 'reel' ? (
                <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Duração</span>
                  {([15, 30, 45, 60, 90] as DurationTarget[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setDurationSec(s)}
                      className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                      style={{
                        backgroundColor: durationSec === s ? VIOLET : tokens.bg.elevated,
                        color: durationSec === s ? '#fff' : tokens.text.secondary,
                        border: `1px solid ${durationSec === s ? VIOLET : tokens.border.subtle}`,
                        cursor: 'pointer',
                      }}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Slides</span>
                  {[5, 7, 10, 12, 15].map(n => (
                    <button
                      key={n}
                      onClick={() => setSlideCount(n)}
                      className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                      style={{
                        backgroundColor: slideCount === n ? VIOLET : tokens.bg.elevated,
                        color: slideCount === n ? '#fff' : tokens.text.secondary,
                        border: `1px solid ${slideCount === n ? VIOLET : tokens.border.subtle}`,
                        cursor: 'pointer',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              {/* Free-text guidance — optional. "Deixe mais detalhado", "tom
                  sério", "foca em iniciantes", etc. */}
              <div className="mt-3.5">
                <div className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: tokens.text.tertiary }}>
                  Instrução pra IA <span style={{ color: tokens.text.tertiary, textTransform: 'none' }}>(opcional)</span>
                </div>
                <input
                  value={extraInstr}
                  onChange={e => setExtraInstr(e.target.value)}
                  placeholder='ex: "deixe mais detalhado", "tom mais sério", "foca em iniciantes"'
                  className="w-full rounded-lg px-3 py-2 text-[12.5px] outline-none"
                  style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.primary }}
                />
              </div>
            </>
          )}

          {step === 'hooks' && (
            <>
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>
                Escolha o gancho de abertura
              </div>
              <div className="flex flex-col gap-2 mb-4">
                {hooks.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedHookIdx(i)}
                    className="rounded-lg p-3 text-left"
                    style={{ ...card(selectedHookIdx === i), cursor: 'pointer' }}
                  >
                    <div className="text-[9px] uppercase tracking-wide font-semibold mb-1" style={{ color: VIOLET }}>
                      {h.title}{h.type ? ` · ${h.type}` : ''}
                    </div>
                    <div className="text-[13px] leading-snug" style={{ color: tokens.text.primary }}>{h.content}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={runGenerateHooks}
                disabled={generating}
                className="px-3.5 py-2 rounded-lg text-[12px] font-medium"
                style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}`, color: tokens.text.secondary, cursor: generating ? 'wait' : 'pointer' }}
              >
                {generating ? (genMsg ?? '⏳ Gerando…') : '✨ Refazer ganchos'}
              </button>
            </>
          )}

          {step === 'roteiro' && (
            <>
              {/* ── CAROUSEL COVER SLIDE (GPT Image 2 via fal.ai) ── */}
              {format === 'carousel' && coverImagePrompt && (
                <CoverSlideEditor
                  editedPrompt={coverImageEditedPrompt ?? coverImagePrompt}
                  referencePhoto={coverImageReferencePhoto}
                  generatedImageUrl={coverImageDataUrl}
                  generating={coverImageGenerating}
                  error={coverImageError}
                  hasKey={hasCoverImageKey()}
                  detectedBrand={detectedBrand ? { ...detectedBrand, logoDataUri: brandLogoDataUri } : null}
                  onPromptChange={setCoverImageEditedPrompt}
                  onReferencePhotoChange={setCoverImageReferencePhoto}
                  onGenerate={handleGenerateCoverImage}
                />
              )}

              {/* ── INSTAGRAM CAPTION ── */}
              {format === 'carousel' && blocks.length > 0 && (
                <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Legenda Instagram</span>
                    <button
                      onClick={async () => {
                        setCaptionGenerating(true);
                        try {
                          const caption = await generateCarouselCaption(blocks.map(b => ({ slideNumber: 0, role: 'body' as const, text: b.text, visualHint: '' })), '');
                          setCarouselCaption(caption);
                        } catch { /* silent */ } finally { setCaptionGenerating(false); }
                      }}
                      disabled={captionGenerating}
                      className="text-[9px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40 flex items-center gap-1"
                    >
                      {captionGenerating ? (
                        <><div className="w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />Gerando…</>
                      ) : carouselCaption ? '↺ Regerar' : '✨ Gerar legenda'}
                    </button>
                  </div>
                  {carouselCaption ? (
                    <div className="p-3 space-y-2">
                      <pre className="text-[10px] text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">{carouselCaption}</pre>
                      <button
                        onClick={() => navigator.clipboard.writeText(carouselCaption)}
                        className="text-[9px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Copiar
                      </button>
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-[10px] text-zinc-600">Gere a legenda depois de revisar os slides.</p>
                  )}
                </div>
              )}

              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>
                {format === 'carousel' ? 'Slides gerados — ajuste se quiser' : 'Roteiro gerado — ajuste se quiser'}
              </div>
              <div className="flex flex-col gap-2 mb-4">
                {blocks.map((b, i) => {
                  const isEditing = editingBlockId === b.id;
                  const isCoverSlot = format === 'carousel' && i === 0;
                  return (
                    <div
                      key={b.id}
                      className="rounded-lg overflow-hidden"
                      style={{ border: `1px solid ${isEditing ? 'rgba(139,92,246,0.4)' : tokens.border.subtle}` }}
                    >
                      <div
                        className="p-2.5 flex gap-2.5 cursor-pointer"
                        style={{ backgroundColor: tokens.bg.elevated }}
                        onClick={() => !isCoverSlot && setEditingBlockId(isEditing ? null : b.id)}
                      >
                        <div className="text-[10px] font-bold w-3.5 shrink-0 mt-0.5" style={{ color: tokens.text.tertiary }}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="text-[9px] uppercase tracking-wide" style={{ color: tokens.text.tertiary }}>
                              {format === 'carousel'
                                ? (i === 0 ? '🖼 Capa · editada acima' : `🖼 Slide ${i + 1}`)
                                : b.kind === 'avatar' ? '👤 Avatar' : '🎞 B-roll'}
                            </div>
                            {!isCoverSlot && (
                              <svg
                                className="w-3 h-3 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                                style={{ color: isEditing ? '#a78bfa' : tokens.text.tertiary }}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            )}
                          </div>
                          <div className="text-[13px] leading-snug" style={{ color: isCoverSlot ? tokens.text.tertiary : tokens.text.primary }}>
                            {isCoverSlot ? '(imagem gerada com GPT Image 2 — veja o painel acima)' : b.text}
                          </div>
                        </div>
                      </div>
                      {isEditing && !isCoverSlot && (
                        <div className="px-2.5 pb-2.5 pt-0" style={{ backgroundColor: tokens.bg.elevated }}>
                          <textarea
                            autoFocus
                            value={b.text}
                    spellCheck={false}
                    autoCorrect="off"
                    onChange={e => {
                              const updated = blocks.map(bl => bl.id === b.id ? { ...bl, text: e.target.value } : bl);
                              setBlocks(updated);
                            }}
                            onKeyDown={e => { if (e.key === 'Escape') setEditingBlockId(null); }}
                            rows={3}
                            className="w-full rounded-md px-2.5 py-2 text-[12px] resize-none focus:outline-none transition-colors"
                            style={{
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(139,92,246,0.3)',
                              color: tokens.text.primary,
                            }}
                          />
                          <div className="flex justify-end mt-1.5">
                            <button
                              onClick={() => setEditingBlockId(null)}
                              className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
                              style={{ backgroundColor: 'rgba(139,92,246,0.2)', color: '#a78bfa' }}
                            >
                              Pronto
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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

              {format !== 'carousel' && (<>
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
              </>)}
            </>
          )}

          {step === 'voz' && (
            <>
              {/* Minhas vozes — surface the user's cloned Minimax voices first
                  so they win visibility over the defaults. Empty state points
                  the user to Settings → Vozes for cloning. */}
              {clonedVoices.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: '#60A5FA' }}>Minhas vozes</div>
                  <div className="grid grid-cols-3 gap-2.5 mb-4">
                    {clonedVoices.map(v => {
                      const daysLeft = Math.max(0, Math.floor((v.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
                      return (
                        <button
                          key={v.id}
                          onClick={() => setVoiceId(v.voiceId)}
                          className="rounded-xl p-3 text-left"
                          style={{ ...card(voiceId === v.voiceId), cursor: 'pointer' }}
                          title={`Voz clonada · ${v.model}`}
                        >
                          <div className="text-[13px] font-bold flex items-center gap-1.5">
                            <span style={{ color: VIOLET }}>●</span>
                            {v.name}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>
                            {daysLeft > 1 ? `expira em ${daysLeft} dias` : daysLeft === 1 ? 'expira amanhã' : 'expira hoje'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: tokens.text.tertiary }}>
                {clonedVoices.length > 0 ? 'Ou escolha uma voz padrão' : 'Escolha a voz'}
              </div>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {VOICE_OPTIONS.map(v => (
                  <button key={v.id} onClick={() => setVoiceId(v.id)} className="rounded-xl p-3 text-left" style={{ ...card(voiceId === v.id), cursor: 'pointer' }}>
                    <div className="text-[13px] font-bold">{v.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>{v.hint}</div>
                  </button>
                ))}
              </div>
              {clonedVoices.length === 0 && (
                <div className="mb-4 px-3 py-2 rounded-lg text-[11px]" style={{ backgroundColor: tokens.bg.elevated, border: `1px dashed ${tokens.border.subtle}`, color: tokens.text.tertiary }}>
                  💡 Quer usar sua própria voz? Clona ela em <b>Configurações → Vozes</b> e ela aparece aqui no topo do picker.
                </div>
              )}
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
            onClick={() => {
              if (step === 'conteudo') { onClose(); return; }
              if (step === 'hooks') { setStep('conteudo'); return; }
              if (step === 'roteiro') { setStep(sourceMode === 'tema' && format === 'reel' ? 'hooks' : 'conteudo'); return; }
              setStep('roteiro'); // voz → roteiro
            }}
            className="px-4 py-2 rounded-lg text-[13px]"
            style={{ background: 'transparent', border: `1px solid ${tokens.border.subtle}`, color: tokens.text.secondary, cursor: 'pointer' }}
          >
            {step === 'conteudo' ? 'Cancelar' : '← voltar'}
          </button>

          {step === 'conteudo' && (
            format === 'reel' && sourceMode === 'tema' ? (
              <button onClick={() => runGenerateHooks()} disabled={!canGenerate} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', opacity: !canGenerate ? 0.5 : 1, cursor: !canGenerate ? 'default' : 'pointer' }}>
                {generating ? (genMsg ?? '⏳ Gerando…') : 'Gerar ganchos →'}
              </button>
            ) : kind === 'video' && format !== 'carousel' ? (
              <button onClick={() => { saveSpeechStyleConfig(speechStyle); onUseVideoFlow(input.trim()); }} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>
                Importar este vídeo →
              </button>
            ) : (
              <button onClick={() => runGenerate()} disabled={!canGenerate || kind === 'video'} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', opacity: (!canGenerate || kind === 'video') ? 0.5 : 1, cursor: (!canGenerate || kind === 'video') ? 'default' : 'pointer' }}>
                {generating
                  ? '⏳ Gerando…'
                  : format === 'carousel' ? 'Gerar slides →' : 'Gerar roteiro →'}
              </button>
            )
          )}
          {step === 'hooks' && (
            <button onClick={runGenerateFromHook} disabled={selectedHookIdx === null || generating} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', opacity: (selectedHookIdx === null || generating) ? 0.5 : 1, cursor: (selectedHookIdx === null || generating) ? 'default' : 'pointer' }}>
              {generating ? '⏳ Gerando…' : 'Gerar roteiro →'}
            </button>
          )}
          {step === 'roteiro' && (
            format === 'carousel'
              ? <button onClick={finish} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>Concluir → timeline</button>
              : <button onClick={() => setStep('voz')} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>Continuar →</button>
          )}
          {step === 'voz' && (
            <button onClick={finish} className="px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: VIOLET, border: 'none', cursor: 'pointer' }}>Concluir → timeline</button>
          )}
        </div>
      </div>
    </div>
  );
}
