/**
 * LandingScreen — first screen on a cold start (no active project).
 *
 * Two choices: "Abrir projeto" (existing) or "Novo projeto" (guided creation).
 * Rendered as a full-screen overlay (z-[90]) ABOVE the editor but BELOW the
 * app modals (projects list / wizard at z-[100]), so clicking "Abrir" can pop
 * the existing projects modal on top of this screen, and "Novo" opens the
 * guided wizard on top — both without unmounting the editor underneath.
 *
 * Purely presentational: all state/handlers live in ReelsStudio.
 */

import type { ThemeTokens } from './theme';

interface LandingScreenProps {
  tokens: ThemeTokens;
  isLight: boolean;
  /** Number of saved projects (shown as a hint on the "Abrir" card). */
  projectCount?: number;
  onOpenProject: () => void;
  onNewProject: () => void;
}

const VIOLET = '#A78BFA';

export function LandingScreen({ tokens, isLight, projectCount, onOpenProject, onNewProject }: LandingScreenProps) {
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center p-8"
      style={{
        backgroundColor: tokens.bg.canvas,
        color: tokens.text.primary,
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }}
    >
      <div className="text-center mb-10">
        <div
          className="text-[28px] font-extrabold tracking-tight"
          style={{ color: tokens.text.primary }}
        >
          Reels Studio
        </div>
        <div className="text-sm mt-2" style={{ color: tokens.text.secondary }}>
          O que você quer fazer?
        </div>
      </div>

      <div className="flex flex-wrap gap-5 justify-center">
        {/* Abrir projeto */}
        <button
          onClick={onOpenProject}
          className="w-[260px] text-left rounded-2xl p-7 transition-all hover:-translate-y-0.5"
          style={{
            backgroundColor: tokens.bg.surface,
            border: `1px solid ${tokens.border.subtle}`,
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = VIOLET; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
        >
          <div className="text-[32px] mb-3.5 leading-none">📂</div>
          <div className="text-[17px] font-bold mb-1.5" style={{ color: tokens.text.primary }}>
            Abrir projeto
          </div>
          <div className="text-xs leading-relaxed" style={{ color: tokens.text.tertiary }}>
            {projectCount && projectCount > 0
              ? `Continuar um dos seus ${projectCount} projetos. Vai direto pra timeline.`
              : 'Continuar um Reel que você já começou. Vai direto pra timeline.'}
          </div>
        </button>

        {/* Novo projeto */}
        <button
          onClick={onNewProject}
          className="w-[260px] text-left rounded-2xl p-7 transition-all hover:-translate-y-0.5"
          style={{
            backgroundColor: tokens.bg.surface,
            border: `1px solid ${tokens.border.subtle}`,
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = VIOLET; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
        >
          <div className="text-[32px] mb-3.5 leading-none">✨</div>
          <div className="text-[17px] font-bold mb-1.5" style={{ color: tokens.text.primary }}>
            Novo projeto
          </div>
          <div className="text-xs leading-relaxed" style={{ color: tokens.text.tertiary }}>
            Começar do zero a partir de um texto, link de artigo ou vídeo.
          </div>
        </button>
      </div>
    </div>
  );
}
