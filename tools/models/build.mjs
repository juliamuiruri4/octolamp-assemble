// Converts the source STL files to compact runtime GLBs. Run: node tools/models/build.mjs
// Source models are read-only inputs; only public/models/*.glb is shipped. The board needs tools/models/.cache/board.json (see step_extract.py).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { parseStl } from './stl.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = resolve(root, process.env.OCTOLAMP_SRC ?? '../octolamp');
const cache = join(root, 'tools/models/.cache');

/** `target` is the triangle count to simplify toward; omit to keep every triangle. */
const MODELS = [
  { id: 'base', file: join(src, 'models/octolamp_black_outer_mini_sparkle_motion.stl'), origin: 'martinwoodward/octolamp (CC BY-NC 4.0)' },
  { id: 'cover', file: join(src, 'models/octolamp_black_outer_mini_sparkle_motion_top.stl'), origin: 'martinwoodward/octolamp (CC BY-NC 4.0)' },
  { id: 'inner', file: join(src, 'models/octolamp_white_inner.stl'), origin: 'martinwoodward/octolamp (CC BY-NC 4.0)' },
  { id: 'reflector', file: join(src, 'models/octolamp_white_reflector.stl'), origin: 'martinwoodward/octolamp (CC BY-NC 4.0)' },
  { id: 'sparkle-motion-mini', target: 20000, step: 'board.json', origin: 'adafruit/Adafruit_CAD_Parts, 6160 Sparkle Motion Mini, STEP components (MIT)' },
];

async function load(model) {
  if (model.step) return { buf: Buffer.alloc(0), source: 'adafruit/Adafruit_CAD_Parts 6160 Sparkle Motion Mini.step' };
  return { buf: readFileSync(model.file), source: model.file.replace(`${src}/`, 'octolamp/') };
}

/** Keeps only the vertices a triangle list uses. */
function compact(positions, indices) {
  const remap = new Map();
  const out = [];
  const next = indices.map((i) => {
    if (!remap.has(i)) { remap.set(i, out.length / 3); out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    return remap.get(i);
  });
  return { positions: new Float32Array(out), indices: next };
}

function addMesh(doc, scene, name, positions, indices) {
  // Z-up → Y-up (glTF): (x, y, z) → (x, z, -y).
  const yUp = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    yUp[i] = positions[i];
    yUp[i + 1] = positions[i + 2];
    yUp[i + 2] = -positions[i + 1];
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const pos = doc.createAccessor().setType('VEC3').setArray(yUp).setBuffer(buffer);
  const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(join(root, 'public/models'), { recursive: true });

for (const model of MODELS) {
  const { buf, source } = await load(model);
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene(model.id);

  let positions;
  let indices;
  if (model.step) {
    // Named components from Adafruit's STEP file, one mesh per component name (see step_extract.py).
    const cache = join(root, 'tools/models/.cache', model.step);
    if (!existsSync(cache)) throw new Error(`Missing ${cache}. Run: python3 tools/models/step_extract.py <6160 Sparkle Motion Mini.step> (needs pip install cadquery-ocp)`);
    const board = JSON.parse(readFileSync(cache, 'utf8'));
    const byName = new Map();
    for (const part of board.parts) {
      const group = byName.get(part.name) ?? byName.set(part.name, { positions: [], indices: [] }).get(part.name);
      const base = group.positions.length / 3;
      group.positions.push(...part.positions);
      group.indices.push(...part.indices.map((i) => i + base));
    }
    const all = { positions: [], indices: [] };
    for (const [name, g] of byName) {
      addMesh(doc, scene, name, Float32Array.from(g.positions), g.indices);
      const base = all.positions.length / 3;
      all.positions.push(...g.positions);
      all.indices.push(...g.indices.map((i) => i + base));
    }
    positions = Float32Array.from(all.positions);
    indices = all.indices;
  } else {
    ({ positions, indices } = parseStl(buf));
    const c = compact(positions, indices);
    addMesh(doc, scene, model.id, c.positions, c.indices);
  }

  if (model.target) {
    const { simplify, weld } = await import('@gltf-transform/functions');
    await doc.transform(weld({ tolerance: 0.0005 }), simplify({ simplifier: MeshoptSimplifier, ratio: model.target / (indices.length / 3), error: 0.001 }));
  }
  await doc.transform(quantize({ quantizePosition: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const out = join(root, `public/models/${model.id}.glb`);
  const glb = await io.writeBinary(doc);
  writeFileSync(out, glb);

  const tris = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
  console.log(model.id.padEnd(22), `${indices.length / 3} -> ${tris} tris`, `${(glb.byteLength / 1024).toFixed(0)} KB`);
}
