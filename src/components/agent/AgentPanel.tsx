/**
 * Renders agent text with minimal inline markdown:
 *   **bold**   → <strong>
 *   *italic*   → <em>
 *   `code`     → <code>
 * Whitespace + newlines are preserved by the parent's `whitespace-pre-wrap`.
 * Nothing else is parsed — no headings, no lists, no links. The system prompt
 * forbids those.
 */
const renderInlineMarkdown = (text: string): React.ReactNode[] => {
  // Tokenise on the 3 patterns, longest-first to avoid `**` being eaten by `*`.
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-white/10 text-[12px] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

// Embedded chat panel that lives next to the editor (not over it).
//
// Visual language: Apple-quiet. Inherits the app's theme tokens (light/dark
// reactive), generous whitespace, soft shadows, neutral palette. Accent is
// the *only* color that pops, and only on focus / primary CTA.
//
// Features:
//   - i18n PT/EN with header toggle + navigator.language fallback
//   - Streaming assistant text (token-by-token via stream_event)
//   - Human-readable tool pills (no JSON visible by default)
//   - File attachments: 📎 button + drag-and-drop, image/video preview
//   - Model picker in the footer (Opus/Sonnet/Haiku) — Daydream-style
//   - Drag handle on left edge to resize, ⌘L toggles open/close

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAgentChat,
  type ChatMessage,
  type ClaudeModel,
  type AttachmentMeta,
} from './useAgentChat';
import { ApprovalCard } from './ApprovalCard';
import { PickerCard } from './PickerCard';
import { DraftCard } from './DraftCard';
import { SetupCard, type SetupChoice } from './SetupCard';
import { getHealth } from './agentBridge';
import type { ClaudeHealth } from './types';
import type { AppTheme, ThemeTokens } from '../reelsStudio/theme';
import { useTheme } from '../reelsStudio/useTheme';
import { type Locale, useLocale, t as tx } from './i18n';
import { labelFor } from './toolLabels';

const MIN_WIDTH = 340;
const MAX_WIDTH_FRACTION = 0.5;
const DEFAULT_WIDTH = 420;
const STORAGE_KEY = 'reels.agent.panelWidth';

interface Capability {
  icon: string;
  labelKey: string;
  descKey: string;
}

const CAPABILITIES: Capability[] = [
  { icon: '📋', labelKey: 'cap.list.label', descKey: 'cap.list.desc' },
  { icon: '🔍', labelKey: 'cap.read.label', descKey: 'cap.read.desc' },
  { icon: '📊', labelKey: 'cap.status.label', descKey: 'cap.status.desc' },
  { icon: '📝', labelKey: 'cap.edit.label', descKey: 'cap.edit.desc' },
  { icon: '🔄', labelKey: 'cap.regen.label', descKey: 'cap.regen.desc' },
  { icon: '➕', labelKey: 'cap.add.label', descKey: 'cap.add.desc' },
  { icon: '🗑', labelKey: 'cap.remove.label', descKey: 'cap.remove.desc' },
  { icon: '🎨', labelKey: 'cap.layout.label', descKey: 'cap.layout.desc' },
  { icon: '🎙', labelKey: 'cap.audio.label', descKey: 'cap.audio.desc' },
  { icon: '🖼', labelKey: 'cap.broll.label', descKey: 'cap.broll.desc' },
  { icon: '✂️', labelKey: 'cap.silences.label', descKey: 'cap.silences.desc' },
  { icon: '🗣', labelKey: 'cap.voice.label', descKey: 'cap.voice.desc' },
];

const SUGGESTION_KEYS = [
  'suggestion.list',
  'suggestion.regen',
  'suggestion.silences',
  'suggestion.cta',
] as const;

const MODEL_OPTIONS: Array<{ id: ClaudeModel; label: string; hintKey: string }> = [
  { id: 'opus', label: 'Opus 4.7', hintKey: 'model.opus.hint' },
  { id: 'sonnet', label: 'Sonnet 4.6', hintKey: 'model.sonnet.hint' },
  { id: 'haiku', label: 'Haiku 4.5', hintKey: 'model.haiku.hint' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  appTheme: AppTheme | undefined;
  /** Used to scope the Claude session id so each project keeps its own
   *  chat memory. Pass `state.projectName`; empty string falls back to
   *  a `_default` bucket. */
  projectKey: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function inferAttachmentKind(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

export const AgentPanel: React.FC<Props> = ({ open, onClose, appTheme, projectKey }) => {
  const tokens = useTheme(appTheme);
  const { locale, setLocale } = useLocale();
  const t = useCallback(
    (k: string, vars?: Record<string, string | number>) => tx(locale, k, vars),
    [locale],
  );

  const { messages, busy, send, cancel, approve, pick, proposeDraft, resolveDraft, updateDraft, proposeSetup, resolveSetup, clear, model, setModel } = useAgentChat(locale, projectKey);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [health, setHealth] = useState<ClaudeHealth | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  // Pending setup-card Promises, keyed by setupId. The bridge calls
  // `__reelsAgent.requestSetup(...)` which adds an entry here; the
  // user's SetupCard button click resolves it.
  const setupPromisesRef = useRef<
    Map<string, (result: { kind: 'submit'; choice: SetupChoice } | { kind: 'skip' } | { kind: 'cancel' }) => void>
  >(new Map());

  // Expose proposeDraft on `window` so the bridge layer
  // (useAgentToolBridge, which lives outside this component tree) can
  // surface drafts in the chat without prop drilling. Bridge calls:
  //   window.__reelsAgent?.proposeDraft({...})  → renders DraftCard
  // The bridge installs `applyDraft`/`discardDraft` on the same object so
  // the panel's button clicks can route back to the reducer.
  useEffect(() => {
    type ReelsAgentShim = {
      proposeDraft?: (draft: import('./useAgentChat').DraftPreview) => void;
      applyDraft?: (draftId: string) => void;
      discardDraft?: (draftId: string) => void;
      updateDraft?: (
        draftId: string,
        mutator: (blocks: Array<{ kind: 'avatar' | 'broll'; text: string }>) => Array<{
          kind: 'avatar' | 'broll';
          text: string;
        }>,
      ) => void;
      requestSetup?: (args: {
        title?: string;
        subtitle?: string;
      }) => Promise<{ kind: 'submit'; choice: SetupChoice } | { kind: 'skip' } | { kind: 'cancel' }>;
    };
    const w = window as unknown as Window & { __reelsAgent?: ReelsAgentShim };
    if (!w.__reelsAgent) w.__reelsAgent = {};
    w.__reelsAgent.proposeDraft = proposeDraft;
    w.__reelsAgent.updateDraft = updateDraft;
    w.__reelsAgent.requestSetup = (args) => {
      const setupId = `setup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      proposeSetup({ setupId, title: args.title, subtitle: args.subtitle });
      return new Promise(resolve => {
        setupPromisesRef.current.set(setupId, resolve);
      });
    };
    return () => {
      if (w.__reelsAgent) {
        delete w.__reelsAgent.proposeDraft;
        delete w.__reelsAgent.updateDraft;
        delete w.__reelsAgent.requestSetup;
      }
    };
  }, [proposeDraft, updateDraft, proposeSetup]);

  /// Click handlers for the DraftCard. We route through the bridge-installed
  /// shim (it knows the reducer + the full ScriptBlock objects), then mark
  /// the card as resolved locally so the UI doesn't bounce.
  const handleApplyDraft = useCallback(
    (draftId: string) => {
      const w = window as unknown as Window & {
        __reelsAgent?: { applyDraft?: (id: string) => void };
      };
      w.__reelsAgent?.applyDraft?.(draftId);
      resolveDraft(draftId, 'applied');
    },
    [resolveDraft],
  );
  const handleDiscardDraft = useCallback(
    (draftId: string) => {
      const w = window as unknown as Window & {
        __reelsAgent?: { discardDraft?: (id: string) => void };
      };
      w.__reelsAgent?.discardDraft?.(draftId);
      resolveDraft(draftId, 'discarded');
    },
    [resolveDraft],
  );

  // SetupCard click handlers — resolve the pending Promise so the
  // bridge handler can continue past `await requestSetup(...)`.
  const handleSetupSubmit = useCallback(
    (setupId: string, choice: SetupChoice) => {
      const resolver = setupPromisesRef.current.get(setupId);
      setupPromisesRef.current.delete(setupId);
      resolveSetup(setupId, 'submitted');
      resolver?.({ kind: 'submit', choice });
    },
    [resolveSetup],
  );
  const handleSetupSkip = useCallback(
    (setupId: string) => {
      const resolver = setupPromisesRef.current.get(setupId);
      setupPromisesRef.current.delete(setupId);
      resolveSetup(setupId, 'skipped');
      resolver?.({ kind: 'skip' });
    },
    [resolveSetup],
  );
  const handleSetupCancel = useCallback(
    (setupId: string) => {
      const resolver = setupPromisesRef.current.get(setupId);
      setupPromisesRef.current.delete(setupId);
      resolveSetup(setupId, 'cancelled');
      resolver?.({ kind: 'cancel' });
    },
    [resolveSetup],
  );

  useEffect(() => {
    if (!open) return;
    void getHealth().then(setHealth).catch(() => setHealth(null));
  }, [open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Cleanup attachment object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const next = window.innerWidth - e.clientX;
      const max = window.innerWidth * MAX_WIDTH_FRACTION;
      setWidth(Math.max(MIN_WIDTH, Math.min(max, next)));
    }
    function onUp() {
      draggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = useCallback(() => {
    draggingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const fresh: AttachmentMeta[] = [];
    for (const f of arr) {
      const kind = inferAttachmentKind(f);
      if (!kind) continue;
      fresh.push({
        id: uid(),
        kind,
        name: f.name,
        previewUrl: URL.createObjectURL(f),
        file: f,
        size: f.size,
      });
    }
    if (fresh.length > 0) setAttachments(prev => [...prev, ...fresh]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const next = prev.filter(a => {
        if (a.id !== id) return true;
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
        return false;
      });
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || busy) return;
    const atts = attachments;
    setInput('');
    setAttachments([]);
    void send(trimmed, atts).finally(() => {
      // Revoke URLs after send (preview row is now part of the message,
      // which keeps its own URL reference).
      for (const a of atts) {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
      }
    });
  }, [input, attachments, busy, send]);

  // Drag-drop on the entire panel area while a drag is over.
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  if (!open) return null;

  const allConnected = health?.installed && health?.authed && health?.registered;
  const currentModel = MODEL_OPTIONS.find(m => m.id === model) ?? MODEL_OPTIONS[1];

  return (
    <div
      className="relative h-full flex flex-col shrink-0"
      style={{
        width,
        backgroundColor: tokens.bg.surface,
        borderLeft: `1px solid ${tokens.border.subtle}`,
        color: tokens.text.primary,
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        className="absolute top-0 left-0 h-full w-1 cursor-col-resize z-10 transition-colors"
        style={{ backgroundColor: 'transparent' }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.accent.focus + '40'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        title="Resize"
      />

      {/* Drag-drop overlay */}
      {dragOver && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          style={{
            backgroundColor: tokens.bg.canvas + 'E6',
            border: `2px dashed ${tokens.accent.focus}`,
          }}
        >
          <div className="text-center space-y-1">
            <div className="text-2xl">📎</div>
            <div className="text-[12px] font-medium" style={{ color: tokens.text.primary }}>
              {t('input.attachHint')}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        className="px-4 py-3.5 flex items-center gap-2 shrink-0"
        style={{ borderBottom: `1px solid ${tokens.border.subtle}` }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold tracking-tight">{t('header.title')}</div>
          <div className="text-[10.5px] mt-0.5" style={{ color: tokens.text.tertiary }}>
            {allConnected ? (
              <span style={{ color: tokens.status.ok }}>● {t('header.connected')}</span>
            ) : (
              <span style={{ color: tokens.status.warn }}>● {t('header.notConnected')}</span>
            )}
          </div>
        </div>

        {/* Locale toggle */}
        <div className="relative">
          <button
            onClick={() => setLocaleMenuOpen(o => !o)}
            className="text-[11px] px-2 py-1 rounded-md transition-colors"
            style={{ color: tokens.text.secondary, backgroundColor: tokens.bg.hover }}
            title={t('locale.toggle')}
          >
            {locale === 'pt' ? '🇧🇷 PT' : '🇺🇸 EN'}
          </button>
          {localeMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setLocaleMenuOpen(false)} />
              <div
                className="absolute right-0 top-full mt-1 rounded-xl py-1 min-w-[120px] z-40"
                style={{
                  backgroundColor: tokens.bg.elevated,
                  border: `1px solid ${tokens.border.default}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}
              >
                {([['pt', '🇧🇷', 'Português'], ['en', '🇺🇸', 'English']] as const).map(([id, flag, label]) => (
                  <button
                    key={id}
                    onClick={() => { setLocale(id); setLocaleMenuOpen(false); }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors"
                    style={{
                      backgroundColor: locale === id ? tokens.bg.active : 'transparent',
                      color: tokens.text.primary,
                    }}
                    onMouseEnter={e => { if (locale !== id) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
                    onMouseLeave={e => { if (locale !== id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span>{flag}</span>
                    <span className="text-[12px]">{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {messages.length > 0 && (
          <button
            onClick={clear}
            className="text-[11px] px-2 py-1 rounded-md transition-colors"
            style={{ color: tokens.text.tertiary }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.bg.hover; e.currentTarget.style.color = tokens.text.secondary; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = tokens.text.tertiary; }}
          >
            {t('header.clear')}
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: tokens.text.tertiary }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.bg.hover; e.currentTarget.style.color = tokens.text.primary; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = tokens.text.tertiary; }}
          title={t('header.close')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <WelcomeScreen
            allConnected={!!allConnected}
            onPick={s => void send(s, [])}
            busy={busy}
            tokens={tokens}
            locale={locale}
          />
        )}

        {messages.map(m => (
          <MessageRow
            key={m.id}
            message={m}
            tokens={tokens}
            locale={locale}
            onApprove={approve}
            onPick={pick}
            onApplyDraft={handleApplyDraft}
            onDiscardDraft={handleDiscardDraft}
            onSetupSubmit={handleSetupSubmit}
            onSetupSkip={handleSetupSkip}
            onSetupCancel={handleSetupCancel}
          />
        ))}

        {busy && (
          <div
            className="flex items-center gap-2.5 text-[11.5px] mt-2"
            style={{ color: tokens.text.tertiary }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: tokens.accent.focus }}
            />
            {t('busy.thinking')}
            <button
              onClick={cancel}
              className="ml-auto px-2 py-0.5 text-[10.5px] rounded-md transition-colors"
              style={{ color: tokens.text.secondary }}
              onMouseEnter={e => { e.currentTarget.style.color = tokens.status.err; e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
              onMouseLeave={e => { e.currentTarget.style.color = tokens.text.secondary; e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {t('busy.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div
          className="px-4 py-2 flex items-center gap-2 overflow-x-auto shrink-0"
          style={{ borderTop: `1px solid ${tokens.border.subtle}` }}
        >
          {attachments.map(a => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              tokens={tokens}
              onRemove={() => removeAttachment(a.id)}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className="p-3 shrink-0"
        style={{ borderTop: `1px solid ${tokens.border.subtle}` }}
      >
        <div className="flex items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!allConnected || busy}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: tokens.text.secondary }}
            onMouseEnter={e => { if (allConnected && !busy) { e.currentTarget.style.backgroundColor = tokens.bg.hover; e.currentTarget.style.color = tokens.text.primary; } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = tokens.text.secondary; }}
            title={t('input.attach')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={allConnected ? t('input.placeholder') : t('input.disabledPlaceholder')}
            disabled={!allConnected || busy}
            rows={2}
            className="flex-1 resize-none rounded-lg text-[13px] px-3 py-2 focus:outline-none disabled:opacity-50"
            style={{
              backgroundColor: tokens.bg.canvas,
              border: `1px solid ${tokens.border.subtle}`,
              color: tokens.text.primary,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = tokens.accent.focus + '80'; }}
            onBlur={e => { e.currentTarget.style.borderColor = tokens.border.subtle; }}
          />

          <button
            onClick={submit}
            disabled={(!input.trim() && attachments.length === 0) || busy || !allConnected}
            className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-opacity hover:opacity-90 shrink-0"
            style={{
              backgroundColor: tokens.accent.bg,
              color: tokens.accent.fg,
            }}
            title={t('input.send')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>

        {/* Footer hints + model picker */}
        <div className="mt-2 flex items-center justify-between text-[10.5px]" style={{ color: tokens.text.tertiary }}>
          <div className="flex items-center gap-1.5">
            <span>{t('input.hint.enter')}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <div className="relative">
              <button
                onClick={() => setModelMenuOpen(o => !o)}
                className="inline-flex items-center gap-1 transition-colors"
                style={{ color: tokens.text.secondary }}
                onMouseEnter={e => { e.currentTarget.style.color = tokens.text.primary; }}
                onMouseLeave={e => { e.currentTarget.style.color = tokens.text.secondary; }}
              >
                {currentModel.label}
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              {modelMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setModelMenuOpen(false)} />
                  <div
                    className="absolute bottom-full mb-1.5 left-0 min-w-[180px] rounded-xl py-1.5 z-40"
                    style={{
                      backgroundColor: tokens.bg.elevated,
                      border: `1px solid ${tokens.border.default}`,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    }}
                  >
                    {MODEL_OPTIONS.map(opt => {
                      const active = opt.id === model;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => { setModel(opt.id); setModelMenuOpen(false); }}
                          className="w-full px-3 py-1.5 text-left transition-colors"
                          style={{
                            backgroundColor: active ? tokens.bg.active : 'transparent',
                            color: tokens.text.primary,
                          }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <div className="text-[12px] font-medium">{opt.label}</div>
                          <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>
                            {t(opt.hintKey)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          <span style={{ opacity: 0.7 }}>{t('input.hint.toggle')}</span>
        </div>
      </div>
    </div>
  );
};

// -------- Sub-components ------------------------------------------------

const WelcomeScreen: React.FC<{
  allConnected: boolean;
  busy: boolean;
  tokens: ThemeTokens;
  locale: Locale;
  onPick: (suggestion: string) => void;
}> = ({ allConnected, busy, tokens, locale, onPick }) => {
  const t = useCallback((k: string, vars?: Record<string, string | number>) => tx(locale, k, vars), [locale]);
  // Capabilities are collapsed by default — they're reference, not the
  // primary CTA. Apple-style: hide what isn't asked for.
  const [capsOpen, setCapsOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div className="text-[12.5px] leading-relaxed" style={{ color: tokens.text.secondary }}>
        {t('welcome.intro')}
      </div>

      {/* Suggestions are the primary CTA — surface them above the fold. */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>
          {t('welcome.suggestions')}
        </div>
        {SUGGESTION_KEYS.map(k => (
          <button
            key={k}
            onClick={() => onPick(t(k))}
            disabled={busy || !allConnected}
            className="w-full text-left px-3 py-2 rounded-xl text-[12px] transition-colors disabled:opacity-40"
            style={{
              backgroundColor: tokens.bg.canvas,
              border: `1px solid ${tokens.border.subtle}`,
              color: tokens.text.primary,
            }}
            onMouseEnter={e => { if (!busy && allConnected) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = tokens.bg.canvas; }}
          >
            {t(k)}
          </button>
        ))}
      </div>

      {/* Capabilities — collapsed by default. Reference material, not primary. */}
      <div className="space-y-2">
        <button
          onClick={() => setCapsOpen(o => !o)}
          className="w-full flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold transition-colors"
          style={{ color: tokens.text.tertiary }}
          onMouseEnter={e => { e.currentTarget.style.color = tokens.text.secondary; }}
          onMouseLeave={e => { e.currentTarget.style.color = tokens.text.tertiary; }}
        >
          <svg
            className="w-2.5 h-2.5 transition-transform"
            style={{ transform: capsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span>{t('welcome.capabilities')}</span>
          <span className="ml-auto normal-case font-normal text-[10px]" style={{ opacity: 0.7 }}>
            {CAPABILITIES.length}
          </span>
        </button>

        {capsOpen && (
          <div className="grid grid-cols-1 gap-1.5">
            {CAPABILITIES.map(c => (
              <div
                key={c.labelKey}
                className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                style={{
                  backgroundColor: tokens.bg.canvas,
                  border: `1px solid ${tokens.border.subtle}`,
                }}
              >
                <span className="text-[14px] shrink-0 leading-[1.2]">{c.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] font-semibold" style={{ color: tokens.text.primary }}>
                    {t(c.labelKey)}
                  </div>
                  <div className="text-[10.5px] leading-snug mt-0.5" style={{ color: tokens.text.tertiary }}>
                    {t(c.descKey)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const AttachmentChip: React.FC<{
  attachment: AttachmentMeta;
  tokens: ThemeTokens;
  onRemove: () => void;
}> = ({ attachment, tokens, onRemove }) => {
  return (
    <div
      className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg shrink-0 max-w-[200px]"
      style={{
        backgroundColor: tokens.bg.canvas,
        border: `1px solid ${tokens.border.subtle}`,
      }}
    >
      {attachment.kind === 'image' ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="w-7 h-7 rounded-md object-cover"
        />
      ) : (
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center text-[12px]"
          style={{ backgroundColor: tokens.bg.elevated }}
        >
          🎬
        </div>
      )}
      <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: tokens.text.primary }}>
        {attachment.name}
      </span>
      <button
        onClick={onRemove}
        className="text-[10px] transition-colors shrink-0"
        style={{ color: tokens.text.tertiary }}
        onMouseEnter={e => { e.currentTarget.style.color = tokens.status.err; }}
        onMouseLeave={e => { e.currentTarget.style.color = tokens.text.tertiary; }}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
};

// -------- Message renderer --------------------------------------------

const MessageRow: React.FC<{
  message: ChatMessage;
  tokens: ThemeTokens;
  locale: Locale;
  onApprove: (id: string, allow: boolean) => void;
  onPick: (pickerId: string, optionId: string | null) => void;
  onApplyDraft: (draftId: string) => void;
  onDiscardDraft: (draftId: string) => void;
  onSetupSubmit: (setupId: string, choice: SetupChoice) => void;
  onSetupSkip: (setupId: string) => void;
  onSetupCancel: (setupId: string) => void;
}> = ({ message, tokens, locale, onApprove, onPick, onApplyDraft, onDiscardDraft, onSetupSubmit, onSetupSkip, onSetupCancel }) => {
  const t = useCallback((k: string, vars?: Record<string, string | number>) => tx(locale, k, vars), [locale]);

  // Setup card branch (pre-flight Q&A before video import)
  if (message.setup) {
    return (
      <SetupCard
        tokens={tokens}
        locale={locale}
        title={message.setup.title}
        subtitle={message.setup.subtitle}
        resolved={message.setup.resolved}
        onSubmit={choice => onSetupSubmit(message.setup!.setupId, choice)}
        onSkip={() => onSetupSkip(message.setup!.setupId)}
        onCancel={() => onSetupCancel(message.setup!.setupId)}
      />
    );
  }

  // Draft preview branch (script generated by an import, awaiting apply)
  if (message.draft) {
    return (
      <DraftCard
        draft={message.draft}
        tokens={tokens}
        locale={locale}
        onApply={onApplyDraft}
        onDiscard={onDiscardDraft}
      />
    );
  }

  // Picker card branch
  if (message.pickerId && message.pickerOptions) {
    return (
      <PickerCard
        pickerId={message.pickerId}
        kind={message.pickerKind ?? 'generic'}
        title={message.pickerTitle ?? ''}
        subtitle={message.pickerSubtitle}
        options={message.pickerOptions}
        choice={message.pickerChoice}
        tokens={tokens}
        locale={locale}
        onPick={id => onPick(message.pickerId!, id)}
      />
    );
  }

  // Approval card branch
  if (message.approvalId) {
    return (
      <ApprovalCard
        toolName={message.toolName ?? ''}
        toolInput={message.toolInput}
        resolved={message.resolved}
        tokens={tokens}
        locale={locale}
        onDecide={allow => onApprove(message.approvalId!, allow)}
      />
    );
  }

  // Tool pill branch (role === 'tool')
  if (message.role === 'tool') {
    const label = labelFor(message.toolName ?? '');
    const isDone = message.toolStatus === 'done';
    const isError = message.toolStatus === 'error';
    // `__raw__:foo` is the fallback for unmapped tools — render the literal
    // text instead of running it through the i18n table (which would echo
    // the key back as a useless string).
    const resolve = (key: string, vars?: Record<string, string | number>): string =>
      key.startsWith('__raw__:') ? key.slice('__raw__:'.length) : t(key, vars);
    const text = isDone
      ? resolve(label.doneKey, message.toolDoneVars)
      : isError
      ? t('tool.unknown.done')
      : resolve(label.doingKey);
    const color = isError ? tokens.status.err : isDone ? tokens.status.ok : tokens.text.secondary;
    const icon = isError ? '✕' : isDone ? '✓' : null;

    return (
      <div
        className="flex items-center gap-2 text-[11.5px] py-1 px-2.5 rounded-lg w-fit max-w-full"
        style={{
          backgroundColor: tokens.bg.canvas,
          border: `1px solid ${tokens.border.subtle}`,
          color: tokens.text.secondary,
        }}
      >
        {icon ? (
          <span className="text-[12px] shrink-0" style={{ color }}>{icon}</span>
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ backgroundColor: tokens.accent.focus }}
          />
        )}
        <span className="truncate">{text}</span>
      </div>
    );
  }

  switch (message.role) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1">
          {message.text && (
            <div
              className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] whitespace-pre-wrap leading-relaxed"
              style={{
                backgroundColor: tokens.accent.bg,
                color: tokens.accent.fg,
              }}
            >
              {message.text}
            </div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex gap-1.5 flex-wrap justify-end max-w-[85%]">
              {message.attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg"
                  style={{
                    backgroundColor: tokens.bg.canvas,
                    border: `1px solid ${tokens.border.subtle}`,
                  }}
                >
                  {a.kind === 'image' && a.previewUrl ? (
                    <img src={a.previewUrl} alt={a.name} className="w-5 h-5 rounded object-cover" />
                  ) : (
                    <span>{a.kind === 'video' ? '🎬' : '🖼'}</span>
                  )}
                  <span className="text-[10.5px]" style={{ color: tokens.text.secondary }}>{a.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'assistant':
      return (
        <div className="flex justify-start">
          <div
            className="max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{
              backgroundColor: tokens.bg.canvas,
              border: `1px solid ${tokens.border.subtle}`,
              color: tokens.text.primary,
            }}
          >
            {renderInlineMarkdown(message.text)}
            {message.streaming && (
              <span
                className="inline-block w-1.5 h-3.5 ml-0.5 align-middle animate-pulse"
                style={{ backgroundColor: tokens.text.primary }}
              />
            )}
          </div>
        </div>
      );

    case 'system':
      return (
        <div className="text-[11px] italic px-1" style={{ color: tokens.text.tertiary }}>
          {message.text}
        </div>
      );

    case 'error':
      return (
        <div
          className="text-[11.5px] rounded-lg px-3 py-2"
          style={{
            backgroundColor: tokens.status.err + '15',
            border: `1px solid ${tokens.status.err}30`,
            color: tokens.status.err,
          }}
        >
          {message.text}
        </div>
      );

    default:
      return null;
  }
};
