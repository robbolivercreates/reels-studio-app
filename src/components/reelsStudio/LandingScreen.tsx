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

import { useEffect } from 'react';
import type { ThemeTokens } from './theme';

interface LandingScreenProps {
  tokens: ThemeTokens;
  isLight: boolean;
  /** Number of saved projects (shown as a hint on the "Abrir" card). */
  projectCount?: number;
  onOpenProject: () => void;
  onNewProject: () => void;
  /** "Editar vídeo pronto" — upload a finished video, cut silences, add motions. */
  onEditVideo: () => void;
  /**
   * Dismiss the landing back to the current editor. Provided when the landing
   * is opened mid-session via the top-bar "Início" button (so the user can
   * change their mind without losing the open project). Omitted on cold start.
   */
  onClose?: () => void;
}

const VIOLET = '#60A5FA';

export function LandingScreen({ tokens, isLight, projectCount, onOpenProject, onNewProject, onEditVideo, onClose }: LandingScreenProps) {
  // ESC returns to the editor when the landing is dismissible.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center p-8"
      style={{
        backgroundColor: tokens.bg.canvas,
        color: tokens.text.primary,
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }}
    >
      {/* Close (only when dismissible — i.e. opened mid-session). Returns to
          the current editor. ESC does the same. */}
      {onClose && (
        <button
          onClick={onClose}
          title="Fechar (Esc) — voltar pro projeto"
          className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ color: tokens.text.secondary, backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}` }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = VIOLET; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

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

        {/* Editar vídeo pronto */}
        <button
          onClick={onEditVideo}
          className="w-[260px] text-left rounded-2xl p-7 transition-all hover:-translate-y-0.5"
          style={{
            backgroundColor: tokens.bg.surface,
            border: `1px solid ${tokens.border.subtle}`,
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = VIOLET; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
        >
          <div className="text-[32px] mb-3.5 leading-none">🎞️</div>
          <div className="text-[17px] font-bold mb-1.5" style={{ color: tokens.text.primary }}>
            Editar vídeo
          </div>
          <div className="text-xs leading-relaxed" style={{ color: tokens.text.tertiary }}>
            Subir um vídeo pronto, transcrever, cortar silêncios e ilustrar com motions.
          </div>
        </button>
      </div>
    </div>
  );
}
