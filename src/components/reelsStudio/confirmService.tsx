/**
 * Promise-based confirmation dialog — replaces window.confirm() everywhere.
 *
 * window.confirm() is unreliable in the Tauri WebView on some hosts: it
 * silently returns false without ever showing a dialog, which makes every
 * destructive action guarded by it look dead ("clico em excluir e nada
 * acontece"). See CLAUDE.md → "Confirm dialogs".
 *
 * Usage:
 *   if (!(await confirmDialog('Apagar este take?', { danger: true }))) return;
 *
 * <ConfirmHost /> must be mounted ONCE at the app root (App.tsx). If it
 * isn't mounted (tests, storybook), confirmDialog falls back to the native
 * confirm so callers never hang.
 */

import React, { useEffect, useState } from 'react';

interface ConfirmOptions {
  /** Red confirm button + alert icon (destructive actions). Default true. */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional small secondary line under the message. */
  detail?: string;
}

interface ConfirmRequest extends ConfirmOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

let pushRequest: ((r: ConfirmRequest) => void) | null = null;

export const confirmDialog = (message: string, opts?: ConfirmOptions): Promise<boolean> =>
  new Promise(resolve => {
    if (!pushRequest) {
      // Host not mounted — degrade to native (better than hanging forever).
      resolve(window.confirm(message));
      return;
    }
    pushRequest({ message, danger: true, ...opts, resolve });
  });

export const ConfirmHost: React.FC = () => {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    pushRequest = (r) => {
      setReq(prev => {
        if (prev) {
          // One dialog at a time — a second concurrent request is refused
          // (resolves false) instead of silently replacing the visible one.
          r.resolve(false);
          return prev;
        }
        return r;
      });
    };
    return () => { pushRequest = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    // Capture phase so the app's global shortcut handler (Space/Esc/etc.)
    // never sees keys while the dialog is up.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;

  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  const danger = req.danger !== false;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={() => done(false)}
    >
      <div
        className="rounded-2xl max-w-sm w-full overflow-hidden"
        style={{
          backgroundColor: '#141416',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.8)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={danger
              ? { backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }
              : { backgroundColor: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)' }}
          >
            <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke={danger ? '#fca5a5' : '#93c5fd'} strokeWidth={2}>
              {danger
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12v-.008z" />}
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 leading-snug">{req.message}</div>
            {req.detail && <div className="text-[11px] text-zinc-500 mt-1 leading-snug">{req.detail}</div>}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button
            onClick={() => done(false)}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#a1a1aa' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'}
          >
            {req.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            autoFocus
            onClick={() => done(true)}
            className="px-3.5 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: danger ? 'linear-gradient(180deg,#ef4444,#dc2626)' : 'linear-gradient(180deg,#60A5FA,#2563EB)' }}
          >
            {req.confirmLabel ?? (danger ? 'Excluir' : 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
};
