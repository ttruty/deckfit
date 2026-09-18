/**
 * WCAG AA check for the card palette (CLAUDE.md §9a) in both themes. Reads the tokens straight
 * out of src/styles/_card-tokens.scss, so it fails if a colour is changed without re-checking.
 * Run: npm run contrast
 */
import { readFileSync } from 'node:fs';

const scss = readFileSync(new URL('../src/styles/_card-tokens.scss', import.meta.url), 'utf8');
const blocks = scss.split(/:root(?:\[data-theme='dark'\])?\s*{/);
const readTokens = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})/gi)].map((m) => [m[1], m[2]]));
const light = readTokens(blocks[1] ?? '');
const dark = { ...light, ...readTokens(scss.slice(scss.indexOf("[data-theme='dark']"))) };

const toRgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const L = (h) => { const [r, g, b] = toRgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades', 'joker'];
let failures = 0;
for (const [theme, t] of Object.entries({ light, dark })) {
  console.log(`\n== ${theme} ==`);
  const pairs = [['ink on paper', t.ink, t.paper], ['ink on table', t.ink, t.table]];
  for (const suit of SUITS) {
    pairs.push([`${suit} text on paper`, t[`suit-text-${suit}`], t.paper]);
    pairs.push([`${suit} text on table`, t[`suit-text-${suit}`], t.table]);
    pairs.push([`text on ${suit} plate`, t[`on-${suit}`], t[`suit-${suit}`]]);
  }
  for (const [label, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    const ok = r >= 4.5;
    if (!ok) failures++;
    console.log(`${ok ? 'AA  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}  ${label} (${fg} on ${bg})`);
  }
}
console.log(failures ? `\n${failures} pair(s) below 4.5:1` : '\nAll pairs meet WCAG AA (4.5:1).');
process.exit(failures ? 1 : 0);
