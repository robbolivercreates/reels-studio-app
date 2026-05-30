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
  onAudio: () => void;
  onAvatars: () => void;
  onMotions: () => void;
}

const VIOLET = '#60A5FA';
const EMERALD = '#34D399';
const RED = '#F87171';

type PhaseState = 'locked' | 'pending' | 'running' | 'done' | 'error';

export function MontarBar({
  tokens, audioStatus, avatarTotal, avatarReady, generatingClips,
  motionCandidates, motionDone, motionTotal, batch,
  onAudio, onAvatars, onMotions,
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
                <div className="text-[10px] mt-0.5 truncate" style={{ color: tokens.text.tertiary }}>{p.sub}</div>
                <div className="mt-1.5 h-1 rounded overflow-hidden" style={{ backgroundColor: tokens.border.subtle }}>
                  <div className="h-full rounded" style={{ width: `${p.pct}%`, backgroundColor: accent(p.state), transition: 'width 0.3s' }} />
                </div>
              </button>
              {i < phases.length - 1 && <span className="shrink-0 text-[13px]" style={{ color: tokens.text.tertiary }}>→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
