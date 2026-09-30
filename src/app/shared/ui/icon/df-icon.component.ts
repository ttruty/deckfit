import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Every icon the design mockups use. The markup lives in the template below. */
export const DF_ICONS = [
  'home', 'library', 'decks', 'games', 'history', 'settings', 'theme',
  'play', 'chevron', 'chevron-down', 'check', 'plus', 'clock',
  'room', 'group', 'install', 'search', 'swap', 'copy', 'edit', 'close', 'flag', 'timer',
] as const;
export type DfIconName = (typeof DF_ICONS)[number];

/** These carry their own fill instead of a stroke. */
const FILLED = new Set<DfIconName>(['play']);

/**
 * The line icons from docs/design/deckfit-*.html, as one 24px stroke set. Material Icons is a
 * ligature font of filled glyphs, so it can't match the mockups; this keeps the set in one place
 * instead of pasting SVG through every template. (The markup has to be in the template: content
 * assigned with `innerHTML` inside an `<svg>` is parsed as HTML and never renders.)
 */
@Component({
  selector: 'df-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="df-ico" [class.df-ico--filled]="filled()" viewBox="0 0 24 24" aria-hidden="true">
      @switch (name()) {
        @case ('home') {
          <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
        }
        @case ('library') {
          <path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12" />
        }
        @case ('decks') {
          <rect x="9" y="3" width="11" height="15" rx="2" />
          <path d="M5.5 7v11a2 2 0 0 0 2 2H16" />
        }
        @case ('games') {
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
          <circle cx="15" cy="15" r="1.2" fill="currentColor" />
          <circle cx="15" cy="9" r="1.2" fill="currentColor" />
          <circle cx="9" cy="15" r="1.2" fill="currentColor" />
        }
        @case ('history') {
          <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
          <path d="M3.5 3.5v5h5" />
          <path d="M12 7.5V12l3 2" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        }
        @case ('theme') {
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        }
        @case ('play') {
          <path d="M8 5.5v13l10.5-6.5z" />
        }
        @case ('chevron') {
          <path d="m9 6 6 6-6 6" />
        }
        @case ('chevron-down') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('check') {
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 1.5" />
        }
        @case ('room') {
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M19 8v6M16 11h6" />
        }
        @case ('group') {
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M16 14.5a5.5 5.5 0 0 1 5.5 5.5" />
        }
        @case ('install') {
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <path d="M12 6.5v7m-3-3 3 3 3-3M10.5 18h3" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        }
        @case ('swap') {
          <path d="M4 8h13l-3-3M20 16H7l3 3" />
        }
        @case ('copy') {
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" />
        }
        @case ('edit') {
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="M14.5 5.5 18.5 9.5" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6 6 18" />
        }
        @case ('flag') {
          <path d="M6 21V4h11l-2 3.5L17 11H6" />
        }
        @case ('timer') {
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 9.5V13l2.5 1.5M9.5 2.5h5" />
        }
      }
    </svg>
  `,
  styles: `:host { display: contents; }`,
})
export class DfIconComponent {
  readonly name = input.required<DfIconName>();
  protected readonly filled = computed(() => FILLED.has(this.name()));
}
