/**
 * Builds the app icon set from one drawing (CLAUDE.md §9a brand): a fan of cards with the
 * signature figure — faint start pose in the suit colour, solid end pose in ink — on the front.
 *
 *   npm run icons
 *
 * Writes public/icons/*.png (manifest sizes, `any` + `maskable`), the apple touch icon,
 * favicon.svg and favicon.ico. Rendering uses the Playwright Chromium already installed for e2e.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const INK = '#1f2a44';
const PAPER = '#eef2ef';
const HEARTS = '#d7263d';
const SPADES = '#2e4ac9';

/** One card of the fan, rotated about the centre of the tile. */
const card = ({ x, y, rotate, fill, stroke = INK, w = 196, h = 272, r = 26 }) =>
  `<g transform="translate(${x} ${y}) rotate(${rotate})">
     <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="10" />
   </g>`;

/**
 * The pictogram: mid jumping-jack, the same thick round strokes as a card figure (§9a) but pared
 * back — at 48px anything finer turns to mush, so there is no ghost pose here.
 */
const figure = () => {
  const limb = (d) =>
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" />`;
  return `<g transform="translate(256 258)">
    <circle cx="0" cy="-96" r="25" fill="${INK}" />
    ${limb('M0 -70 V 10')}
    ${limb('M0 -52 L -64 -96 M0 -52 L 64 -96')}
    ${limb('M0 10 L -58 92 M0 10 L 58 92')}
  </g>`;
};

/** A suit pip in the card's corner. Only drawn on the big icons, where it doesn't crowd. */
const pip = () => `<path transform="translate(163 119) scale(0.072)" fill="${HEARTS}"
  d="M256 448l-30-27C118 322 48 259 48 179 48 122 94 76 151 76c30 0 59 14 78 36l27 32 27-32c19-22 48-36 78-36 57 0 103 46 103 103 0 80-70 143-178 242l-30 27z" />`;

/**
 * `maskable` art must survive a circular crop, so it sits inside the safe zone and the tile
 * colour bleeds to the edges. The plain icon uses the whole square with a rounded tile.
 */
function svg({ maskable, detail, square }) {
  // `maskable` art must clear a circular crop; iOS only rounds the corners, so `square` keeps the
  // full-size fan on a tile that bleeds to the edges.
  const art = maskable ? 0.74 : 1; // scale of the fan inside the 512 box
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="tile"><rect width="512" height="512" rx="${maskable || square ? 0 : 112}" /></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="${INK}" />
    <g transform="translate(256 256) scale(${art}) translate(-256 -256)">
      ${card({ x: 170, y: 264, rotate: -18, fill: HEARTS })}
      ${card({ x: 342, y: 264, rotate: 18, fill: SPADES })}
      ${card({ x: 256, y: 250, rotate: 0, fill: PAPER, w: 208, h: 286 })}
      ${detail ? pip() : ''}
      ${figure()}
    </g>
  </g>
</svg>`;
}

const root = new URL('..', import.meta.url).pathname;
const iconsDir = join(root, 'public/icons');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(join(root, 'tools/brand'), { recursive: true });

// Small icons drop the corner pip; the big ones keep it.
const plain = svg({ maskable: false, detail: true });
const plainSmall = svg({ maskable: false, detail: false });
const maskable = svg({ maskable: true, detail: true });
const appleTouch = svg({ square: true, detail: true });
writeFileSync(join(root, 'tools/brand/icon.svg'), plain);
writeFileSync(join(root, 'tools/brand/icon-maskable.svg'), maskable);
writeFileSync(join(root, 'public/favicon.svg'), plain);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

async function render(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  return page.screenshot({ omitBackground: true });
}

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
for (const size of SIZES) {
  writeFileSync(join(iconsDir, `icon-${size}x${size}.png`), await render(size >= 192 ? plain : plainSmall, size));
}
for (const size of [192, 512]) {
  writeFileSync(join(iconsDir, `icon-maskable-${size}x${size}.png`), await render(maskable, size));
}
// iOS ignores transparency and applies its own rounding, so the touch icon is the square art.
writeFileSync(join(iconsDir, 'apple-touch-icon.png'), await render(appleTouch, 180));

/** An .ico holding PNGs — every browser we target reads that, and it keeps the art identical. */
const icoSizes = [16, 32, 48];
const pngs = [];
for (const size of icoSizes) pngs.push(await render(plainSmall, size));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 0);
  entry.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 1);
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(join(root, 'public/favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));

await browser.close();
console.log(`Wrote ${SIZES.length} icons, 2 maskable, apple-touch-icon, favicon.svg and favicon.ico`);
