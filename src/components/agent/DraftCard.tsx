// Inline "preview before apply" card. Shows the blocks an import tool
// (video URL, article, full-script recreate, carousel) generated, so the
// user can sanity-check before the project gets overwritten.
//
// Layout: scrollable list of block summaries with role tags, then two
// buttons — Aplicar (primary) / Descartar. After a choice, the card
// switches to a resolved state so the user can see what they picked.

import React from 'react';
import type { ThemeTokens } from '../reelsStudio/theme';
import type { Locale } from './i18n';
import { t } from './i18n';
import type { DraftPreview } from './useAgentChat';

interface Props {
  draft: DraftPreview;
  tokens: ThemeTokens;
  locale: Locale;
  onApply: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}

export const DraftCard: React.FC<Props> = ({ draft, tokens, locale, onApply, onDiscard }) => {
  const resolved = draft.resolved;
  const blocks = draft.blocks ?? [];
  const isReel = draft.kind === 'reel';

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        backgroundColor: tokens.bg.surface,
        border: `1px solid ${tokens.border.default}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div className="space-y-0.5">
        <div className="text-[13px] font-semibold" style={{ color: tokens.text.primary }}>
          {isReel
            ? t(locale, 'draft.titleReel', { n: blocks.length })
            : t(locale, 'draft.titleCarousel', { n: blocks.length })}
        </div>
        <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
          {draft.meta ? `${draft.meta} · ${draft.source}` : draft.source}
        </div>
      </div>

      {/* Preview list — capped height with scroll so long reels don't blow
          up the chat. */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: tokens.bg.canvas,
          border: `1px solid ${tokens.border.subtle}`,
        }}
      >
        <div className="max-h-[280px] overflow-y-auto divide-y" style={{ borderColor: tokens.border.subtle }}>
          {blocks.map((b, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2.5">
              <span
                className="text-[9.5px] uppercase tracking-wider font-semibold mt-0.5 shrink-0 rounded-full px-1.5 py-0.5"
                style={{
                  backgroundColor:
                    b.kind === 'avatar'
                      ? tokens.accent.focus + '15'
                      : tokens.bg.elevated,
                  color: b.kind === 'avatar' ? tokens.accent.focus : tokens.text.secondary,
                  border: `1px solid ${
                    b.kind === 'avatar' ? tokens.accent.focus + '30' : tokens.border.subtle
                  }`,
                }}
              >
                {b.kind === 'avatar' ? 'avatar' : 'b-roll'}
              </span>
              <div
                className="text-[11.5px] leading-snug flex-1 min-w-0"
                style={{ color: tokens.text.primary }}
              >
                {b.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {resolved ? (
        <div
          className="text-[11.5px] font-medium"
          style={{
            color:
              resolved === 'applied' ? tokens.status.ok : tokens.text.tertiary,
          }}
        >
          {resolved === 'applied'
            ? `✓ ${t(locale, 'draft.applied')}`
            : t(locale, 'draft.discarded')}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onApply(draft.draftId)}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: tokens.accent.bg,
              color: tokens.accent.fg,
            }}
          >
            {t(locale, 'draft.apply')}
          </button>
          <button
            onClick={() => onDiscard(draft.draftId)}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: tokens.text.secondary,
              border: `1px solid ${tokens.border.default}`,
            }}
          >
            {t(locale, 'draft.discard')}
          </button>
        </div>
      )}
    </div>
  );
};
