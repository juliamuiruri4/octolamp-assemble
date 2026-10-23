/** Binary STL → welded, indexed triangles. Coordinates stay in millimetres, Z-up. */
export function parseStl(buf) {
  const head = buf.subarray(0, 5).toString('latin1');
  const count = buf.readUInt32LE(80);
  if (head === 'solid' && 84 + count * 50 !== buf.length) throw new Error('ASCII STL is not supported');
  if (84 + count * 50 !== buf.length) throw new Error('Unexpected STL size');
  const lookup = new Map();
  const positions = [];
  const indices = [];
  const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12;
    const tri = [];
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(base + v * 12);
      const y = buf.readFloatLE(base + v * 12 + 4);
      const z = buf.readFloatLE(base + v * 12 + 8);
      const k = key(x, y, z);
      let i = lookup.get(k);
      if (i === undefined) {
        i = positions.length / 3;
        lookup.set(k, i);
        positions.push(x, y, z);
      }
      tri.push(i);
    }
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) indices.push(...tri);
  }
  return { positions: new Float32Array(positions), indices };
}
