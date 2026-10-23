import * as THREE from 'three';
import {
  BIN, LED_COUNT, LED_INNER, LED_OUTER, LED_PITCH, OUTER_COUNT, REST, STRIP_CENTRE_Z, STRIP_LEDS,
} from '../layout';
import { COLORS, makeConnector, PIGTAIL, std } from './parts';

const WIDTH = 9;
const FLAT_Y = 0.6;
const EDGE_Y = WIDTH / 2;
const COIL_SPACING = 2.8;
const COIL_INNER_RADIUS = 14;
const WORK_SPOOL = new THREE.Vector3(75, 0, 190);
const TRASH = new THREE.Vector3(225, 0, 232);
const SERPENTINE = { x: 105, z: 120, length: 225, gap: 17 };
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export interface StripInput {
  uncoiled: boolean;
  stuck: number;
  trimmed: boolean;
  tidied: boolean;
  innerMatrix: THREE.Matrix4;
  lit: number;
  snap: boolean;
}

/** Point `d` mm along a polyline. */
class Path {
  private cum = [0];
  constructor(private pts: THREE.Vector3[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  get length() { return this.cum[this.cum.length - 1]; }
  at(d: number, out: THREE.Vector3) {
    const c = Math.min(Math.max(d, 0), this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < c) i++;
    const span = this.cum[i] - this.cum[i - 1] || 1;
    return out.lerpVectors(this.pts[i - 1], this.pts[i], (c - this.cum[i - 1]) / span);
  }
}

function serpentine(): Path {
  const pts: THREE.Vector3[] = [];
  const { x, z, length, gap } = SERPENTINE;
  for (let row = 0; row < 9; row++) {
    const dir = row % 2 === 0 ? 1 : -1;
    const x0 = dir === 1 ? x : x + length;
    const z0 = z + row * gap;
    for (let s = 0; s <= 12; s++) pts.push(new THREE.Vector3(x0 + dir * (length * s) / 12, 0, z0));
    for (let s = 1; s <= 8; s++) {
      const a = (s / 8) * Math.PI;
      pts.push(new THREE.Vector3(x0 + dir * length + dir * Math.sin(a) * (gap / 2), 0, z0 + (1 - Math.cos(a)) * (gap / 2)));
    }
  }
  return new Path(pts);
}

const SERPENTINE_PATH = serpentine();

/** The strip as one instanced ribbon. Every LED is chased toward a target that depends on the build. */
export class Strip {
  readonly group = new THREE.Group();
  readonly connector = makeConnector(true);
  /** World pose of the strip's cable connector (where the LED cable plugs in). */
  readonly plug = { position: new THREE.Vector3(), direction: new THREE.Vector3(-1, 0, 0) };
  private readonly pcb: THREE.InstancedMesh;
  private readonly liner: THREE.InstancedMesh;
  private readonly chips: THREE.InstancedMesh;
  private readonly cur: THREE.Vector3[] = [];
  private readonly curN: THREE.Vector3[] = [];
  private readonly tgt: THREE.Vector3[] = [];
  private readonly tgtN: THREE.Vector3[] = [];
  private readonly locked: boolean[] = [];
  private lit = -1;
  private moving = true;
  private readonly pcbMaterial = std(COLORS.strip, 0.5);

  constructor() {
    const tile = (w: number, h: number, d: number, dz: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, 0, dz);
      return g;
    };
    const edgeChip = () => { const g = new THREE.BoxGeometry(3.4, 2.4, 2.2); g.translate(0, WIDTH / 2 - 0.5, 0.9); return g; };
    const pitch = LED_PITCH * 0.97;
    this.pcb = new THREE.InstancedMesh(tile(pitch, WIDTH, 0.7, 0), this.pcbMaterial, STRIP_LEDS);
    this.liner = new THREE.InstancedMesh(tile(pitch, WIDTH, 0.5, -0.6), std(COLORS.liner, 0.45), STRIP_LEDS);
    this.chips = new THREE.InstancedMesh(edgeChip(), new THREE.MeshBasicMaterial({ toneMapped: false }), STRIP_LEDS);
    for (const m of [this.pcb, this.liner, this.chips]) {
      m.frustumCulled = false;
      m.castShadow = m !== this.chips;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.group.add(this.connector);
    for (let i = 0; i < STRIP_LEDS; i++) {
      this.cur.push(new THREE.Vector3(REST.strip.x, 0, REST.strip.z));
      this.curN.push(new THREE.Vector3(0, 1, 0));
      this.tgt.push(new THREE.Vector3());
      this.tgtN.push(new THREE.Vector3(0, 1, 0));
      this.locked.push(false);
    }
    this.setLit(0);
  }

  get busy() { return this.moving; }

  /** World bounds of the strip as it lies now (the instanced geometry has no useful own bounds). */
  bounds() {
    return new THREE.Box3().setFromPoints(this.cur);
  }

  private setLit(lit: number) {
    if (lit === this.lit) return;
    this.lit = lit;
    const off = new THREE.Color(COLORS.chipOff);
    const on = new THREE.Color(COLORS.chipOn);
    for (let i = 0; i < STRIP_LEDS; i++) this.chips.setColorAt(i, off.clone().lerp(on, lit));
    this.chips.instanceColor!.needsUpdate = true;
    this.pcbMaterial.emissive.set(COLORS.green).multiplyScalar(lit * 0.35);
  }

  private coil(first: number, count: number, centre: THREE.Vector3, towards: THREE.Vector3, ahead = 0) {
    const a = COIL_SPACING / (2 * Math.PI);
    const length = Math.max(count * LED_PITCH, 1);
    const theta = (l: number) => (-COIL_INNER_RADIUS + Math.sqrt(COIL_INNER_RADIUS ** 2 + 2 * a * l)) / a;
    const thetaMax = theta(length);
    const psi = Math.atan2(towards.z - centre.z, towards.x - centre.x);
    for (let k = 0; k < count; k++) {
      const d = ahead + (k + 0.5) * LED_PITCH;
      const th = theta(Math.max(length - d, 0));
      const r = COIL_INNER_RADIUS + a * th;
      const ang = th + (psi - thetaMax);
      const i = first + k;
      this.tgt[i].set(centre.x + r * Math.cos(ang), EDGE_Y, centre.z + r * Math.sin(ang));
      this.tgtN[i].set(Math.cos(ang), 0, Math.sin(ang));
    }
  }

  private pathWorld(i: number, matrix: THREE.Matrix4) {
    const [x, y, , , nx, ny] = i < OUTER_COUNT ? LED_OUTER[i] : LED_INNER[i - OUTER_COUNT];
    this.tgt[i].set(x, STRIP_CENTRE_Z, -y).applyMatrix4(matrix);
    this.tgtN[i].set(nx, 0, -ny).transformDirection(matrix);
  }

  private computeTargets(input: StripInput) {
    const { stuck, innerMatrix } = input;
    if (!input.uncoiled) {
      this.coil(0, STRIP_LEDS, new THREE.Vector3(REST.strip.x, 0, REST.strip.z), new THREE.Vector3(REST.strip.x, 0, REST.strip.z - 100));
      return;
    }
    if (stuck === 0) {
      for (let i = 0; i < STRIP_LEDS; i++) {
        SERPENTINE_PATH.at((i + 0.5) * LED_PITCH, this.tgt[i]);
        this.tgt[i].y = FLAT_Y;
        this.tgtN[i].copy(UP);
      }
      return;
    }
    for (let i = 0; i < stuck; i++) this.pathWorld(i, innerMatrix);
    const lastStuck = this.tgt[stuck - 1].clone();
    const free = (input.trimmed ? LED_COUNT : STRIP_LEDS) - stuck;
    if (free > 0) {
      const toward = lastStuck.clone().sub(WORK_SPOOL).setY(0).normalize();
      let reach = 0;
      let start = WORK_SPOOL.clone();
      for (let pass = 0; pass < 4; pass++) {
        const coilLength = Math.max(free * LED_PITCH - reach, LED_PITCH);
        const a = COIL_SPACING / (2 * Math.PI);
        const radius = COIL_INNER_RADIUS + a * ((-COIL_INNER_RADIUS + Math.sqrt(COIL_INNER_RADIUS ** 2 + 2 * a * coilLength)) / a);
        start = WORK_SPOOL.clone().addScaledVector(toward, radius);
        reach = Math.hypot(start.x - lastStuck.x, start.z - lastStuck.z);
      }
      const onRun = Math.min(free, Math.floor(reach / LED_PITCH));
      for (let k = 0; k < onRun; k++) {
        const u = ((k + 1) * LED_PITCH) / reach;
        const i = stuck + k;
        this.tgt[i].set(lastStuck.x + (start.x - lastStuck.x) * u, FLAT_Y + (lastStuck.y - FLAT_Y) * Math.exp(-(k + 1) / 1.6), lastStuck.z + (start.z - lastStuck.z) * u);
        this.tgtN[i].copy(UP);
      }
      if (free - onRun > 0) this.coil(stuck + onRun, free - onRun, WORK_SPOOL, start, reach - onRun * LED_PITCH);
    }
    if (input.trimmed) {
      for (let i = LED_COUNT; i < STRIP_LEDS; i++) {
        const n = i - LED_COUNT;
        if (input.tidied) this.tgt[i].set(BIN.x + (n % 5) * 3 - 6, 5 + Math.floor(n / 5) * 1.3, BIN.z + (n % 3) * 3 - 3);
        else this.tgt[i].set(TRASH.x + (n + 0.5) * LED_PITCH * 0.97, FLAT_Y, TRASH.z);
        this.tgtN[i].copy(UP);
      }
    }
  }

  update(dt: number, input: StripInput) {
    this.computeTargets(input);
    this.setLit(input.lit);
    const k = input.snap ? 1 : 1 - Math.exp(-dt * 9);
    let moving = false;
    for (let i = 0; i < STRIP_LEDS; i++) {
      const stuck = i < input.stuck;
      if (!stuck) this.locked[i] = false;
      if (this.locked[i]) {
        this.cur[i].copy(this.tgt[i]);
        this.curN[i].copy(this.tgtN[i]);
        continue;
      }
      const dist = this.cur[i].distanceTo(this.tgt[i]);
      if (dist > 0.05 || this.curN[i].distanceTo(this.tgtN[i]) > 0.01) moving = true;
      this.cur[i].lerp(this.tgt[i], k);
      this.curN[i].lerp(this.tgtN[i], k).normalize();
      if (stuck && dist < 0.4) this.locked[i] = true;
    }
    this.moving = moving;

    const m = new THREE.Matrix4();
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const z = new THREE.Vector3();
    for (let i = 0; i < STRIP_LEDS; i++) {
      const a = this.cur[Math.max(i - 1, 0)];
      const b = this.cur[Math.min(i + 1, STRIP_LEDS - 1)];
      x.subVectors(b, a);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      z.copy(this.curN[i]).addScaledVector(x, -this.curN[i].dot(x)).normalize();
      y.crossVectors(z, x);
      m.makeBasis(x, y, z).setPosition(this.cur[i]);
      this.pcb.setMatrixAt(i, m);
      // The blue backing film is peeled off as the strip is stuck down.
      this.liner.setMatrixAt(i, i < input.stuck ? HIDDEN : m);
      this.chips.setMatrixAt(i, m);
      if (i === 0) {
        this.plug.direction.copy(x).negate();
        this.plug.position.copy(this.cur[0]).addScaledVector(x, -(LED_PITCH / 2 + 6 + PIGTAIL));
        this.connector.position.copy(this.plug.position);
        this.connector.quaternion.setFromRotationMatrix(m);
      }
    }
    for (const mesh of [this.pcb, this.liner, this.chips]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.pcb, this.liner, this.chips]) { m.geometry.dispose(); m.dispose(); }
  }
}
