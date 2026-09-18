/**
 * Chrome/Edge/Android fire `beforeinstallprompt` once, often before Angular has bootstrapped, and
 * the event is only usable if it was captured then. main.ts calls `captureInstallPrompt()` so the
 * lazy InstallService can pick it up later. Deliberately tiny and framework-free: it ships in the
 * initial bundle.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pending: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(event: BeforeInstallPromptEvent | null) => void>();

let capturing = false;

export function captureInstallPrompt(): void {
  if (typeof window === 'undefined' || capturing) return;
  capturing = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep the mini-infobar away; the app offers its own button
    pending = event as BeforeInstallPromptEvent;
    for (const listener of listeners) listener(pending);
  });
  window.addEventListener('appinstalled', () => {
    pending = null;
    for (const listener of listeners) listener(null);
  });
}

export function pendingInstallPrompt(): BeforeInstallPromptEvent | null {
  return pending;
}

/** Called whenever the prompt becomes available, or is spent/installed (null). */
export function onInstallPrompt(listener: (event: BeforeInstallPromptEvent | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearInstallPrompt(): void {
  pending = null;
}
