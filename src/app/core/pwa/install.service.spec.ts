import { TestBed } from '@angular/core/testing';
import { provideTestDb } from '../../../testing/db';
import { MetaRepository } from '../db/repositories';
import { InstallService } from './install.service';
import { captureInstallPrompt, clearInstallPrompt, pendingInstallPrompt, type BeforeInstallPromptEvent } from './install-prompt';

/** The event Chrome fires; `outcome` is what the user chooses in the browser's dialog. */
function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted'): { prompted: () => boolean } {
  let prompted = false;
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: async () => void (prompted = true),
    userChoice: Promise.resolve({ outcome }),
  }) as BeforeInstallPromptEvent;
  window.dispatchEvent(event);
  return { prompted: () => prompted };
}

describe('InstallService', () => {
  beforeEach(() => {
    clearInstallPrompt();
    provideTestDb();
    captureInstallPrompt();
  });

  const service = () => TestBed.inject(InstallService);

  it('offers nothing until the browser says the app can be installed', () => {
    const install = service();
    expect(install.state()).toBe('none'); // headless Chrome isn't iOS and hasn't offered a prompt
    expect(install.offer()).toBe(false);

    fireInstallPrompt();
    expect(pendingInstallPrompt()).not.toBeNull();
    expect(install.state()).toBe('prompt');
    expect(install.offer()).toBe(true);
  });

  it('installing fires the browser prompt once and stops offering', async () => {
    const install = service();
    const { prompted } = fireInstallPrompt('accepted');
    expect(await install.install()).toBe(true);
    expect(prompted()).toBe(true);
    expect(install.state()).toBe('installed');
    expect(install.offer()).toBe(false);
    expect(await install.install()).toBe(false); // the event is spent
  });

  it('declining the browser dialog stops the banner coming back, and is remembered', async () => {
    const install = service();
    fireInstallPrompt('dismissed');
    expect(await install.install()).toBe(false);
    expect(install.dismissed()).toBe(true);
    expect(install.offer()).toBe(false);
    expect(await TestBed.inject(MetaRepository).get('installDismissedAt')).toBeGreaterThan(0);

    // Settings can bring it back.
    await install.reset();
    fireInstallPrompt();
    expect(install.offer()).toBe(true);
  });

  it('“Not now” hides the banner without touching the browser prompt', async () => {
    const install = service();
    const { prompted } = fireInstallPrompt();
    await install.dismiss();
    expect(prompted()).toBe(false);
    expect(install.offer()).toBe(false);
    expect(install.state()).toBe('prompt'); // Settings still offers the button
  });
});
