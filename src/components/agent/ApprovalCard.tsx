// Inline approval card rendered inside the chat history when the agent
// asks permission to run a write tool.
//
// Style: Apple-quiet. No amber/alarm vibe; we use the app's neutral tokens
// with the accent border to draw the eye. The primary action ("Allow") is
// the only filled button so the user reads visual hierarchy correctly.

import React from 'react';
import type { ThemeTokens } from '../reelsStudio/theme';
import type { Locale } from './i18n';
import { t } from './i18n';

interface Props {
  toolName: string;
  toolInput: unknown;
  resolved?: 'allow' | 'deny';
  tokens: ThemeTokens;
  locale: Locale;
  onDecide: (allow: boolean) => void;
}

/// Produces a tiny one-line summary so the user grasps WHAT will happen
/// without expanding the JSON details.
function summarizeArgs(toolName: string, input: unknown, locale: Locale): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const innerInput = (obj.input ?? input) as Record<string, unknown>;
  const short = toolName.replace(/^mcp__reels__/, '');
  const get = (k: string) => (innerInput[k] ?? obj[k]) as string | undefined;

  switch (short) {
    case 'regenerate_block':
    case 'edit_block_text':
    case 'set_block_layout':
    case 'remove_block': {
      const id = get('id');
      return id ? (locale === 'pt' ? `Bloco ${id.slice(0, 6)}…` : `Block ${id.slice(0, 6)}…`) : '';
    }
    case 'add_block': {
      const kind = get('kind');
      return kind
        ? locale === 'pt'
          ? `Novo bloco (${kind})`
          : `New block (${kind})`
        : '';
    }
    case 'generate_audio':
      return locale === 'pt'
        ? 'Gera áudio do roteiro inteiro · ~$0.015/min via Minimax'
        : 'Generates audio for the whole script · ~$0.015/min via Minimax';
    case 'remove_silences': {
      const preset = get('preset') ?? 'fast';
      return locale === 'pt' ? `Preset: ${preset}` : `Preset: ${preset}`;
    }
    case 'set_voice': {
      const v = get('voice_id');
      return v ? `${locale === 'pt' ? 'Voz' : 'Voice'}: ${v.slice(0, 16)}…` : '';
    }
    default:
      return '';
  }
}

export const ApprovalCard: React.FC<Props> = ({
  toolName,
  toolInput,
  resolved,
  tokens,
  locale,
  onDecide,
}) => {
  const shortName = toolName.replace(/^mcp__reels__/, '');
  const summary = summarizeArgs(toolName, toolInput, locale);

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
          {t(locale, 'approval.title')}
        </div>
        <div className="text-[11.5px]" style={{ color: tokens.text.secondary }}>
          {t(locale, 'approval.subtitle', { tool: shortName })}
        </div>
      </div>

      {summary && (
        <div className="text-[12px]" style={{ color: tokens.text.primary }}>
          {summary}
        </div>
      )}

      <details className="text-[11px]" style={{ color: tokens.text.tertiary }}>
        <summary className="cursor-pointer select-none">{t(locale, 'approval.viewArgs')}</summary>
        <pre
          className="mt-2 max-h-32 overflow-auto p-2 rounded-lg text-[10.5px] font-mono whitespace-pre-wrap break-all"
          style={{
            backgroundColor: tokens.bg.canvas,
            border: `1px solid ${tokens.border.subtle}`,
            color: tokens.text.secondary,
          }}
        >
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      </details>

      {resolved ? (
        <div
          className="text-[11.5px] font-medium"
          style={{ color: resolved === 'allow' ? tokens.status.ok : tokens.status.err }}
        >
          {resolved === 'allow' ? t(locale, 'approval.allowed') : t(locale, 'approval.rejected')}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDecide(true)}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: tokens.accent.bg,
              color: tokens.accent.fg,
            }}
          >
            {t(locale, 'approval.allow')}
          </button>
          <button
            onClick={() => onDecide(false)}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: tokens.text.secondary,
              border: `1px solid ${tokens.border.default}`,
            }}
          >
            {t(locale, 'approval.reject')}
          </button>
        </div>
      )}
    </div>
  );
};
