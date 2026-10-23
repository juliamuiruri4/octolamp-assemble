import ledPath from './ledPath.json' with { type: 'json' };

/** Single source of truth for the kit, the strip route and the assembly order. Positions are mm on the desk. */

export type PartId =
  | 'base' | 'cover' | 'inner' | 'reflector' | 'screwdriver'
  | 'board' | 'usb' | 'ledcable' | 'strip' | 'tie';

export interface PartSpec {
  id: PartId;
  /** Short name used in labels. */
  name: string;
  kind: 'printed' | 'electronic' | 'consumable' | 'tool';
  /** Runtime model in public/models, when one exists. The rest are drawn procedurally. */
  glb?: string;
}

/** Same order and count as "What is Included" in UNIVERSE_ASSEMBLY.md. */
export const PARTS: readonly PartSpec[] = [
  { id: 'base', name: 'base', kind: 'printed', glb: 'base' },
  { id: 'cover', name: 'cover', kind: 'printed', glb: 'cover' },
  { id: 'inner', name: 'LED holder', kind: 'printed', glb: 'inner' },
  { id: 'reflector', name: 'reflector', kind: 'printed', glb: 'reflector' },
  { id: 'screwdriver', name: 'screwdriver', kind: 'tool' },
  { id: 'board', name: 'board', kind: 'electronic', glb: 'sparkle-motion-mini' },
  { id: 'usb', name: 'USB cable', kind: 'electronic' },
  { id: 'ledcable', name: 'LED cable', kind: 'electronic' },
  { id: 'strip', name: 'LED strip', kind: 'consumable' },
  { id: 'tie', name: 'cable tie', kind: 'consumable' },
];
export const KIT_COUNT = PARTS.length;

/** Where each part lies on the desk during layout (x right, z towards the viewer). */
export const REST: Record<PartId, { x: number; z: number; rot: number }> = {
  base: { x: -235, z: -40, rot: 0 },
  inner: { x: 0, z: -40, rot: 180 },
  reflector: { x: 235, z: -40, rot: 0 },
  screwdriver: { x: -300, z: 145, rot: 0 },
  cover: { x: -200, z: 225, rot: 0 },
  board: { x: -120, z: 175, rot: 0 },
  ledcable: { x: -30, z: 285, rot: 0 },
  usb: { x: 60, z: 290, rot: 0 },
  strip: { x: 170, z: 170, rot: 0 },
  tie: { x: -300, z: 250, rot: 20 },
};

/** The scrap bin for strip trimmings (tidy step) and the Universe box the lamp is packed in. */
export const BIN = { x: 330, z: 232 };
export const BOX = { x: -250, z: -40, size: 250, height: 46 };

/** Radius of the desk area each part occupies while laid out, so the kit never overlaps itself. */
export const FOOTPRINT: Record<PartId, number> = {
  base: 106, inner: 103, reflector: 101, screwdriver: 34, cover: 22, board: 22, usb: 36, ledcable: 12, strip: 46, tie: 28,
};

/** The board's screw terminals, left to right with the USB-C port at the top. The kit uses the 1st, 3rd and 4th. */
export const TERMINAL_COUNT = 4;
export const WIRES = [
  { terminal: 0, color: 'red' },
  { terminal: 2, color: 'green' },
  { terminal: 3, color: 'white' },
] as const;
export const WIRE_COUNT = WIRES.length;

/** Strip route in the LED holder's STL frame (mm, Z up). Each LED is [x, y, tangentX, tangentY, normalX, normalY]. */
export type LedPoint = readonly [number, number, number, number, number, number];
export const LED_OUTER: readonly LedPoint[] = ledPath.outer as unknown as LedPoint[];
export const LED_INNER: readonly LedPoint[] = ledPath.inner as unknown as LedPoint[];
export const OUTER_COUNT = LED_OUTER.length;
export const INNER_COUNT = LED_INNER.length;
/** Measured from the printed channel; the upstream guide says "about 100" (99 to 105 depending on sticking). */
export const LED_COUNT = OUTER_COUNT + INNER_COUNT;
export const LED_PITCH = ledPath.pitch;
/** Height of the strip's centre in the LED holder's own frame (STL Z). */
export const STRIP_CENTRE_Z = ledPath.sliceZ;
/** Extra strip that is cut off and thrown away. */
const SPARE_LEDS = 20;
export const STRIP_LEDS = LED_COUNT + SPARE_LEDS;
/** LEDs pressed down per click. */
export const STICK_CHUNK = 10;

/** Step 5 of the guide, one action per numbered line. */
export const ASSEMBLY = [
  { id: 'reflector', label: 'Thread wires' },
  { id: 'board', label: 'Flip, seat board' },
  { id: 'usb', label: 'Feed USB' },
  { id: 'cover', label: 'Snap cover' },
  { id: 'press', label: 'Press together' },
] as const;
export const ASSEMBLY_COUNT = ASSEMBLY.length;
