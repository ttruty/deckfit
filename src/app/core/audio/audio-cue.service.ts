import { Injectable, signal } from '@angular/core';

type Cue = 'tick' | 'go' | 'done' | 'flip';

const TONES: Record<Cue, { freq: number; ms: number; gain: number }[]> = {
  tick: [{ freq: 880, ms: 90, gain: 0.18 }],
  go: [{ freq: 1320, ms: 220, gain: 0.22 }],
  done: [{ freq: 660, ms: 110, gain: 0.2 }, { freq: 990, ms: 180, gain: 0.2 }],
  flip: [{ freq: 520, ms: 50, gain: 0.08 }],
};

/**
 * Beeps (Web Audio) and spoken cues (speechSynthesis). Both degrade to no-ops when the
 * browser lacks support. iOS needs audio unlocked by a user gesture: call `unlock()`
 * from a click handler (§11). PreferencesService persists `beeps`/`speech` in Dexie `meta`.
 */
@Injectable({ providedIn: 'root' })
export class AudioCueService {
  readonly beeps = signal(true);
  readonly speech = signal(false);

  private ctx: AudioContext | null = null;

  get speechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  unlock(): void {
    const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
    if (!Ctor) return;
    this.ctx ??= new Ctor();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(cue: Cue): void {
    if (!this.beeps() || !this.ctx) return;
    let at = this.ctx.currentTime;
    for (const tone of TONES[cue]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(tone.gain, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.ms / 1000);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(at);
      osc.stop(at + tone.ms / 1000);
      at += tone.ms / 1000;
    }
  }

  say(text: string): void {
    if (!this.speech() || !this.speechSupported) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}
