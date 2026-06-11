/**
 * MontarBar — guided staged production strip on the timeline.
 *
 * Surfaces the three production steps in the order the data requires
 * (áudio → avatares → motions) instead of burying them in the "Mais" menu.
 * Each phase reuses the EXISTING trigger:
 *   - áudio    → onAudio   (opens the audio confirm modal)
 *   - avatares → onAvatars (opens GenerateAvatarsModal, which already shows cost)
 *   - motions  → onMotions (handleAutoMotionMany)
 *
 * Purely presentational: it derives each phase's status from props and calls
 * the handlers. It adds NO new generation logic and NO new cost — the avatar
 * cost confirmation lives in the existing modal.
 */

import type { ThemeTokens } from './theme';

type AudioStatus = 'idle' | 'generating' | 'ready' | 'error';

interface MontarBarProps {
  tokens: ThemeTokens;
  audioStatus: AudioStatus;
  avatarTotal: number;
  avatarReady: number;
  generatingClips: boolean;
  motionCandidates: number; // blocks still needing a motion (pass the asset gate)
  motionDone: number;       // blocks that already have a rendered motion
  motionTotal: number;      // blocks that should have a motion
  batch: { current: number; total: number } | null;
  /** Cancel the running motion batch — stops after the current block. */
  onCancelBatch?: () => void;
  onAudio: () => void;
  onAvatars: () => void;
  onMotions: () => void;
  onExport?: () => void;
  /** Prontidão por bloco de avatar (pra mostrar B1✓ B2✓ B3⏳ na trilha). */
  avatarChips?: Array<'done' | 'running' | 'error' | 'pending'>;
}

const VIOLET = '#60A5FA';
const EMERALD = '#34D399';
const RED = '#F87171';

type PhaseState = 'locked' | 'pending' | 'running' | 'done' | 'error';

export function MontarBar({
  tokens, audioStatus, avatarTotal, avatarReady, generatingClips,
  motionCandidates, motionDone, motionTotal, batch, onCancelBatch,
  onAudio, onAvatars, onMotions, onExport, avatarChips,
}: MontarBarProps) {
  const audioReady = audioStatus === 'ready';

  const audioPhase: PhaseState =
    audioStatus === 'ready' ? 'done'
    : audioStatus === 'generating' ? 'running'
    : audioStatus === 'error' ? 'error'
    : 'pending';

  const avatarPhase: PhaseState =
    !audioReady ? 'locked'
    : generatingClips ? 'running'
    : avatarTotal > 0 && avatarReady >= avatarTotal ? 'done'
    : 'pending';

  const motionPhase: PhaseState =
    !audioReady ? 'locked'
    : batch ? 'running'
    : motionTotal > 0 && motionDone >= motionTotal ? 'done'
    : 'pending';

  const phases: Array<{
    key: string; icon: string; title: string; sub: string;
    state: PhaseState; pct: number; onClick: () => void;
    chips?: Array<'done' | 'running' | 'error' | 'pending'>;
  }> = [
    {
      key: 'audio', icon: '🎙', title: 'Áudio',
      sub: audioPhase === 'done' ? 'pronto' : audioPhase === 'running' ? 'gerando…' : audioPhase === 'error' ? 'erro · tente de novo' : 'narração · define o tempo',
      state: audioPhase, pct: audioPhase === 'done' ? 100 : audioPhase === 'running' ? 60 : 0,
      onClick: onAudio,
    },
    {
      key: 'avatar', icon: '🧑', title: 'Avatares',
      sub: avatarPhase === 'locked' ? 'gere o áudio antes'
        : avatarPhase === 'running' ? 'gerando…'
        : avatarTotal === 0 ? 'nenhum bloco avatar'
        : `${avatarReady}/${avatarTotal} prontos`,
      state: avatarPhase, pct: avatarTotal > 0 ? Math.round((avatarReady / avatarTotal) * 100) : 0,
      onClick: onAvatars,
      chips: avatarChips,
    },
    {
      key: 'motion', icon: '✨', title: 'Motions',
      sub: motionPhase === 'locked' ? 'gere o áudio antes'
        : batch ? `${batch.current} de ${batch.total}…`
        : motionCandidates > 0 ? `${motionCandidates} pra gerar`
        : motionTotal > 0 ? `${motionDone}/${motionTotal} prontos` : 'estilo automático',
      state: motionPhase, pct: motionTotal > 0 ? Math.round((motionDone / motionTotal) * 100) : 0,
      onClick: onMotions,
    },
  ];

  const accent = (s: PhaseState) => s === 'done' ? EMERALD : s === 'error' ? RED : VIOLET;

  // Próximo passo recomendado — um único CTA que mata o "e agora?".
  // Complementa (não substitui) os botões de fase: eles dão acesso manual a
  // qualquer etapa; este destaca a única ação que faz sentido agora.
  const nextStep: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean } | null = (() => {
    if (audioPhase === 'running') return { label: 'Gerando áudio…', onClick: () => {}, disabled: true, busy: true };
    if (audioPhase === 'error')   return { label: 'Tentar áudio de novo', onClick: onAudio };
    if (audioPhase !== 'done')     return { label: 'Gerar áudio', onClick: onAudio };
    if (avatarPhase === 'running') return { label: 'Gerando avatares…', onClick: () => {}, disabled: true, busy: true };
    if (avatarPhase === 'pending' && avatarTotal > 0)
      return { label: avatarReady > 0 ? `Gerar avatares · faltam ${avatarTotal - avatarReady}` : 'Gerar avatares', onClick: onAvatars };
    if (motionPhase === 'running') return { label: 'Gerando motions…', onClick: () => {}, disabled: true, busy: true };
    if (motionPhase === 'pending' && motionCandidates > 0)
      return { label: `Gerar motions (${motionCandidates})`, onClick: onMotions };
    if (onExport) return { label: 'Exportar reel', onClick: onExport };
    return null;
  })();

  return (
    <div className="px-5 py-2.5 border-t border-white/5 flex items-center gap-3 shrink-0" style={{ backgroundColor: tokens.bg.surface }}>
      <div className="shrink-0 text-[12px] font-bold flex items-center gap-1.5" style={{ color: tokens.text.primary }}>
        🛠 Montar Reels
        <span className="text-[10px] font-medium" style={{ color: tokens.text.tertiary }}>· em fases</span>
      </div>

      <div className="flex items-stretch gap-2 flex-1 min-w-0">
        {phases.map((p, i) => {
          const locked = p.state === 'locked';
          const done = p.state === 'done';
          const running = p.state === 'running';
          const border = done ? `${EMERALD}66` : p.state === 'error' ? `${RED}66` : (running ? `${VIOLET}88` : tokens.border.subtle);
          return (
            <div key={p.key} className="flex items-center gap-2 flex-1 min-w-0">
              <button
                onClick={p.onClick}
                disabled={locked || running}
                className="flex-1 min-w-0 rounded-lg px-3 py-2 text-left transition-colors"
                style={{
                  backgroundColor: done ? `${EMERALD}14` : 'rgba(0,0,0,0.22)',
                  border: `1px solid ${border}`,
                  opacity: locked ? 0.5 : 1,
                  cursor: locked || running ? 'default' : 'pointer',
                }}
                title={locked ? 'Conclua a fase anterior primeiro' : `Gerar ${p.title.toLowerCase()}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11.5px] font-bold flex items-center gap-1.5" style={{ color: tokens.text.primary }}>
                    <span>{p.icon}</span>{p.title}
                  </div>
                  <div className="text-[10px] font-semibold" style={{ color: accent(p.state) }}>
                    {done ? '✓' : running ? '…' : p.state === 'error' ? '!' : `${i + 1}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="text-[10px] truncate flex-1 min-w-0" style={{ color: tokens.text.tertiary }}>{p.sub}</div>
                  {/* Explicit action affordance — the whole card is clickable,
                      but a card with a progress bar reads as a status indicator.
                      This pill makes the action discoverable. */}
                  {p.state === 'pending' && (
                    <span
                      className="shrink-0 text-[9.5px] font-bold px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: VIOLET, color: '#fff' }}
                    >
                      {p.key === 'motion' ? `⚡ Gerar todos (${motionCandidates})` : p.key === 'avatar' ? `Gerar (${avatarTotal - avatarReady})` : 'Gerar'}
                    </span>
                  )}
                  {/* Cancel pill — visible while the motion batch runs. Stops
                      after the block currently generating (in-flight call
                      finishes; the loop doesn't start the next one). */}
                  {p.key === 'motion' && p.state === 'running' && batch && onCancelBatch && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); onCancelBatch(); }}
                      className="shrink-0 text-[9.5px] font-bold px-2 py-0.5 rounded-md cursor-pointer"
                      style={{ backgroundColor: 'rgba(239,68,68,0.18)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
                      title="Para depois do bloco atual terminar"
                    >
                      ✕ Cancelar
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1 rounded overflow-hidden" style={{ backgroundColor: tokens.border.subtle }}>
                  <div className="h-full rounded" style={{ width: `${p.pct}%`, backgroundColor: accent(p.state), transition: 'width 0.3s' }} />
                </div>
                {p.chips && p.chips.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {p.chips.slice(0, 14).map((c, ci) => (
                      <span
                        key={ci}
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        title={`Bloco ${ci + 1}: ${c === 'done' ? 'pronto' : c === 'running' ? 'gerando' : c === 'error' ? 'erro' : 'pendente'}`}
                        style={{ backgroundColor: c === 'done' ? EMERALD : c === 'error' ? RED : c === 'running' ? VIOLET : tokens.border.default }}
                      />
                    ))}
                    {p.chips.length > 14 && (
                      <span className="text-[8px] font-semibold" style={{ color: tokens.text.tertiary }}>+{p.chips.length - 14}</span>
                    )}
                  </div>
                )}
              </button>
              {i < phases.length - 1 && <span className="shrink-0 text-[13px]" style={{ color: tokens.text.tertiary }}>→</span>}
            </div>
          );
        })}
      </div>

      {/* Próximo passo — único CTA recomendado */}
      {nextStep && (
        <div className="shrink-0 flex items-center gap-2 pl-3 ml-1 border-l" style={{ borderColor: tokens.border.subtle }}>
          <span className="text-[9px] uppercase tracking-wider font-semibold hidden xl:block" style={{ color: tokens.text.tertiary }}>Próximo</span>
          <button
            onClick={nextStep.onClick}
            disabled={nextStep.disabled}
            className="px-4 py-2 rounded-lg text-[12px] font-bold transition-opacity flex items-center gap-1.5 whitespace-nowrap"
            style={{
              backgroundColor: nextStep.busy ? tokens.bg.active : tokens.accent.bg,
              color: nextStep.busy ? tokens.text.secondary : tokens.accent.fg,
              opacity: nextStep.disabled ? 0.7 : 1,
              cursor: nextStep.disabled ? 'default' : 'pointer',
            }}
            title="Próximo passo recomendado"
          >
            {nextStep.label}{!nextStep.disabled && <span>→</span>}
          </button>
        </div>
      )}
    </div>
  );
}
