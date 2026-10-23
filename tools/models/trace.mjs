// Measures the LED strip route from the white inner part and writes src/ledPath.json.
// Run: node tools/models/trace.mjs. Source STL stays read-only; units are mm in the inner part's own STL frame (Z up).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStl } from './stl.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = resolve(root, process.env.OCTOLAMP_SRC ?? '../octolamp');
const SLICE_Z = -7; // mid-height of the strip, between the channel floor (-13) and the rim (+2)
const PITCH = 1000 / 60; // IP30 strip, 60 LEDs per metre
const OFFSET = 1.6; // strip centre sits this far off the wall face
const debug = process.argv.includes('--debug');

const { positions, indices } = parseStl(readFileSync(join(src, 'models/octolamp_white_inner.stl')));

/** Slice the mesh with the plane z = SLICE_Z and chain the segments into closed loops. */
function slice() {
  const segs = [];
  const at = (a, b) => {
    const t = (SLICE_Z - positions[a * 3 + 2]) / (positions[b * 3 + 2] - positions[a * 3 + 2]);
    return [positions[a * 3] + t * (positions[b * 3] - positions[a * 3]), positions[a * 3 + 1] + t * (positions[b * 3 + 1] - positions[a * 3 + 1])];
  };
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    const above = tri.filter((v) => positions[v * 3 + 2] > SLICE_Z);
    if (above.length === 0 || above.length === 3) continue;
    const below = tri.filter((v) => positions[v * 3 + 2] <= SLICE_Z);
    const lone = above.length === 1 ? above[0] : below[0];
    const pair = above.length === 1 ? below : above;
    segs.push([at(lone, pair[0]), at(lone, pair[1])]);
  }
  const key = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`;
  const ends = new Map();
  segs.forEach((s, i) => s.forEach((p) => { const k = key(p); (ends.get(k) ?? ends.set(k, []).get(k)).push(i); }));
  const used = new Set();
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop = [segs[i][0], segs[i][1]];
    for (;;) {
      const last = loop[loop.length - 1];
      const next = (ends.get(key(last)) ?? []).find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const [a, b] = segs[next];
      loop.push(key(a) === key(last) ? b : a);
    }
    loops.push(loop.slice(0, -1));
  }
  return loops;
}

const area = (l) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
const loops = slice().filter((l) => l.length > 20).map((l) => ({ pts: l, area: area(l) })).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

if (debug) {
  for (const l of loops) {
    const xs = l.pts.map((p) => p[0]);
    const ys = l.pts.map((p) => p[1]);
    console.log(l.pts.length, 'area', l.area.toFixed(0), 'x', Math.min(...xs).toFixed(1), Math.max(...xs).toFixed(1), 'y', Math.min(...ys).toFixed(1), Math.max(...ys).toFixed(1));
  }
  process.exit(0);
}

const ccw = (poly) => (area(poly) > 0 ? poly : [...poly].reverse());

/** Points every `step` mm along a closed CCW polygon from vertex `start`, pushed `OFFSET` mm to its inside (or outside). */
function walk(poly, start, dir, step, until, inward = true) {
  const n = poly.length;
  const pts = Array.from({ length: n + 1 }, (_, i) => poly[(((start + dir * i) % n) + n) % n]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = until ?? cum[cum.length - 1];
  const out = [];
  for (let d = step / 2, seg = 0; d < total; d += step) {
    while (cum[seg + 1] < d) seg++;
    const [a, b] = [pts[seg], pts[seg + 1]];
    const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg]);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty);
    tx /= len; ty /= len;
    // The left side of a CCW polygon is its interior; walking backwards swaps the sides.
    const nx = -ty * dir * (inward ? 1 : -1);
    const ny = tx * dir * (inward ? 1 : -1);
    out.push([a[0] + tx * len * t + nx * OFFSET, a[1] + ty * len * t + ny * OFFSET, tx, ty, nx, ny].map((n) => +n.toFixed(3)));
  }
  return out;
}

const cumLength = (poly, from, dir, to) => {
  const n = poly.length;
  let d = 0;
  for (let i = from; ((i % n) + n) % n !== to; i += dir) {
    const a = poly[((i % n) + n) % n];
    const b = poly[(((i + dir) % n) + n) % n];
    d += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return d;
};
const nearest = (poly, x, y) => poly.reduce((best, p, i) => (Math.hypot(p[0] - x, p[1] - y) < best.d ? { i, d: Math.hypot(p[0] - x, p[1] - y) } : best), { i: 0, d: Infinity }).i;

// Loops are sorted by size: wall 1 outer face, wall 1 inner face, wall 2 outer face, wall 2 inner face.
// The strip must face the glowing areas: the ring channel (against wall 1) and the outside of wall 2, which borders the ring
// channel and Mona's body. The dark gap between them stays unlit.
const wall1 = ccw(loops[1].pts);
const wall2 = ccw(loops[2].pts);

// Outer ring: start at the base of Mona (top of the STL frame) and go once around.
const o0 = nearest(wall1, 0, 99);
const outer = walk(wall1, o0, 1, PITCH);

// Inner route: start where the ring wall meets Mona's neck, take the ring arc first, finish at her tentacle tip.
const i0 = nearest(wall2, -20, 84);
const radiusAfter = (dir) => { const p = walk(wall2, i0, dir, 10, 45).pop(); return Math.hypot(p[0], p[1]); };
const dir = radiusAfter(1) > radiusAfter(-1) ? 1 : -1;
const tip = nearest(wall2, -61, 36);
const inner = walk(wall2, i0, dir, PITCH, cumLength(wall2, i0, dir, tip), false);

mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src/ledPath.json'), JSON.stringify({
  note: 'Generated by tools/models/trace.mjs from the white inner STL. mm, STL frame (Z up); each LED is [x, y, tangentX, tangentY, normalX, normalY].',
  pitch: +PITCH.toFixed(3),
  sliceZ: SLICE_Z,
  outer,
  inner,
}) + '\n');
console.log('outer', outer.length, 'inner', inner.length, 'total', outer.length + inner.length, 'dir', dir);
