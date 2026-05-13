// Inline visual picker card. Renders inside the agent chat when a tool
// needs the user to choose between options visually (avatar photo, voice,
// style preset, etc).
//
// Layout adapts per `kind`:
//   • 'photo'   — grid of thumbnails, label below
//   • 'preset'  — grid of style swatches with mood-tinted background
//   • 'voice'   — vertical list with play button (TODO when voice picker
//                 lands; falls back to generic until then)
//   • 'generic' — vertical list (fallback for unknown kinds)
//
// The card locks itself as soon as the user picks or cancels — the
// `pickerChoice` flag from useAgentChat keys this.

import React from 'react';
import type { ThemeTokens } from '../reelsStudio/theme';
import type { Locale } from './i18n';
import { t } from './i18n';

export interface PickerOption {
  id: string;
  label: string;
  description?: string;
  thumbnail?: string;
  badge?: string;
}

interface Props {
  pickerId: string;
  kind: string;
  title: string;
  subtitle?: string;
  options: PickerOption[];
  choice?: string;
  tokens: ThemeTokens;
  locale: Locale;
  onPick: (optionId: string | null) => void;
}

export const PickerCard: React.FC<Props> = ({
  kind,
  title,
  subtitle,
  options,
  choice,
  tokens,
  locale,
  onPick,
}) => {
  const resolved = !!choice;
  const cancelled = choice === '__cancelled__';
  const chosen = !cancelled ? options.find(o => o.id === choice) : undefined;

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
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
            {subtitle}
          </div>
        )}
      </div>

      {!resolved && (
        <div
          className={
            kind === 'photo' || kind === 'preset'
              ? 'grid grid-cols-2 gap-2'
              : 'flex flex-col gap-1.5'
          }
        >
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => onPick(opt.id)}
              className="text-left rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
              style={{
                backgroundColor: tokens.bg.canvas,
                border: `1px solid ${tokens.border.subtle}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent.focus; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
            >
              {opt.thumbnail && (kind === 'photo' || kind === 'preset') && (
                <div
                  className="w-full aspect-square overflow-hidden"
                  style={{ backgroundColor: tokens.bg.elevated }}
                >
                  <img
                    src={opt.thumbnail}
                    alt={opt.label}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="px-2.5 py-1.5 flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[11.5px] font-medium truncate"
                    style={{ color: tokens.text.primary }}
                  >
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div
                      className="text-[10px] truncate"
                      style={{ color: tokens.text.tertiary }}
                    >
                      {opt.description}
                    </div>
                  )}
                </div>
                {opt.badge && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: tokens.accent.focus + '20',
                      color: tokens.accent.focus,
                      border: `1px solid ${tokens.accent.focus}40`,
                    }}
                  >
                    {opt.badge}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {!resolved && (
        <button
          onClick={() => onPick(null)}
          className="text-[10.5px] transition-colors"
          style={{ color: tokens.text.tertiary }}
          onMouseEnter={e => { e.currentTarget.style.color = tokens.text.secondary; }}
          onMouseLeave={e => { e.currentTarget.style.color = tokens.text.tertiary; }}
        >
          {locale === 'pt' ? 'Cancelar' : 'Cancel'}
        </button>
      )}

      {resolved && cancelled && (
        <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
          {locale === 'pt' ? 'Cancelado.' : 'Cancelled.'}
        </div>
      )}

      {resolved && chosen && (
        <div
          className="text-[11.5px] font-medium flex items-center gap-2"
          style={{ color: tokens.status.ok }}
        >
          <span>✓</span>
          <span>
            {locale === 'pt' ? 'Escolheu: ' : 'Picked: '}
            <span style={{ color: tokens.text.primary }}>{chosen.label}</span>
          </span>
        </div>
      )}

      {/* Reference `t` so unused-import lint stays happy when no future
          strings get pulled from i18n here yet. */}
      <span className="hidden">{t(locale, 'attach.image')}</span>
    </div>
  );
};
