import {
  ASSEMBLY, ASSEMBLY_COUNT, INNER_COUNT, KIT_COUNT, OUTER_COUNT, PARTS, STICK_CHUNK, WIRES, WIRE_COUNT,
} from './layout';

export const VIDEO_ID = 'Ya8gMkDxdD4';
export const STORAGE_KEY = 'octolamp-assemble:v1';

export interface BuildState {
  /** Kit parts taken out so far, in PARTS order. */
  laidOut: number;
  /** Terminals loosened, wires inserted and terminals tightened, left to right. */
  loosened: number;
  wired: number;
  tightened: number;
  /** Guide step 2: uncoil the strip, connect the LED cable, plug in USB. */
  uncoiled: boolean;
  connected: boolean;
  powered: boolean;
  /** LEDs stuck on the outer ring and on the inner ring and Mona. */
  outer: number;
  inner: number;
  trimmed: boolean;
  /** Guide step 4: USB plugged in after trimming, LEDs bright green. */
  stripPowered: boolean;
  /** Final assembly steps done, in ASSEMBLY order. */
  assembled: number;
  finalPowered: boolean;
  tidied: boolean;
  packed: boolean;
}

export const initialState: BuildState = {
  laidOut: 0, loosened: 0, wired: 0, tightened: 0, uncoiled: false, connected: false, powered: false,
  outer: 0, inner: 0, trimmed: false, stripPowered: false, assembled: 0, finalPowered: false, tidied: false, packed: false,
};

/** One entry per step of UNIVERSE_ASSEMBLY.md, plus unpacking the kit it lists. */
export const steps: readonly { name: string }[] = [
  { name: 'Kit' }, { name: 'Wire' }, { name: 'Test' }, { name: 'Outer ring' },
  { name: 'Inner ring' }, { name: 'Assemble' }, { name: 'Final test' }, { name: 'Clean up' },
];
export const DONE = steps.length;

/** Derived, never stored. `DONE` (past the last step) means the build is finished. */
export function currentStep(s: BuildState): number {
  if (s.laidOut < KIT_COUNT) return 0;
  if (s.tightened < WIRE_COUNT) return 1;
  if (!s.powered) return 2;
  if (s.outer < OUTER_COUNT) return 3;
  if (s.inner < INNER_COUNT || !s.trimmed || !s.stripPowered) return 4;
  if (s.assembled < ASSEMBLY_COUNT) return 5;
  if (!s.finalPowered) return 6;
  if (!s.tidied || !s.packed) return 7;
  return DONE;
}

export function instruction(s: BuildState): string {
  switch (currentStep(s)) {
    case 0: return 'Unpack the kit.';
    case 1: return 'Red, green, white into 1, 3, 4.';
    case 2: return 'Test the LEDs.';
    case 3: return 'Strip along the outer ring.';
    case 4:
      if (s.inner < INNER_COUNT) return 'Strip around the inner ring and Mona.';
      return s.trimmed ? 'Check it glows green.' : 'Cut off the excess.';
    case 5: return 'Assemble the lamp.';
    case 6: return 'Final test.';
    default: return s.tidied ? 'Pack the lamp.' : 'Tidy the desk.';
  }
}

export type BuildAction =
  | { type: 'layOut' | 'loosen' | 'insert' | 'tighten' | 'uncoil' | 'connect' | 'power' | 'stick' | 'trim' | 'powerStrip' | 'assemble' | 'finalPower' | 'tidy' | 'pack' | 'fill' };

export interface PrimaryAction { label: string; action: BuildAction }

export function primaryAction(s: BuildState): PrimaryAction | null {
  switch (currentStep(s)) {
    case 0: return { label: `Unpack ${PARTS[s.laidOut].name}`, action: { type: 'layOut' } };
    case 1:
      if (s.loosened < WIRE_COUNT) return { label: 'Loosen terminal', action: { type: 'loosen' } };
      if (s.wired < WIRE_COUNT) return { label: 'Insert wire', action: { type: 'insert' } };
      return { label: 'Tighten terminal', action: { type: 'tighten' } };
    case 2:
      if (!s.uncoiled) return { label: 'Uncoil strip', action: { type: 'uncoil' } };
      if (!s.connected) return { label: 'Connect strip', action: { type: 'connect' } };
      return { label: 'Plug in USB', action: { type: 'power' } };
    case 3: return { label: 'Stick strip', action: { type: 'stick' } };
    case 4:
      if (s.inner < INNER_COUNT) return { label: 'Stick strip', action: { type: 'stick' } };
      return s.trimmed
        ? { label: 'Plug in USB', action: { type: 'powerStrip' } }
        : { label: 'Trim strip', action: { type: 'trim' } };
    case 5: return { label: ASSEMBLY[s.assembled].label, action: { type: 'assemble' } };
    case 6: return { label: 'Plug in USB', action: { type: 'finalPower' } };
    case 7: return s.tidied
      ? { label: 'Pack lamp', action: { type: 'pack' } }
      : { label: 'Tidy up', action: { type: 'tidy' } };
    default: return null;
  }
}

/** "Do all" finishes the current step. Not offered where the step is a single action. */
export function secondaryAction(s: BuildState): PrimaryAction | null {
  const step = currentStep(s);
  return step === 6 || step === DONE ? null : { label: 'Do all', action: { type: 'fill' } };
}

/** The two warnings the guide gives. */
export function note(s: BuildState): string {
  if (currentStep(s) !== 2) return '';
  if (!s.uncoiled) return 'Never power a coiled strip.';
  if (!s.connected) return 'Arrows point away from the connector.';
  return '';
}

export function progressCount(s: BuildState): { done: number; total: number; noun: string } | null {
  switch (currentStep(s)) {
    case 0: return { done: s.laidOut, total: KIT_COUNT, noun: 'parts' };
    case 1: {
      const done = s.loosened < WIRE_COUNT ? s.loosened : s.wired < WIRE_COUNT ? s.wired : s.tightened;
      return { done, total: WIRE_COUNT, noun: s.loosened < WIRE_COUNT ? 'loosened' : s.wired < WIRE_COUNT ? 'wires' : 'tightened' };
    }
    case 3: return { done: s.outer, total: OUTER_COUNT, noun: 'LEDs' };
    case 4: return s.inner < INNER_COUNT ? { done: s.inner, total: INNER_COUNT, noun: 'LEDs' } : null;
    case 5: return { done: s.assembled, total: ASSEMBLY_COUNT, noun: 'steps' };
    default: return null;
  }
}

/**
 * The LEDs stay on after each power-up until the next action, so the glow can be seen:
 * the guide's two strip tests, then the final test until tidying starts.
 */
export function ledsLit(s: BuildState): boolean {
  return (s.powered && s.outer === 0) || (s.stripPowered && s.assembled === 0) || (s.finalPowered && !s.tidied);
}

/** Which end of the USB cable is plugged in: the board (always from step 5, item 3) and the power supply. */
export function usbPlugs(s: BuildState): { board: boolean; supply: boolean } {
  const test = (s.powered && s.outer === 0) || (s.stripPowered && s.assembled === 0);
  return { board: test || s.assembled >= 3, supply: test || (s.finalPowered && !s.tidied) };
}

/** Terminal the screwdriver works on, left to right; it stays through the last tighten until the strip is uncoiled. */
export function driverTerminal(s: BuildState): number | null {
  if (s.laidOut < KIT_COUNT || s.uncoiled) return null;
  if (s.wired === 0 && s.loosened > 0) return WIRES[s.loosened - 1].terminal;
  if (s.tightened > 0) return WIRES[s.tightened - 1].terminal;
  return null;
}

export function buildReducer(s: BuildState, a: BuildAction): BuildState {
  const step = currentStep(s);
  switch (a.type) {
    case 'layOut': return step === 0 ? { ...s, laidOut: s.laidOut + 1 } : s;
    case 'loosen': return step === 1 && s.loosened < WIRE_COUNT ? { ...s, loosened: s.loosened + 1 } : s;
    case 'insert': return step === 1 && s.loosened === WIRE_COUNT && s.wired < WIRE_COUNT ? { ...s, wired: s.wired + 1 } : s;
    case 'tighten': return step === 1 && s.wired === WIRE_COUNT && s.tightened < WIRE_COUNT ? { ...s, tightened: s.tightened + 1 } : s;
    case 'uncoil': return step === 2 && !s.uncoiled ? { ...s, uncoiled: true } : s;
    case 'connect': return step === 2 && s.uncoiled && !s.connected ? { ...s, connected: true } : s;
    case 'power': return step === 2 && s.connected ? { ...s, powered: true } : s;
    case 'stick':
      if (step === 3) return { ...s, outer: Math.min(OUTER_COUNT, s.outer + STICK_CHUNK) };
      if (step === 4 && s.inner < INNER_COUNT) return { ...s, inner: Math.min(INNER_COUNT, s.inner + STICK_CHUNK) };
      return s;
    case 'trim': return step === 4 && s.inner === INNER_COUNT && !s.trimmed ? { ...s, trimmed: true } : s;
    case 'powerStrip': return step === 4 && s.trimmed ? { ...s, stripPowered: true } : s;
    case 'assemble': return step === 5 ? { ...s, assembled: s.assembled + 1 } : s;
    case 'finalPower': return step === 6 ? { ...s, finalPowered: true } : s;
    case 'tidy': return step === 7 && !s.tidied ? { ...s, tidied: true } : s;
    case 'pack': return step === 7 && s.tidied ? { ...s, packed: true } : s;
    case 'fill':
      switch (step) {
        case 0: return { ...s, laidOut: KIT_COUNT };
        case 1: return { ...s, loosened: WIRE_COUNT, wired: WIRE_COUNT, tightened: WIRE_COUNT };
        case 2: return { ...s, uncoiled: true, connected: true, powered: true };
        case 3: return { ...s, outer: OUTER_COUNT };
        case 4: return { ...s, inner: INNER_COUNT, trimmed: true, stripPowered: true };
        case 5: return { ...s, assembled: ASSEMBLY_COUNT };
        case 7: return { ...s, tidied: true, packed: true };
        default: return s;
      }
  }
}

const count = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Validates a saved build, including that steps were done in order. Throws a readable error. */
export function parseBuild(raw: string): BuildState {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved build is not an object.');
  const b = value as Record<string, unknown>;
  const flags = ['uncoiled', 'connected', 'powered', 'trimmed', 'stripPowered', 'finalPowered', 'tidied', 'packed'] as const;
  if (!flags.every((k) => typeof b[k] === 'boolean')) throw new Error('Saved build contains an invalid setting.');
  if (!count(b.laidOut, KIT_COUNT) || !count(b.loosened, WIRE_COUNT) || !count(b.wired, WIRE_COUNT) ||
      !count(b.tightened, WIRE_COUNT) || !count(b.outer, OUTER_COUNT) || !count(b.inner, INNER_COUNT) ||
      !count(b.assembled, ASSEMBLY_COUNT)) throw new Error('Saved build contains an invalid count.');
  const s = b as unknown as BuildState;
  const wiring = s.loosened > 0 || s.wired > 0 || s.tightened > 0;
  const ordered =
    (s.laidOut === KIT_COUNT || (!wiring && !s.uncoiled)) &&
    (s.wired === 0 || s.loosened === WIRE_COUNT) &&
    (s.tightened === 0 || s.wired === WIRE_COUNT) &&
    (!s.uncoiled || s.tightened === WIRE_COUNT) &&
    (!s.connected || s.uncoiled) &&
    (!s.powered || s.connected) &&
    (s.outer === 0 || s.powered) &&
    (s.inner === 0 || s.outer === OUTER_COUNT) &&
    (!s.trimmed || s.inner === INNER_COUNT) &&
    (!s.stripPowered || s.trimmed) &&
    (s.assembled === 0 || s.stripPowered) &&
    (!s.finalPowered || s.assembled === ASSEMBLY_COUNT) &&
    (!s.tidied || s.finalPowered) &&
    (!s.packed || s.tidied);
  if (!ordered) throw new Error('Saved build has steps done out of order.');
  return {
    laidOut: s.laidOut, loosened: s.loosened, wired: s.wired, tightened: s.tightened,
    uncoiled: s.uncoiled, connected: s.connected, powered: s.powered, outer: s.outer, inner: s.inner,
    trimmed: s.trimmed, stripPowered: s.stripPowered, assembled: s.assembled, finalPowered: s.finalPowered,
    tidied: s.tidied, packed: s.packed,
  };
}

export interface RestoredBuild { state: BuildState; notice: string; blocked: boolean }

/** Restores the saved build. Never throws; a corrupt save is explained and kept until Start over. */
export function restoreBuild(read: (key: string) => string | null): RestoredBuild {
  try {
    const saved = read(STORAGE_KEY);
    return { state: saved ? parseBuild(saved) : initialState, notice: '', blocked: false };
  } catch (error) {
    console.error('Could not restore the Octolamp build:', error);
    return { state: initialState, notice: 'Your saved build could not be restored. Start over to replace it.', blocked: true };
  }
}
