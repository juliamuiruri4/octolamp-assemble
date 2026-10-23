import * as THREE from 'three';

/** A tube through control points that chase their targets, so cables flow between layouts. */
export class SmoothLine {
  readonly mesh: THREE.Mesh;
  readonly cur: THREE.Vector3[];
  readonly tgt: THREE.Vector3[];
  private moving = true;

  constructor(readonly points: number, private radius: number, material: THREE.Material) {
    this.cur = Array.from({ length: points }, () => new THREE.Vector3());
    this.tgt = Array.from({ length: points }, () => new THREE.Vector3());
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  get busy() { return this.moving; }

  /** Evenly spaced points along a curve through `through`, with a lift in the middle. */
  static sample(through: THREE.Vector3[], out: THREE.Vector3[]) {
    const curve = new THREE.CatmullRomCurve3(through, false, 'catmullrom', 0.3);
    out.forEach((p, i) => curve.getPointAt(i / (out.length - 1), p));
  }

  snap() { this.cur.forEach((p, i) => p.copy(this.tgt[i])); this.moving = true; }

  update(dt: number, snap: boolean) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 8);
    let moving = false;
    this.cur.forEach((p, i) => {
      if (p.distanceTo(this.tgt[i]) > 0.05) moving = true;
      p.lerp(this.tgt[i], k);
    });
    if (!moving && !this.moving) return;
    this.moving = moving;
    this.mesh.geometry.dispose();
    const curve = new THREE.CatmullRomCurve3(this.cur, false, 'catmullrom', 0.3);
    this.mesh.geometry = new THREE.TubeGeometry(curve, this.points * 4, this.radius, 12, false);
  }

  dispose() { this.mesh.geometry.dispose(); }
}
