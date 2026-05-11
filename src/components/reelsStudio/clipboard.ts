/**
 * Reliable clipboard copy for Tauri/WebKit.
 * navigator.clipboard.writeText requires the window to be focused and
 * permissions granted — both often fail in Tauri's WebView on macOS.
 * Falls back to the legacy execCommand('copy') path which works everywhere.
 */
export const copyText = async (text: string): Promise<void> => {
  // Try modern API first.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to execCommand.
    }
  }

  // Fallback: create a temporary textarea, select all, copy.
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(el);
  }
};
