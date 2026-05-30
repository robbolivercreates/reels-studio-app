import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

let permissionEnsured = false;

/**
 * Dispara uma notificação do SO quando uma operação longa termina (áudio,
 * avatares, export) — útil quando o usuário sai e volta. Best-effort: pede
 * permissão uma vez e NUNCA lança erro (notificação é um plus, não bloqueia).
 */
export async function notifyDone(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted && !permissionEnsured) {
      permissionEnsured = true;
      granted = (await requestPermission()) === 'granted';
    }
    if (granted) sendNotification({ title, body });
  } catch {
    /* silencioso de propósito */
  }
}
