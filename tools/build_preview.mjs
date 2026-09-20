// Builds tools/out/card-preview.html: every exercise as a card, grouped by deck.
// Usage: node tools/build_preview.mjs
import { build } from 'esbuild';
import * as sass from 'sass';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const content = (f) => JSON.parse(fs.readFileSync(path.join(root, 'src/assets/content', f), 'utf8'));

const bundle = await build({
  entryPoints: [path.join(root, 'src/app/shared/ui/exercise-figure/figure-geometry.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const poses = content('poses.json');
const { exercises } = content('exercises.json');
const { decks } = content('decks.json');
const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));

const font = (pkg, file, family, weight) => {
  const b64 = fs.readFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:swap}`;
};
const fonts = [
  font('big-shoulders-display', 'big-shoulders-display-latin-700-normal.woff2', 'Big Shoulders Display', 700),
  font('big-shoulders-display', 'big-shoulders-display-latin-800-normal.woff2', 'Big Shoulders Display', 800),
  font('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2', 'Atkinson Hyperlegible', 400),
  font('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2', 'Atkinson Hyperlegible', 700),
].join('');
const css = sass.compile(path.join(root, 'src/styles/_card-tokens.scss')).css;

const PIP = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

const card = (deck, suit, ex, rank) => {
  const c = deck.cards.find((k) => k.suit === suit && k.rank === rank);
  const label = deck.suits.find((s) => s.suit === suit).label;
  const unit = ex.measure === 'seconds' ? 'sec' : 'reps';
  // .card-box is the size container the card's type is measured against (see _card-tokens.scss).
  return `<div class="card-box"><article class="card-face ${suit}" aria-label="${rank} of ${suit}: ${ex.name}, ${c.baseAmount} ${unit}">
    <div class="corner" aria-hidden="true"><span class="rank">${rank}</span><span class="pip">${PIP[suit]}</span></div>
    <div class="figure">${mod.figureSvg(ex.figure, poses)}</div>
    <div class="plate"><div class="name">${ex.name}</div>
      <div class="meta"><span class="amount">${c.baseAmount}<small>${unit}</small></span><span class="group">${label}</span></div></div>
  </article></div>`;
};

const sections = decks.map((deck) => {
  const rows = ['hearts', 'diamonds', 'clubs', 'spades'].map((suit) => {
    const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const cards = deck.cards.filter((c) => c.suit === suit).sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
    const ids = [...new Set(cards.map((c) => c.exerciseId))];
    return ids.map((id) => {
      const mine = cards.filter((c) => c.exerciseId === id);
      return card(deck, suit, exById[id], mine[Math.floor(mine.length / 2)].rank);
    }).join('');
  }).join('');
  return `<section><h2>${deck.name}</h2><div class="grid">${rows}</div></section>`;
}).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DeckFit card preview</title>
<style>${fonts}${css}
body{margin:0;background:var(--table);font-family:var(--font-text);color:var(--ink)}
main{max-width:1320px;margin:0 auto;padding:24px}
h1{font-family:var(--font-display);font-weight:800;font-size:3rem;margin:.2em 0 .1em}
h2{font-family:var(--font-display);font-weight:700;font-size:1.8rem;margin:1.4em 0 .5em}
p{max-width:65ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;font-size:13px}
</style></head><body><main>
<h1>DeckFit cards</h1>
<p>All ${exercises.length} built-in exercises across ${decks.length} decks. Each suit has three exercises that step up in difficulty with the card's rank. The faint figure is the start position; the solid figure is where the movement ends.</p>
${sections}</main></body></html>`;

fs.mkdirSync(path.join(root, 'tools/out'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools/out/card-preview.html'), html);
console.log('wrote tools/out/card-preview.html', (html.length / 1024).toFixed(0) + 'KB');
