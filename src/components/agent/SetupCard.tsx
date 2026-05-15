// Pre-flight setup card. Surfaced in the chat right before a video URL
// import runs, so the user can dial duration/tone/focus once instead of
// the typical 3-4 cycles of "ok, more detail / shorter / different tone".
//
// Mirrors the controls of the standalone "Criar com IA" wizard inside
// the app — same defaults, same vocabulary, so the experience is
// consistent whether the user kicks off an import from the wizard or
// from the chat.

import React, { useState } from 'react';
import type { ThemeTokens } from '../reelsStudio/theme';
import type { Locale } from './i18n';
import { t } from './i18n';

export interface SetupChoice {
  /** Target reel duration in seconds. `null` = "same as original" (let the
   *  analyser decide based on the source video). */
  durationSec: number | null;
  /** Voice tone. `'original'` = preserve the source author's vibe. */
  tone: 'original' | 'casual' | 'direct' | 'educational';
  /** What to do with the content. */
  focus: 'adapt' | 'summarize' | 'detail';
}

interface Props {
  tokens: ThemeTokens;
  locale: Locale;
  /** Title hint — e.g. "Pronto pra importar esse reel". */
  title?: string;
  /** Subtitle hint — e.g. URL or filename. */
  subtitle?: string;
  resolved?: 'submitted' | 'skipped' | 'cancelled';
  onSubmit: (choice: SetupChoice) => void;
  onSkip: () => void;
  onCancel: () => void;
}

const DEFAULTS: SetupChoice = {
  durationSec: null,
  tone: 'original',
  focus: 'adapt',
};

interface ChipProps<T> {
  value: T;
  current: T;
  onPick: (v: T) => void;
  tokens: ThemeTokens;
  children: React.ReactNode;
}

function Chip<T>({ value, current, onPick, tokens, children }: ChipProps<T>) {
  const active = value === current;
  return (
    <button
      onClick={() => onPick(value)}
      className="text-[11px] font-medium rounded-full px-2.5 py-1 transition-colors"
      style={{
        backgroundColor: active ? tokens.accent.bg : tokens.bg.canvas,
        color: active ? tokens.accent.fg : tokens.text.secondary,
        border: `1px solid ${active ? tokens.accent.bg : tokens.border.subtle}`,
      }}
    >
      {children}
    </button>
  );
}

export const SetupCard: React.FC<Props> = ({
  tokens,
  locale,
  title,
  subtitle,
  resolved,
  onSubmit,
  onSkip,
  onCancel,
}) => {
  const [choice, setChoice] = useState<SetupChoice>(DEFAULTS);

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
          {title ?? t(locale, 'setup.title')}
        </div>
        {subtitle && (
          <div className="text-[11px] truncate" style={{ color: tokens.text.tertiary }}>
            {subtitle}
          </div>
        )}
      </div>

      {!resolved && (
        <>
          {/* Duration */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>
              {t(locale, 'setup.duration')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip value={null} current={choice.durationSec} onPick={v => setChoice(c => ({ ...c, durationSec: v }))} tokens={tokens}>
                {t(locale, 'setup.duration.original')}
              </Chip>
              <Chip value={15} current={choice.durationSec} onPick={v => setChoice(c => ({ ...c, durationSec: v }))} tokens={tokens}>15s</Chip>
              <Chip value={30} current={choice.durationSec} onPick={v => setChoice(c => ({ ...c, durationSec: v }))} tokens={tokens}>30s</Chip>
              <Chip value={45} current={choice.durationSec} onPick={v => setChoice(c => ({ ...c, durationSec: v }))} tokens={tokens}>45s</Chip>
              <Chip value={60} current={choice.durationSec} onPick={v => setChoice(c => ({ ...c, durationSec: v }))} tokens={tokens}>60s</Chip>
            </div>
          </div>

          {/* Tone */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>
              {t(locale, 'setup.tone')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip<SetupChoice['tone']> value="original" current={choice.tone} onPick={v => setChoice(c => ({ ...c, tone: v }))} tokens={tokens}>
                {t(locale, 'setup.tone.original')}
              </Chip>
              <Chip<SetupChoice['tone']> value="casual" current={choice.tone} onPick={v => setChoice(c => ({ ...c, tone: v }))} tokens={tokens}>
                {t(locale, 'setup.tone.casual')}
              </Chip>
              <Chip<SetupChoice['tone']> value="direct" current={choice.tone} onPick={v => setChoice(c => ({ ...c, tone: v }))} tokens={tokens}>
                {t(locale, 'setup.tone.direct')}
              </Chip>
              <Chip<SetupChoice['tone']> value="educational" current={choice.tone} onPick={v => setChoice(c => ({ ...c, tone: v }))} tokens={tokens}>
                {t(locale, 'setup.tone.educational')}
              </Chip>
            </div>
          </div>

          {/* Focus */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>
              {t(locale, 'setup.focus')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip<SetupChoice['focus']> value="adapt" current={choice.focus} onPick={v => setChoice(c => ({ ...c, focus: v }))} tokens={tokens}>
                {t(locale, 'setup.focus.adapt')}
              </Chip>
              <Chip<SetupChoice['focus']> value="summarize" current={choice.focus} onPick={v => setChoice(c => ({ ...c, focus: v }))} tokens={tokens}>
                {t(locale, 'setup.focus.summarize')}
              </Chip>
              <Chip<SetupChoice['focus']> value="detail" current={choice.focus} onPick={v => setChoice(c => ({ ...c, focus: v }))} tokens={tokens}>
                {t(locale, 'setup.focus.detail')}
              </Chip>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onSubmit(choice)}
              className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: tokens.accent.bg,
                color: tokens.accent.fg,
              }}
            >
              {t(locale, 'setup.submit')}
            </button>
            <button
              onClick={onSkip}
              className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
              style={{
                backgroundColor: 'transparent',
                color: tokens.text.secondary,
                border: `1px solid ${tokens.border.default}`,
              }}
            >
              {t(locale, 'setup.skip')}
            </button>
            <button
              onClick={onCancel}
              className="ml-auto text-[10.5px] transition-colors"
              style={{ color: tokens.text.tertiary }}
              onMouseEnter={e => { e.currentTarget.style.color = tokens.text.secondary; }}
              onMouseLeave={e => { e.currentTarget.style.color = tokens.text.tertiary; }}
            >
              {t(locale, 'setup.cancel')}
            </button>
          </div>
        </>
      )}

      {resolved === 'submitted' && (
        <div className="text-[11.5px] font-medium flex items-center gap-2" style={{ color: tokens.status.ok }}>
          <span>✓</span>
          <span>{t(locale, 'setup.submitted')}</span>
        </div>
      )}
      {resolved === 'skipped' && (
        <div className="text-[11.5px]" style={{ color: tokens.text.tertiary }}>
          {t(locale, 'setup.skipped')}
        </div>
      )}
      {resolved === 'cancelled' && (
        <div className="text-[11.5px]" style={{ color: tokens.text.tertiary }}>
          {t(locale, 'setup.cancelled')}
        </div>
      )}
    </div>
  );
};
