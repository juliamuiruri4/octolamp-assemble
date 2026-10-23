import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX, TERMINAL_COUNT } from '../layout';

export const COLORS = {
  black: '#1c1e1d',
  white: '#f3f3ef',
  strip: '#e6eaee',
  liner: '#3f86d8',
  chipOff: '#ece7c4',
  chipOn: '#46ff7a',
  green: '#0fbf3e',
  terminal: '#1fb36b',
  wire: { red: '#d9263a', green: '#12a38a', white: '#f2f4f6' },
} as const;

export const std = (color: string, roughness = 0.6, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Printed parts and the board come from GLB; the loader decodes meshopt and adds the normals STL lacks. */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export async function loadModel(id: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(`./models/${id}.glb`);
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = toCreasedNormals(o.geometry, Math.PI / 5);
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return gltf.scene;
}

export function paint(root: THREE.Object3D, material: THREE.Material) {
  root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = material; });
}

/** Materials for the Adafruit board, keyed by the component names in the STEP file (the model carries no colours). */
export function paintBoard(root: THREE.Object3D) {
  const mats = {
    pcb: std('#141619', 0.45),
    metal: std('#b9bdc2', 0.35, 0.8),
    chip: std('#0e0f11', 0.4),
    cream: std('#e4dcc4', 0.55),
    button: std('#1b1c1e', 0.5),
    tan: std('#c19a62', 0.5),
    led: std('#f1efe6', 0.4),
  };
  const byName: Record<string, THREE.Material> = {
    Board: mats.pcb,
    'USB_C_CUSB31-CFM2AX-01-X': mats.metal,
    'ESP32-MINI-1': mats.metal,
    SPH0645LM4H: mats.metal,
    JST_SH3: mats.cream,
    JST_SH4: mats.cream,
    'BTN_RKB2_4.6X2.8': mats.button,
    PTC1210: mats.tan,
    '0805-NO': mats.tan,
    _0402NO: mats.tan,
    SK6805_1515: mats.led,
    CHIPLED_0603_NOOUTLINE: mats.led,
  };
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = byName[o.name] ?? mats.chip;
  });
}

/** Plank-textured desk, like the kit photos. */
export function makeDesk(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const y0 = (i * 1024) / planks;
    const tone = 150 + ((i * 37) % 30);
    g.fillStyle = `rgb(${tone},${tone - 36},${tone - 68})`;
    g.fillRect(0, y0, 1024, 1024 / planks);
    for (let k = 0; k < 90; k++) {
      const y = y0 + Math.random() * (1024 / planks);
      g.strokeStyle = `rgba(${60 + Math.random() * 40},${35 + Math.random() * 25},${15 + Math.random() * 15},${0.08 + Math.random() * 0.16})`;
      g.lineWidth = 0.6 + Math.random() * 1.8;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin((x / 1024) * Math.PI * 2 * (1 + (k % 3)) + k) * 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(30,18,8,0.28)';
    g.fillRect(0, y0, 1024, 2);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 4);
  texture.anisotropy = 4;
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1800), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 }));
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  return desk;
}

const box = (w: number, h: number, d: number, material: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Board-local frame (model centred on its PCB): the terminal block sits on the +x edge, USB-C on -x. */
export const BOARD_CENTRE = new THREE.Vector3(14.7, 0, -9.9);
const TERMINAL_PITCH = 3.81;
export const BLOCK = { x: 26.9 - BOARD_CENTRE.x, y: 6, w: 8.8, h: 8, d: 15.5 };
/** Left to right with the USB-C port at the top, which is descending board-local z. */
const terminalZ = (k: number) => ((TERMINAL_COUNT - 1) / 2 - k) * TERMINAL_PITCH;
/** Where a wire enters the block (board-local, outside the face) and where its tip ends up when inserted. */
export const wireEntry = (k: number) => new THREE.Vector3(BLOCK.x + BLOCK.w / 2 + 0.2, BLOCK.y - 0.5, terminalZ(k));
export const wireTip = (k: number) => new THREE.Vector3(BLOCK.x + 1, BLOCK.y - 0.5, terminalZ(k));
export const usbPort = () => new THREE.Vector3(-1.05 - BOARD_CENTRE.x - 1, 3.2, 0);

export interface TerminalBlock { group: THREE.Group; screws: THREE.Mesh[] }

/** The Sparkle Motion Mini 6314 has a green screw terminal block soldered on; Adafruit's CAD (6160) has bare pads. */
export function makeTerminalBlock(): TerminalBlock {
  const group = new THREE.Group();
  const green = std(COLORS.terminal, 0.4);
  const body = box(BLOCK.w, BLOCK.h, BLOCK.d, green);
  body.position.set(BLOCK.x, BLOCK.y, 0);
  group.add(body);
  const dark = std('#0b0c0d', 0.5);
  const screwMat = std('#c7cacd', 0.4, 0.6);
  const screws: THREE.Mesh[] = [];
  for (let k = 0; k < TERMINAL_COUNT; k++) {
    const hole = box(0.2, 3.2, 2.8, dark);
    hole.position.set(BLOCK.x + BLOCK.w / 2 + 0.05, BLOCK.y - 0.5, terminalZ(k));
    group.add(hole);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 20), screwMat);
    screw.position.set(BLOCK.x - 0.6, BLOCK.y + BLOCK.h / 2 + 0.2, terminalZ(k));
    screw.castShadow = true;
    const slot = box(2.8, 0.3, 0.45, dark);
    slot.position.y = 0.4;
    screw.add(slot);
    group.add(screw);
    screws.push(screw);
  }
  return { group, screws };
}

/** The kit screwdriver: about 58 mm, clear handle, thin steel shaft. Pivot is at the tip. */
export function makeScrewdriver(): THREE.Group {
  const g = new THREE.Group();
  const steel = std('#b8bcc0', 0.3, 0.9);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 28, 12), steel);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 14;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 14), steel);
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.x = 30;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(4.4, 4.4, 32, 18),
    new THREE.MeshStandardMaterial({ color: '#e4edf5', roughness: 0.15, transparent: true, opacity: 0.8 }),
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.x = 46;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 10), steel);
  core.rotation.z = Math.PI / 2;
  core.position.x = 46;
  const tip = box(0.45, 3, 0.45, std('#9a9ea3', 0.3, 0.9));
  tip.position.x = 0;
  for (const m of [shaft, ferrule, handle, core, tip]) { m.castShadow = true; g.add(m); }
  return g;
}

/** The kit's black cable tie, closed into a small loop with its tail. */
export function makeCableTie(): THREE.Group {
  const g = new THREE.Group();
  const mat = std('#141516', 0.55);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(11, 0.8, 6, 32), mat);
  ring.rotation.x = Math.PI / 2;
  ring.scale.z = 2.2;
  ring.position.y = 1.8;
  ring.castShadow = true;
  const head = box(6, 3.6, 5, mat);
  head.position.set(11, 1.8, 0);
  const tail = box(24, 0.6, 2.4, mat);
  tail.position.set(24, 1.2, 0);
  g.add(ring, head, tail);
  return g;
}

export function makePowerBrick(): THREE.Group {
  const g = new THREE.Group();
  const body = box(34, 20, 34, std('#e9ebea', 0.5));
  body.position.y = 10;
  const port = box(1, 5.5, 13, std('#1a1b1c', 0.5));
  port.position.set(-17, 10, 0);
  g.add(body, port);
  return g;
}

/** Black JST-SM style housing. With `pigtail`, three short wires run along local +x (toward the strip). */
export function makeConnector(pigtail = false): THREE.Group {
  const g = new THREE.Group();
  const housing = box(12, 5.5, 7, std('#141516', 0.55));
  const lip = box(2, 6.6, 8, std('#141516', 0.55));
  lip.position.x = -6.5;
  g.add(housing, lip);
  if (pigtail) {
    (['red', 'green', 'white'] as const).forEach((c, i) => {
      const w = box(PIGTAIL, 1.3, 1.3, std(COLORS.wire[c], 0.5));
      w.position.set(6 + PIGTAIL / 2, 0, (i - 1) * 1.9);
      g.add(w);
    });
  }
  return g;
}

/** Length of the strip's pigtail between the strip end and its connector, mm. */
export const PIGTAIL = 18;

export function makePlug(kind: 'c' | 'a'): THREE.Group {
  const g = new THREE.Group();
  const metal = std('#c6c9cc', 0.3, 0.9);
  const mold = std('#17181a', 0.5);
  if (kind === 'c') {
    const shell = box(9, 3.2, 7, metal);
    shell.position.x = -2;
    const over = box(14, 6.4, 9, mold);
    over.position.x = 7;
    g.add(shell, over);
  } else {
    const shell = box(12, 4.6, 12, metal);
    shell.position.x = 5;
    const over = box(16, 8, 15, mold);
    over.position.x = -9;
    g.add(shell, over);
  }
  return g;
}

/** Small open scrap bin for the strip trimmings. */
export function makeBin(): THREE.Group {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(25, 21, 30, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: '#3a403c', roughness: 0.6, side: THREE.DoubleSide }),
  );
  wall.position.y = 15;
  wall.castShadow = true;
  wall.receiveShadow = true;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(21, 28), std('#1b1f1c', 0.7));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.6;
  g.add(wall, floor);
  return g;
}

const PURPLE = '#583af7';

/** The lid: brand purple, the Universe '26 lockup (asset generator art) and the event name, all centred. */
function lidTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d')!;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = (lockup?: HTMLImageElement) => {
    g.fillStyle = PURPLE;
    g.fillRect(0, 0, 2048, 2048);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 8;
    g.strokeRect(150, 150, 1748, 1748);
    if (lockup) {
      const w = 1180;
      const h = (lockup.height / lockup.width) * w;
      g.drawImage(lockup, (2048 - w) / 2, 800 - h / 2, w, h);
    }
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 168px "Mona Sans", system-ui, sans-serif`;
    g.fillText("GitHub Universe '26", 1024, 1330);
    texture.needsUpdate = true;
  };
  paint();
  const img = new Image();
  img.onload = () => document.fonts.load('700 168px "Mona Sans"').finally(() => paint(img));
  img.src = './images/universe-lockup.webp';
  return texture;
}

/** The Universe box: brand purple, the GitHub Universe '26 lockup on the lid. `lid` hinges on the back edge; rotation.x 0 is closed. */
export function makeBox(): { group: THREE.Group; lid: THREE.Group } {
  const { size, height } = BOX;
  const wallT = 5;
  const shell = std('#4a2fd0', 0.55);
  const group = new THREE.Group();
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = box(w, h, d, m);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  part(size, 3, size, 0, 1.5, 0, std('#3a24a8', 0.7));
  part(size, height, wallT, 0, height / 2, -(size - wallT) / 2, shell);
  part(size, height, wallT, 0, height / 2, (size - wallT) / 2, shell);
  part(wallT, height, size - 2 * wallT, -(size - wallT) / 2, height / 2, 0, shell);
  part(wallT, height, size - 2 * wallT, (size - wallT) / 2, height / 2, 0, shell);
  part(size - 2 * wallT, 1.2, 8, 0, height - 0.6, (size - wallT) / 2 - 2, std('#c9a50a', 0.5));

  const lid = new THREE.Group();
  lid.position.set(0, height, -size / 2);
  const top = new THREE.MeshStandardMaterial({ map: lidTexture(), roughness: 0.5 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(size, 4, size), [shell, shell, top, shell, shell, shell]);
  slab.position.set(0, 2, size / 2);
  slab.castShadow = true;
  slab.receiveShadow = true;
  lid.add(slab);
  group.add(lid);
  return { group, lid };
}
