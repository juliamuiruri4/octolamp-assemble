import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { currentStep, driverTerminal, ledsLit, usbPlugs, type BuildState } from '../build';
import { BIN, BOX, PARTS, REST, WIRE_COUNT, WIRES, type PartId } from '../layout';
import { SmoothLine } from './cable';
import {
  BLOCK, BOARD_CENTRE, COLORS, loadModel, makeBin, makeBox, makeCableTie, makeConnector, makeDesk, makePlug, makePowerBrick,
  makeScrewdriver, makeTerminalBlock, paint, paintBoard, std, usbPort, wireEntry, wireTip,
} from './parts';
import { Strip } from './strip';

export type ViewMode = 'solid' | 'wireframe' | 'angle';

export interface SceneOptions {
  reducedMotion: boolean;
  onReady: () => void;
  /** Name of the part the camera is focused on, or null for the step overview. */
  onFocus: (name: string | null) => void;
}

interface Pose { p: THREE.Vector3; q: THREE.Quaternion; s: number }
const pose = (x: number, y: number, z: number, q = new THREE.Quaternion(), s = 1): Pose => ({ p: new THREE.Vector3(x, y, z), q, s });
const rotY = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const rotX = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const rotZ = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const UP = new THREE.Vector3(0, 1, 0);

/** Eased move between poses. The target is a function so parts can follow others while they move. */
class Mover {
  cur = pose(0, 0, 0);
  private from = pose(0, 0, 0);
  private t = 1;
  private dur = 1;
  private arc = 0;
  private target: () => Pose = () => this.cur;
  private last = new THREE.Vector3(Infinity, 0, 0);

  constructor(readonly obj: THREE.Object3D) {}

  /** True once the last move has finished (also true when it was a snap). */
  get settled() { return this.t >= 1; }

  to(target: () => Pose, o: { dur?: number; arc?: number; snap?: boolean; delay?: number } = {}) {
    this.from = { p: this.cur.p.clone(), q: this.cur.q.clone(), s: this.cur.s };
    this.target = target;
    this.dur = o.dur ?? 0.9;
    this.arc = o.arc ?? 0;
    this.t = o.snap ? 1 : -(o.delay ?? 0) / this.dur;
  }

  dropIn(height: number) {
    this.cur.p.y += height;
    this.cur.s = 0.8;
  }

  update(dt: number): boolean {
    const tg = this.target();
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = ease(Math.max(this.t, 0));
      this.cur.p.lerpVectors(this.from.p, tg.p, e);
      this.cur.p.y += this.arc * Math.sin(Math.PI * e);
      this.cur.q.slerpQuaternions(this.from.q, tg.q, e);
      this.cur.s = this.from.s + (tg.s - this.from.s) * e;
    } else {
      this.cur.p.copy(tg.p);
      this.cur.q.copy(tg.q);
      this.cur.s = tg.s;
    }
    this.obj.position.copy(this.cur.p);
    this.obj.quaternion.copy(this.cur.q);
    this.obj.scale.setScalar(this.cur.s);
    const busy = this.t < 1 || this.last.distanceToSquared(this.cur.p) > 1e-4;
    this.last.copy(this.cur.p);
    return busy;
  }
}

interface View { x: number; z: number; w: number; h: number; el: number }

function viewFor(s: BuildState): View {
  switch (currentStep(s)) {
    case 0: return { x: 40, z: 100, w: 760, h: 470, el: 62 };
    case 1: return { x: -118, z: 200, w: 120, h: 95, el: 62 };
    case 2: return { x: 100, z: 155, w: 580, h: 230, el: 60 };
    case 3: case 4: return { x: 0, z: 50, w: 300, h: 380, el: 64 };
    case 5: return s.assembled < 2 ? { x: -5, z: -35, w: 720, h: 300, el: 58 } : { x: 105, z: -25, w: 580, h: 330, el: 58 };
    case 6: return { x: 140, z: -10, w: 600, h: 360, el: 66 };
    default: return { x: -60, z: -45, w: 940, h: 640, el: 74 };
  }
}

const BRICK = new THREE.Vector3(345, 0, 70);
const CAVITY = new THREE.Vector3(1.25, 0, 11.25);
const VFOV = 32;
const GLOW_TINT = new THREE.Color('#4fe07d');

const RIG = {
  open: { flip: 0, x: 0, y: 15, z: -40 },
  aside: { flip: Math.PI, x: 250, y: 2, z: -40 },
  seated: { flip: Math.PI, x: 0, y: 11.5, z: -40 },
  packed: { flip: Math.PI, x: BOX.x, y: 14.5, z: BOX.z },
};
/** Where the reflector's wire slot is, in the reflector model's own frame (mm, from the STL), and either side of it. */
const LID_OPEN = -1.75;
const SLOT = { under: new THREE.Vector3(14, 5, 52), over: new THREE.Vector3(14, -5, 52) };

export class OctolampScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(VFOV, 1, 5, 6000);
  private readonly controls: OrbitControls;
  private readonly movers = new Map<PartId, Mover>();
  private readonly keys = new Map<PartId, string>();
  private readonly shown = new Map<PartId, boolean>();
  private readonly drop = new Map<PartId, number>();
  private readonly strip = new Strip();
  private readonly innerMaterial = std(COLORS.white, 0.6);
  private readonly screws: THREE.Mesh[];
  private readonly screwState: { angle: number; lift: number }[];
  private readonly board = new THREE.Group();
  private readonly ledCable = new THREE.Group();
  private readonly wires = WIRES.map((w) => new SmoothLine(8, 0.75, std(COLORS.wire[w.color], 0.5)));
  private readonly tips = WIRES.map(() => new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 4, 8), std('#c98a52', 0.4, 0.8)));
  private readonly cableConnector = makeConnector();
  private readonly wireEnds = WIRES.map(() => new THREE.Vector3());
  private readonly usb = new SmoothLine(18, 2, std('#17181a', 0.8));
  private readonly usbGroup = new THREE.Group();
  private readonly plugC = makePlug('c');
  private readonly plugA = makePlug('a');
  private readonly brick = makePowerBrick();
  private readonly dynamic = new Map<PartId, THREE.Object3D>();
  private rig = { ...RIG.open, lift: 0 };
  private rigFrom = { ...RIG.open };
  private rigTarget = RIG.open;
  private rigT = 1;
  private rigArc = 0;
  private readonly rigPoses = { inner: pose(0, 0, 0), reflector: pose(0, 0, 0) };
  private lit = 0;
  private litTarget = 0;
  private finalLit = 0;
  private finalLitTarget = 0;
  private build!: BuildState;
  private goal = { target: new THREE.Vector3(), position: new THREE.Vector3() };
  private flying = false;
  private hold = 0;
  private prevStep = 0;
  private readonly box = makeBox();
  private readonly bin = makeBin();
  private lid = LID_OPEN;
  private lidTarget = LID_OPEN;
  private lidDelay = 0;
  private boxDrop = 0;
  private frame = 0;
  private running = false;
  private last = 0;
  private first = true;
  private snap: boolean;
  private disposed = false;
  private sunLight!: THREE.DirectionalLight;
  private desk!: THREE.Mesh;
  private readonly overrides: Record<Exclude<ViewMode, 'solid'>, THREE.Material> = {
    wireframe: new THREE.MeshBasicMaterial({ color: '#9fe8b4', wireframe: true }),
    angle: new THREE.MeshNormalMaterial(),
  };
  private readonly woodBackground = new THREE.Color('#7a5f43');
  private width = 1;
  private height = 1;
  private dragging = false;
  private focused: PartId | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();

  private constructor(private canvas: HTMLCanvasElement, private opts: SceneOptions) {
    this.snap = opts.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.scene.background = this.woodBackground;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 1.2;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 1800;
    this.controls.addEventListener('start', () => { this.dragging = true; this.flying = false; });
    this.controls.addEventListener('end', () => { this.dragging = false; });
    this.controls.addEventListener('change', () => { this.keepOnDesk(); this.wake(); });
    canvas.addEventListener('keydown', this.onKey);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    const block = makeTerminalBlock();
    this.screws = block.screws;
    this.screwState = block.screws.map(() => ({ angle: 0, lift: 0 }));
    this.board.add(block.group);
  }

  static async create(canvas: HTMLCanvasElement, opts: SceneOptions): Promise<OctolampScene> {
    const s = new OctolampScene(canvas, opts);
    await s.load();
    return s;
  }

  private async load() {
    const [base, cover, inner, reflector, board] = await Promise.all(
      ['base', 'cover', 'inner', 'reflector', 'sparkle-motion-mini'].map(loadModel),
    );
    this.desk = makeDesk();
    this.scene.add(this.desk);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#a89478', 0.55));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    const sun = new THREE.DirectionalLight('#ffffff', 1.7);
    sun.position.set(-260, 700, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 420, bottom: -420, near: 100, far: 1600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.sunLight = sun;

    const black = std(COLORS.black, 0.55);
    paint(base, black);
    paint(cover, black);
    paint(inner, this.innerMaterial);
    paint(reflector, std(COLORS.white, 0.6));
    paintBoard(board);
    board.position.set(-BOARD_CENTRE.x, 0, -BOARD_CENTRE.z);
    this.board.add(board);
    cover.position.set(0, 9.3, 63);
    const coverGroup = new THREE.Group().add(cover);
    const driver = makeScrewdriver();
    const tie = makeCableTie();

    const rigid: Record<string, THREE.Object3D> = {
      base, cover: coverGroup, inner, reflector, screwdriver: driver, board: this.board, tie,
    };
    for (const [id, obj] of Object.entries(rigid)) {
      this.scene.add(obj);
      this.movers.set(id as PartId, new Mover(obj));
      obj.visible = false;
    }
    this.initPoses();

    this.ledCable.add(this.cableConnector, ...this.wires.map((w) => w.mesh), ...this.tips);
    this.usbGroup.add(this.usb.mesh, this.plugC, this.plugA);
    this.brick.position.copy(BRICK);
    this.scene.add(this.strip.group, this.ledCable, this.usbGroup, this.brick, this.box.group, this.bin);
    this.box.group.position.set(BOX.x, 0, BOX.z);
    this.box.lid.rotation.x = LID_OPEN;
    this.box.group.visible = false;
    this.bin.position.set(BIN.x, 0, BIN.z);
    this.bin.visible = false;
    this.dynamic.set('strip', this.strip.group);
    this.dynamic.set('ledcable', this.ledCable);
    this.dynamic.set('usb', this.usbGroup);
    for (const g of [this.strip.group, this.ledCable, this.usbGroup, this.brick]) g.visible = false;
    this.dynamic.forEach((g) => g.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; }));
    this.opts.onReady();
  }

  private initPoses() {
    const rest = (id: PartId, y: number, q = new THREE.Quaternion()) => pose(REST[id].x, y, REST[id].z, q);
    const m = (id: PartId) => this.movers.get(id)!;
    m('base').cur = rest('base', 12);
    m('cover').cur = rest('cover', 2.7);
    m('reflector').cur = rest('reflector', 0);
    m('screwdriver').cur = this.driverRest();
    m('board').cur = rest('board', 2.6, rotY(-Math.PI / 2));
    m('tie').cur = pose(REST.tie.x, 0, REST.tie.z, rotY((-REST.tie.rot * Math.PI) / 180));
    this.stepRig(0);
  }

  /** The driver lies flat along +x with its tip at the pivot, well clear of the base. */
  private driverRest(): Pose {
    return pose(REST.screwdriver.x - 31, 4.6, REST.screwdriver.z, new THREE.Quaternion());
  }

  private rigPose(which: 'inner' | 'reflector'): Pose {
    const { flip, x, y, z } = this.rig;
    const rz = rotZ(flip);
    const offset = new THREE.Vector3(0, which === 'inner' ? -2 : 2, 0).applyQuaternion(rz);
    const q = which === 'inner' ? rz.clone().multiply(rotY(Math.PI)) : rz.clone().multiply(rotZ(Math.PI));
    return { p: new THREE.Vector3(x, y + this.rig.lift, z).add(offset), q, s: 1 };
  }

  private stepRig(dt: number): boolean {
    if (this.rigT < 1) {
      this.rigT = Math.min(1, this.rigT + dt / 1.5);
      const e = ease(this.rigT);
      const a = this.rigFrom;
      const b = this.rigTarget;
      this.rig.flip = a.flip + (b.flip - a.flip) * e;
      this.rig.x = a.x + (b.x - a.x) * e;
      this.rig.y = a.y + (b.y - a.y) * e;
      this.rig.z = a.z + (b.z - a.z) * e;
      this.rig.lift = this.rigArc * Math.sin(Math.PI * e);
    }
    this.rigPoses.inner = this.rigPose('inner');
    this.rigPoses.reflector = this.rigPose('reflector');
    const inner = this.movers.get('inner')!;
    inner.cur = this.rigPoses.inner;
    inner.update(0);
    return this.rigT < 1;
  }

  private basePose(): Pose { return this.movers.get('base')!.cur; }

  private cavityPose(id: 'board' | 'cover'): Pose {
    const base = this.basePose();
    const local = id === 'board'
      ? new THREE.Vector3(CAVITY.x, -8.4, CAVITY.z)
      : new THREE.Vector3(CAVITY.x, -3.3, CAVITY.z);
    const q = base.q.clone().multiply(rotY(id === 'board' ? -Math.PI / 2 : Math.PI / 2));
    return { p: base.p.clone().add(local.applyQuaternion(base.q)), q, s: 1 };
  }

  setBuild(s: BuildState) {
    const first = this.first;
    this.first = false;
    this.build = s;
    const snap = this.snap || first;
    const step = currentStep(s);
    const a = s.assembled;
    const mv = (id: PartId) => this.movers.get(id)!;
    const retarget = (id: PartId, key: string, target: () => Pose, o: { dur?: number; arc?: number; delay?: number } = {}) => {
      if (this.keys.get(id) === key) return;
      this.keys.set(id, key);
      mv(id).to(target, { ...o, snap });
    };

    PARTS.forEach((part, i) => {
      const vis = i < s.laidOut;
      const was = this.shown.get(part.id) ?? false;
      this.shown.set(part.id, vis);
      const m = this.movers.get(part.id);
      if (m) m.obj.visible = vis;
      const dyn = this.dynamic.get(part.id);
      if (dyn) dyn.visible = vis;
      if (part.id === 'usb') this.brick.visible = vis && step >= 2 && !s.tidied;
      if (vis && !was && !snap) {
        if (m) m.dropIn(90);
        this.drop.set(part.id, 90);
      }
    });

    const restOf = (id: PartId, y: number, q = new THREE.Quaternion()) => () => pose(REST[id].x, y, REST[id].z, q);
    const seat = s.packed ? RIG.packed : RIG.seated;
    retarget('base', a >= 2 ? (s.packed ? 'boxed' : 'center') : 'rest', a >= 2 ? () => pose(seat.x, s.packed ? 15 : 12, seat.z) : restOf('base', 12), { arc: 45 });
    retarget('reflector', a >= 1 ? 'rig' : 'rest', a >= 1 ? () => this.rigPoses.reflector : restOf('reflector', 0), { arc: 50 });
    retarget('board', a >= 2 ? 'cavity' : 'rest', a >= 2 ? () => this.cavityPose('board') : restOf('board', 2.6, rotY(-Math.PI / 2)), { arc: 60 });
    retarget('cover', a >= 4 ? 'cavity' : 'rest', a >= 4 ? () => this.cavityPose('cover') : restOf('cover', 2.7), { arc: 40 });

    const driverAt = snap && s.tightened === WIRE_COUNT ? null : driverTerminal(s);
    const leaving = driverAt === null && (this.keys.get('screwdriver') ?? '').startsWith('screw');
    const boxed = (dx: number, dz: number, y: number, q = new THREE.Quaternion()) => () => pose(BOX.x + dx, y, BOX.z + dz, q);
    retarget('screwdriver', driverAt === null ? (s.tidied ? 'boxed' : 'rest') : `screw${driverAt}`,
      driverAt === null
        ? (s.tidied ? boxed(-101, 105, 7.6) : () => this.driverRest())
        : () => this.driverPose(driverAt),
      { arc: 45, delay: leaving ? 1.1 : 0 });
    const tieQuat = rotY((-REST.tie.rot * Math.PI) / 180);
    retarget('tie', s.tidied ? 'boxed' : 'rest', s.tidied ? boxed(50, 98, 3, rotY(0.3)) : () => pose(REST.tie.x, 0, REST.tie.z, tieQuat), { arc: 45, delay: s.tidied ? 0.35 : 0 });

    const target = s.packed ? RIG.packed : a >= 5 ? RIG.seated : a >= 2 ? RIG.aside : RIG.open;
    if (target !== this.rigTarget) {
      const flipping = (target === RIG.open) !== (this.rigTarget === RIG.open);
      this.rigFrom = { flip: this.rig.flip, x: this.rig.x, y: this.rig.y, z: this.rig.z };
      this.rigTarget = target;
      this.rigArc = flipping ? 125 : 70;
      this.rigT = snap ? 1 : 0;
      if (snap) Object.assign(this.rig, target, { lift: 0 });
    }

    this.litTarget = ledsLit(s) ? 1 : 0;
    this.finalLitTarget = s.finalPowered && !s.tidied ? 1 : 0;
    const showBox = s.finalPowered;
    if (showBox && !this.box.group.visible && !snap) this.boxDrop = 90;
    this.box.group.visible = showBox;
    this.bin.visible = showBox;
    this.lidTarget = s.packed ? 0 : LID_OPEN;
    this.lidDelay = s.packed && !snap ? 1.5 : 0;
    if (snap) { this.lid = this.lidTarget; this.boxDrop = 0; }

    // Linger on the screws after the last tighten, and on each glow, so the result can be seen.
    this.hold = 0;
    if (!snap && step > this.prevStep) this.hold = this.prevStep === 1 ? 2.6 : this.prevStep === 0 ? 2.2 : this.prevStep === 2 || this.prevStep === 4 ? 1.8 : 0;
    this.prevStep = step;
    const view = viewFor(s);
    this.setFocused(null);
    this.fly(view, snap);
    this.wake(snap);
  }

  /** Terminal the driver is currently assigned to, or null when it is away. */
  private driverScrew(): number | null {
    const key = this.keys.get('screwdriver') ?? '';
    return key.startsWith('screw') ? Number(key.slice(5)) : null;
  }

  private screwWorld(k: number): THREE.Vector3 {
    this.board.updateMatrixWorld();
    return this.screws[k].getWorldPosition(new THREE.Vector3());
  }

  private driverPose(k: number): Pose {
    // The driver's handle runs along local +x, so +x must point up and slightly toward the viewer.
    const tip = this.screwWorld(k).add(new THREE.Vector3(0, 0.5, 0));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.12, 1, 0.45).normalize());
    return { p: tip, q, s: 1 };
  }

  private fly(view: View, snap: boolean) {
    const aspect = this.width / this.height;
    const hfov = 2 * Math.atan(Math.tan((VFOV * Math.PI) / 360) * aspect);
    const el = (view.el * Math.PI) / 180;
    const dist = 1.08 * Math.max(view.w / (2 * Math.tan(hfov / 2)), (view.h * Math.sin(el)) / (2 * Math.tan((VFOV * Math.PI) / 360)));
    this.goal.target.set(view.x, 0, view.z);
    this.goal.position.set(view.x, Math.sin(el) * dist, view.z + Math.cos(el) * dist);
    this.flying = true;
    if (snap) {
      this.camera.position.copy(this.goal.position);
      this.controls.target.copy(this.goal.target);
      this.controls.update();
      this.flying = false;
    }
  }

  resize(width: number, height: number) {
    this.width = Math.max(width, 1);
    this.height = Math.max(height, 1);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.build) this.fly(viewFor(this.build), true);
    this.wake(true);
  }

  /** Same inspection modes as GitHub's STL viewer, applied to every part. */
  setViewMode(mode: ViewMode) {
    const solid = mode === 'solid';
    this.desk.visible = solid;
    this.scene.background = solid ? this.woodBackground : new THREE.Color('#101411');
    this.scene.overrideMaterial = solid ? null : this.overrides[mode];
    this.wake();
  }

  recenter() {
    this.setFocused(null);
    if (this.build) this.fly(viewFor(this.build), this.snap);
    this.wake();
  }

  private setFocused(id: PartId | null) {
    if (id === this.focused) return;
    this.focused = id;
    this.opts.onFocus(id ? PARTS.find((p) => p.id === id)!.name : null);
  }

  /** Parts that are on the desk right now, in kit order. */
  private focusables() {
    const out: Array<{ id: PartId; obj: THREE.Object3D }> = [];
    for (const part of PARTS) {
      const obj = this.movers.get(part.id)?.obj ?? this.dynamic.get(part.id);
      if (obj?.visible && this.shown.get(part.id)) out.push({ id: part.id, obj });
    }
    return out;
  }

  /** Flies the camera in on one part, keeping the current viewing direction. */
  focusPart(id: PartId) {
    const item = this.focusables().find((f) => f.id === id);
    if (!item) return;
    item.obj.updateWorldMatrix(true, true);
    const box = id === 'strip' ? this.strip.bounds() : new THREE.Box3().setFromObject(item.obj);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const tan = Math.tan((VFOV * Math.PI) / 360);
    const fit = Math.min(tan, tan * (this.width / this.height));
    const dist = THREE.MathUtils.clamp((sphere.radius / fit) * 1.3, 45, 1500);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const az = Math.atan2(offset.x, offset.z);
    const el = (58 * Math.PI) / 180;
    this.goal.target.set(sphere.center.x, Math.min(Math.max(sphere.center.y, 0), 20), sphere.center.z);
    this.goal.position.copy(this.goal.target).add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist));
    this.flying = true;
    if (this.snap) {
      this.camera.position.copy(this.goal.position);
      this.controls.target.copy(this.goal.target);
      this.flying = false;
    }
    this.setFocused(id);
    this.wake();
  }

  /** Previous or next part on the desk; the first press starts at the first or last part. */
  focusStep(delta: 1 | -1) {
    const list = this.focusables();
    if (!list.length) return;
    const at = list.findIndex((f) => f.id === this.focused);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
    this.focusPart(list[next].id);
  }

  private onPointerDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };

  /** A tap (not a drag) on a part focuses it. */
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), this.camera);
    const items = this.focusables();
    const hit = this.raycaster.intersectObjects(items.map((i) => i.obj), true)[0];
    if (!hit) return;
    const found = items.find((i) => { let o: THREE.Object3D | null = hit.object; while (o && o !== i.obj) o = o.parent; return o === i.obj; });
    if (found) this.focusPart(found.id);
  };

  /** Keeps the view target over the desk so panning cannot lose the table. */
  private keepOnDesk() {
    const t = this.controls.target;
    const x = THREE.MathUtils.clamp(t.x, -700, 700);
    const y = THREE.MathUtils.clamp(t.y, 0, 30);
    const z = THREE.MathUtils.clamp(t.z, -450, 600);
    if (x === t.x && y === t.y && z === t.z) return;
    this.camera.position.add(new THREE.Vector3(x - t.x, y - t.y, z - t.z));
    t.set(x, y, z);
  }

  private onKey = (e: KeyboardEvent) => {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    if (e.key === 'Home') { this.recenter(); return; }
    if (e.key === ']' || e.key === 'PageDown') { e.preventDefault(); this.focusStep(1); return; }
    if (e.key === '[' || e.key === 'PageUp') { e.preventDefault(); this.focusStep(-1); return; }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault();
      const zoomIn = e.key === '+' || e.key === '=';
      sph.radius = THREE.MathUtils.clamp(sph.radius * (zoomIn ? 0.8 : 1.25), this.controls.minDistance, this.controls.maxDistance);
    } else if (e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const pan = sph.radius * 0.12;
      const forward = new THREE.Vector3(-offset.x, 0, -offset.z).normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const move = new THREE.Vector3();
      if (e.key === 'ArrowLeft') move.addScaledVector(right, -pan);
      else if (e.key === 'ArrowRight') move.addScaledVector(right, pan);
      else if (e.key === 'ArrowUp') move.addScaledVector(forward, pan);
      else move.addScaledVector(forward, -pan);
      this.controls.target.add(move);
      this.camera.position.add(move);
    } else {
      const step = 0.12;
      if (e.key === 'ArrowLeft') sph.theta -= step;
      else if (e.key === 'ArrowRight') sph.theta += step;
      else if (e.key === 'ArrowUp') sph.phi -= step;
      else if (e.key === 'ArrowDown') sph.phi += step;
      else return;
      e.preventDefault();
      sph.phi = THREE.MathUtils.clamp(sph.phi, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    }
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(sph));
    this.flying = false;
    this.controls.update();
    this.keepOnDesk();
    this.wake();
  };

  private wake(snap = false) {
    if (snap) this.snapNext = true;
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }
  private snapNext = false;

  private tick = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const busy = this.step(dt);
    this.renderer.render(this.scene, this.camera);
    if (busy) this.frame = requestAnimationFrame(this.tick);
    else this.running = false;
  };

  private step(dt: number): boolean {
    const snap = this.snap || this.snapNext;
    this.snapNext = false;
    let busy = this.stepRig(snap ? 10 : dt);
    for (const [id, m] of this.movers) {
      if (id === 'inner') continue;
      if (m.update(snap ? 10 : dt)) busy = true;
    }
    const held = this.driverScrew();
    if (held !== null) {
      const d = this.movers.get('screwdriver')!;
      d.obj.quaternion.multiply(rotX(this.screwState[held].angle));
    }
    const innerObj = this.movers.get('inner')!.obj;
    innerObj.updateMatrixWorld(true);
    this.board.updateMatrixWorld(true);

    const s = this.build;
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.lit += (this.litTarget - this.lit) * k;
    this.finalLit += (this.finalLitTarget - this.finalLit) * k;
    if (Math.abs(this.lit - this.litTarget) > 0.01 || Math.abs(this.finalLit - this.finalLitTarget) > 0.01) busy = true;
    const glow = Math.max(this.lit, this.finalLit);
    this.innerMaterial.color.set(COLORS.white).lerp(GLOW_TINT, this.finalLit * 0.85);
    this.innerMaterial.emissive.set(COLORS.green).multiplyScalar(this.finalLit * 0.85);
    this.sunLight.intensity = 1.7 - glow * 0.7;

    const stuck = s.outer + s.inner;
    this.strip.update(dt, {
      uncoiled: s.uncoiled, stuck, trimmed: s.trimmed, innerMatrix: innerObj.matrixWorld, lit: glow, snap,
      tidied: s.tidied,
    });
    if (this.strip.busy) busy = true;
    for (const [id, y] of this.drop) {
      const next = snap ? 0 : y * Math.exp(-dt * 6);
      const g = this.dynamic.get(id);
      if (g) g.position.y = next;
      if (next < 0.2) { this.drop.delete(id); if (g) g.position.y = 0; } else { this.drop.set(id, next); busy = true; }
    }

    if (this.lidDelay > 0) { this.lidDelay -= dt; busy = true; }
    else {
      this.lid += (this.lidTarget - this.lid) * (snap ? 1 : 1 - Math.exp(-dt * 3.5));
      if (Math.abs(this.lidTarget - this.lid) > 0.004) busy = true;
    }
    this.box.lid.rotation.x = this.lid;
    this.boxDrop = snap ? 0 : this.boxDrop * Math.exp(-dt * 6);
    if (this.boxDrop > 0.2) busy = true;
    this.box.group.position.y = this.boxDrop;

    if (this.updateScrews(dt, snap)) busy = true;
    if (this.updateCables(dt, snap)) busy = true;
    if (this.updateCamera(dt, snap)) busy = true;
    if (this.controls.update()) busy = true;
    return busy || this.dragging;
  }

  private updateScrews(dt: number, snap: boolean): boolean {
    const s = this.build;
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    let busy = false;
    WIRES.forEach((w, i) => {
      const st = this.screwState[w.terminal];
      // While the driver is still flying to this screw, show the state from before the turn.
      const waiting = this.driverScrew() === w.terminal ? !this.movers.get('screwdriver')!.settled : false;
      const open = (s.loosened > i && s.tightened <= i) !== waiting;
      const angleTarget = open ? Math.PI * 2 : 0;
      const liftTarget = open ? 0.7 : 0;
      if (Math.abs(angleTarget - st.angle) > 0.01 || Math.abs(liftTarget - st.lift) > 0.01) busy = true;
      st.angle += (angleTarget - st.angle) * k;
      st.lift += (liftTarget - st.lift) * k;
      const screw = this.screws[w.terminal];
      screw.rotation.y = st.angle;
      screw.position.y = BLOCK.y + BLOCK.h / 2 + 0.2 + st.lift;
    });
    return busy;
  }

  private updateCables(dt: number, snap: boolean): boolean {
    const s = this.build;
    const board = this.board;
    const a = s.assembled;
    const toWorld = (v: THREE.Vector3) => board.localToWorld(v.clone());
    const boardDir = (v: THREE.Vector3) => v.clone().transformDirection(board.matrixWorld);

    // LED cable: the connector follows the strip once joined; wire ends follow the terminals once inserted.
    const restC = new THREE.Vector3(REST.ledcable.x, 2.8, REST.ledcable.z);
    const connQuat = new THREE.Quaternion();
    let connPos = restC;
    if (s.connected) {
      connPos = this.strip.plug.position.clone().addScaledVector(this.strip.plug.direction, 11.8);
      connQuat.copy(this.strip.connector.quaternion);
    } else {
      connQuat.copy(rotY(Math.PI / 2));
    }
    const kk = snap ? 1 : 1 - Math.exp(-dt * 8);
    this.cableConnector.position.lerp(connPos, kk);
    this.cableConnector.quaternion.slerp(connQuat, kk);
    let busy = this.cableConnector.position.distanceTo(connPos) > 0.05;
    const start = this.cableConnector.position;

    WIRES.forEach((w, i) => {
      const inserted = s.wired > i;
      const restEnd = new THREE.Vector3(REST.board.x + (i - 1) * 9, 1.2, REST.board.z + 52);
      const tip = toWorld(wireTip(w.terminal));
      const entry = toWorld(wireEntry(w.terminal));
      const out = boardDir(new THREE.Vector3(1, 0, 0));
      const end = this.wireEnds[i];
      const targetEnd = inserted ? tip : restEnd;
      if (!end.lengthSq()) end.copy(targetEnd);
      end.lerp(targetEnd, kk);
      if (end.distanceTo(targetEnd) > 0.05) busy = true;
      const lateral = new THREE.Vector3(0, 0, (i - 1) * 1.6).applyQuaternion(this.cableConnector.quaternion);
      const from = start.clone().add(lateral);
      const through = [from];
      // From "Thread wires" on, the wires pass through the reflector's slot, between it and the LED holder.
      let after = from;
      if (a >= 1) {
        const ref = this.movers.get('reflector')!.obj;
        ref.updateWorldMatrix(true, false);
        const spread = new THREE.Vector3((i - 1) * 3, 0, 0);
        const under = ref.localToWorld(SLOT.under.clone().add(spread));
        const over = ref.localToWorld(SLOT.over.clone().add(spread));
        through.push(under, over);
        after = over;
      }
      const dist = after.distanceTo(end);
      const mid = after.clone().lerp(end, 0.5);
      mid.y = Math.max(mid.y, 1.5) + Math.min(28, dist * 0.12);
      through.push(mid);
      if (inserted) through.push(entry.clone().addScaledVector(out, 9).setY(Math.max(entry.y, 3)), entry);
      through.push(end.clone());
      SmoothLine.sample(through, this.wires[i].tgt);
      if (snap) this.wires[i].snap();
      this.wires[i].update(dt, snap);
      if (this.wires[i].busy) busy = true;
      const tipMesh = this.tips[i];
      const last = this.wires[i].cur[this.wires[i].points - 1];
      const prev = this.wires[i].cur[this.wires[i].points - 2];
      tipMesh.position.copy(last);
      tipMesh.quaternion.setFromUnitVectors(UP, last.clone().sub(prev).normalize());
    });

    // USB cable: coiled until plugged into the board; the far end goes to the power supply only while it is powered.
    const plugs = usbPlugs(s);
    const brickPort = BRICK.clone().add(new THREE.Vector3(-17, 10, 0));
    if (plugs.board) {
      const A = toWorld(usbPort());
      const out = boardDir(new THREE.Vector3(-1, 0, 0));
      const through = [A, A.clone().addScaledVector(out, 14).setY(A.y + 2)];
      const supplyEnd = brickPort.clone().add(new THREE.Vector3(-26, -6, 0));
      if (a >= 3) {
        const base = this.basePose();
        const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(base.q).add(base.p);
        through.push(local(23, -6, -12), local(23, -9, 62), local(4, -9.5, 82), local(4, -10, 103).setY(1.6));
        if (plugs.supply) through.push(new THREE.Vector3(70, 1.8, 112), supplyEnd);
        else through.push(local(14, -10.2, 112), local(30, -10.2, 116));
      } else {
        const mid = A.clone().lerp(brickPort, 0.5);
        through.push(mid.setY(2.4), supplyEnd);
      }
      if (plugs.supply) through.push(brickPort);
      SmoothLine.sample(through, this.usb.tgt);
    } else {
      const c = new THREE.Vector3(REST.usb.x, 2.4, REST.usb.z);
      this.usb.tgt.forEach((p, i) => {
        const ang = i * 0.95;
        const r = 6 + i * 1.2;
        p.set(c.x + Math.cos(ang) * r, 2.4, c.z + Math.sin(ang) * r);
      });
    }
    if (snap) this.usb.snap();
    this.usb.update(dt, snap);
    if (this.usb.busy) busy = true;
    const u = this.usb.cur;
    const n = this.usb.points;
    this.plugC.position.copy(u[0]);
    this.plugC.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), u[1].clone().sub(u[0]).normalize());
    this.plugA.position.copy(u[n - 1]);
    this.plugA.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), u[n - 1].clone().sub(u[n - 2]).normalize());
    return busy;
  }

  private updateCamera(dt: number, snap: boolean): boolean {
    if (!this.flying) return false;
    if (this.hold > 0 && !snap) { this.hold -= dt; return true; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    this.camera.position.lerp(this.goal.position, k);
    this.controls.target.lerp(this.goal.target, k);
    if (this.camera.position.distanceTo(this.goal.position) < 0.5 && this.controls.target.distanceTo(this.goal.target) < 0.5) {
      this.flying = false;
      return false;
    }
    return true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.strip.dispose();
    Object.values(this.overrides).forEach((m) => m.dispose());
    this.wires.forEach((w) => w.dispose());
    this.usb.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
  }
}
