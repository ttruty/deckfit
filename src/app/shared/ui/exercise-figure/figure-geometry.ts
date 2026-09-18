/**
 * Pictogram geometry for exercise figures.
 * Pure functions, no Angular imports: returns SVG path data that the
 * ExerciseFigureComponent (and tools/preview) render.
 *
 * Style: side-view "signal" pictograms. Thick round strokes, detached head,
 * far limbs in a lighter tone, start pose as a ghost in the suit color,
 * end pose solid in ink.
 */
// Types come from the Zod schemas (type-only, so tools/build_preview.mjs doesn't bundle zod).
import type { FigureSpec, Pose, Prop, Pt } from '../../../domain/models/schemas';
export type { FigureSpec, Pose, Prop, Pt };

export interface FigureLayer {
  far: string;          // path data, drawn lighter
  near: string;         // path data, drawn solid
  head: { cx: number; cy: number; r: number };
}

export interface FigureDrawing {
  ghost: FigureLayer | null;      // start pose (null for holds)
  main: FigureLayer;              // end pose
  propBack: PropShape[];          // behind the figure (balls)
  propFront: PropShape[];         // in front (weights, bands, straps)
}

export type PropShape =
  | { kind: 'path'; d: string; dashed?: boolean; tone: 'ink' | 'far' | 'suit' }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: 'suit-tint' | 'none'; tone: 'ink' | 'suit' };

const HEAD_R = 6.5;
const HEAD_GAP = 1.5;

const M = (p: Pt) => `M${p[0]} ${p[1]}`;
const L = (...pts: Pt[]) => pts.map((p) => `L${p[0]} ${p[1]}`).join('');

/** Pull the neck point back toward the hip so the head floats free of the torso. */
function neckTop(p: Pose): Pt {
  const [hx, hy] = p.head;
  const [nx, ny] = p.neck;
  const dx = nx - hx, dy = ny - hy;
  const dist = Math.hypot(dx, dy) || 1;
  const want = HEAD_R + HEAD_GAP;
  if (dist >= want) return p.neck;
  return [hx + (dx / dist) * want, hy + (dy / dist) * want];
}

export function layer(p: Pose): FigureLayer {
  const top = neckTop(p);
  const far = [
    M(p.neck) + L(p.fE, p.fH),
    M(p.hip) + L(p.fK, p.fF),
  ].join('');
  const near = [
    M(top) + L(p.hip),
    M(p.neck) + L(p.nE, p.nH),
    M(p.hip) + L(p.nK, p.nF),
  ].join('');
  return { far, near, head: { cx: p.head[0], cy: p.head[1], r: HEAD_R } };
}

const samePose = (a: Pose, b: Pose) => JSON.stringify(a) === JSON.stringify(b);

function weightAt(type: 'dumbbell' | 'kettlebell' | 'barbell', [x, y]: Pt, tone: 'ink' | 'far'): PropShape[] {
  switch (type) {
    case 'dumbbell':
      return [{ kind: 'path', tone, d: `M${x - 5} ${y}L${x + 5} ${y}M${x - 5} ${y - 3.5}L${x - 5} ${y + 3.5}M${x + 5} ${y - 3.5}L${x + 5} ${y + 3.5}` }];
    case 'kettlebell':
      return tone === 'far' ? [] : [
        { kind: 'circle', cx: x, cy: y + 6.5, r: 4.5, fill: 'none', tone: 'ink' },
        { kind: 'path', tone, d: `M${x - 2.5} ${y + 2.5}Q${x} ${y - 2} ${x + 2.5} ${y + 2.5}` },
      ];
    case 'barbell':
      return tone === 'far' ? [] : [
        { kind: 'circle', cx: x, cy: y, r: 8.5, fill: 'none', tone: 'ink' },
        { kind: 'circle', cx: x, cy: y, r: 1.6, fill: 'none', tone: 'ink' },
      ];
  }
}

function propShapes(prop: Prop, p: Pose): { back: PropShape[]; front: PropShape[] } {
  if (!prop) return { back: [], front: [] };
  switch (prop.type) {
    case 'dumbbell':
    case 'kettlebell':
    case 'barbell':
      return { back: [], front: [...weightAt(prop.type, p.fH, 'far'), ...weightAt(prop.type, p.nH, 'ink')] };
    case 'ball':
      return { back: [{ kind: 'circle', cx: prop.x, cy: prop.y, r: prop.r, fill: 'suit-tint', tone: 'suit' }], front: [] };
    case 'band': {
      const h = p.nH;
      const anchors: Record<string, string> = {
        feet: M(h) + L([p.nF[0] + 2, p.nF[1]]),
        front: M(h) + L([97, h[1]]),
        behind: M(h) + L([3, h[1] + 4]),
        above: M(h) + L([h[0] + 6, 1]),
        knees: `M${p.nK[0] - 3} ${p.nK[1] + 3}L${p.fK[0] + 3} ${p.fK[1] + 3}`,
        hands: `M${h[0]} ${h[1] - 5}L${h[0]} ${h[1] + 5}`,
      };
      return { back: [], front: [{ kind: 'path', d: anchors[prop.anchor], dashed: true, tone: 'suit' }] };
    }
    case 'strap': {
      const a = prop.attach === 'hands' ? p.nH : p.nF;
      const ax = prop.anchorX ?? (prop.attach === 'hands' ? a[0] + 14 : a[0]);
      return {
        back: [],
        front: [{ kind: 'path', tone: 'ink', d: `${M(a)}L${ax} 2M${ax - 4} 1L${ax + 4} 1` }],
      };
    }
  }
}

export function drawFigure(spec: FigureSpec, poses: Record<string, Pose>): FigureDrawing {
  const s = poses[spec.start];
  const e = poses[spec.end];
  if (!s || !e) throw new Error(`Unknown pose: ${!s ? spec.start : spec.end}`);
  const props = propShapes(spec.prop, e);
  return {
    ghost: samePose(s, e) ? null : layer(s),
    main: layer(e),
    propBack: props.back,
    propFront: props.front,
  };
}

/** Standalone SVG string (used for share images, previews, and tests). */
export function figureSvg(spec: FigureSpec, poses: Record<string, Pose>): string {
  const d = drawFigure(spec, poses);
  const shape = (x: PropShape) =>
    x.kind === 'path'
      ? `<path class="prop ${x.tone}${x.dashed ? ' dashed' : ''}" d="${x.d}"/>`
      : `<circle class="prop ${x.tone} ${x.fill}" cx="${x.cx}" cy="${x.cy}" r="${x.r}"/>`;
  const lay = (l: FigureLayer, cls: string) =>
    `<g class="${cls}"><path class="far" d="${l.far}"/><path class="near" d="${l.near}"/>` +
    `<circle class="head" cx="${l.head.cx}" cy="${l.head.cy}" r="${l.head.r}"/></g>`;
  return (
    `<svg class="ex-figure" viewBox="-4 -8 108 104" role="img">` +
    `<path class="ground" d="M-2 92.5H102"/>` +
    d.propBack.map(shape).join('') +
    (d.ghost ? lay(d.ghost, 'ghost') : '') +
    lay(d.main, 'main') +
    d.propFront.map(shape).join('') +
    `</svg>`
  );
}
