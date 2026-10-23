import { describe, expect, it } from 'vitest';
import {
  buildReducer, currentStep, DONE, driverTerminal, initialState, instruction, ledsLit, note, parseBuild, primaryAction,
  progressCount, restoreBuild, secondaryAction, steps, STORAGE_KEY, usbPlugs, type BuildAction, type BuildState,
} from './build';
import { ASSEMBLY, ASSEMBLY_COUNT, INNER_COUNT, KIT_COUNT, OUTER_COUNT, STICK_CHUNK, WIRE_COUNT } from './layout';

const run = (s: BuildState, ...types: BuildAction['type'][]) => types.reduce((a, type) => buildReducer(a, { type }), s);
const advance = (s: BuildState): BuildState => {
  const primary = primaryAction(s);
  return primary ? buildReducer(s, primary.action) : s;
};
const fillStep = (s: BuildState) => buildReducer(s, { type: 'fill' });
/** Every primary label, in order, from a fresh build to the finished one. */
const walk = () => {
  const trail: Array<{ step: number; label: string; state: BuildState }> = [];
  let s = initialState;
  for (let i = 0; i < 400 && currentStep(s) !== DONE; i++) {
    trail.push({ step: currentStep(s), label: primaryAction(s)!.label, state: s });
    s = advance(s);
  }
  return { trail, end: s };
};
const finished = () => walk().end;

describe('steps follow UNIVERSE_ASSEMBLY.md', () => {
  it('has the same steps, in the same order, as the guide', () => {
    // Step titles of UNIVERSE_ASSEMBLY.md, after the unpacking step.
    const guideSteps = ['Wire', 'Test', 'Outer ring', 'Inner ring', 'Assemble', 'Final test', 'Clean up'];
    expect(steps.slice(1).map((s) => s.name)).toEqual(guideSteps);
    expect(steps.map((s) => s.name)).toEqual(['Kit', 'Wire', 'Test', 'Outer ring', 'Inner ring', 'Assemble', 'Final test', 'Clean up']);
  });

  it('does every action of the guide in order, with no extra ones', () => {
    const labels = walk().trail.map((t) => t.label);
    const compact = labels.filter((l, i) => l !== labels[i - 1] || !/^(Loosen|Insert|Tighten|Unpack|Stick)/.test(l));
    expect(compact.filter((l) => !l.startsWith('Unpack'))).toEqual([
      'Loosen terminal', 'Insert wire', 'Tighten terminal',
      'Uncoil strip', 'Connect strip', 'Plug in USB',
      'Stick strip', 'Trim strip', 'Plug in USB',
      'Thread wires', 'Flip, seat board', 'Feed USB', 'Snap cover', 'Press together',
      'Plug in USB',
      'Tidy up', 'Pack lamp',
    ]);
    expect(labels.filter((l) => l === 'Plug in USB')).toHaveLength(3);
  });

  it('keeps the reflector out of the build until final assembly, after the strip is powered', () => {
    const { trail } = walk();
    const first = trail.find((t) => t.label === 'Thread wires')!;
    expect(first.step).toBe(5);
    expect(first.state.stripPowered).toBe(true);
    expect(first.state.trimmed).toBe(true);
    expect(first.state.assembled).toBe(0);
    expect(ASSEMBLY.map((a) => a.id)).toEqual(['reflector', 'board', 'usb', 'cover', 'press']);
  });

  it('powers the strip and checks it glows before any assembly (guide step 4, items 4 and 5)', () => {
    let s = initialState;
    while (currentStep(s) < 4) s = advance(s);
    while (s.inner < INNER_COUNT) s = advance(s);
    expect(instruction(s)).toBe('Cut off the excess.');
    s = run(s, 'trim');
    expect(currentStep(s)).toBe(4);
    expect(instruction(s)).toBe('Check it glows green.');
    expect(primaryAction(s)?.label).toBe('Plug in USB');
    expect(ledsLit(s)).toBe(false);
    s = run(s, 'powerStrip');
    expect(currentStep(s)).toBe(5);
    expect(ledsLit(s)).toBe(true);
    s = run(s, 'assemble');
    expect(ledsLit(s)).toBe(false);
  });

  it('has the clean-up lines: tidy the desk, then pack the lamp in the Universe box', () => {
    let s = finished();
    expect(s.packed && s.tidied).toBe(true);
    s = initialState;
    while (currentStep(s) < 7) s = advance(s);
    expect(instruction(s)).toBe('Tidy the desk.');
    expect(buildReducer(s, { type: 'pack' })).toBe(s);
    s = run(s, 'tidy');
    expect(currentStep(s)).toBe(7);
    expect(instruction(s)).toBe('Pack the lamp.');
    s = run(s, 'pack');
    expect(currentStep(s)).toBe(DONE);
  });
});

describe('reducer', () => {
  it('walks every step with only the primary action and finishes', () => {
    const { trail, end } = walk();
    expect([...new Set(trail.map((t) => t.step))]).toEqual(Array.from({ length: steps.length }, (_, i) => i));
    expect(currentStep(end)).toBe(DONE);
    expect(primaryAction(end)).toBeNull();
  });

  it('ignores actions that are out of order and returns the same state', () => {
    for (const type of ['loosen', 'insert', 'tighten', 'uncoil', 'connect', 'power', 'stick', 'trim', 'powerStrip', 'assemble', 'finalPower', 'tidy', 'pack'] as const) {
      expect(buildReducer(initialState, { type })).toBe(initialState);
    }
    const wiring = fillStep(fillStep(initialState));
    expect(buildReducer(wiring, { type: 'layOut' })).toBe(wiring);
    expect(run(fillStep(initialState), 'insert')).toEqual(fillStep(initialState));
    expect(run(fillStep(initialState), 'loosen', 'tighten').tightened).toBe(0);
  });

  it('lays out one part per action', () => {
    const s = run(initialState, 'layOut', 'layOut');
    expect(s.laidOut).toBe(2);
    expect(primaryAction(s)?.label).toBe('Unpack LED holder');
  });

  it('needs loosen, then insert, then tighten for every wire', () => {
    let s = fillStep(initialState);
    expect(currentStep(s)).toBe(1);
    for (let i = 0; i < WIRE_COUNT; i++) s = run(s, 'loosen');
    for (let i = 0; i < WIRE_COUNT; i++) s = run(s, 'insert');
    for (let i = 0; i < WIRE_COUNT; i++) s = run(s, 'tighten');
    expect(currentStep(s)).toBe(2);
  });

  it('gates the test: uncoil, then connect, then power, with the two warnings', () => {
    let s = fillStep(fillStep(initialState));
    expect(note(s)).toBe('Never power a coiled strip.');
    expect(buildReducer(s, { type: 'connect' })).toBe(s);
    s = run(s, 'uncoil');
    expect(note(s)).toBe('Arrows point away from the connector.');
    expect(buildReducer(s, { type: 'power' })).toBe(s);
    s = run(s, 'connect');
    expect(note(s)).toBe('');
    expect(ledsLit(s)).toBe(false);
    s = run(s, 'power');
    expect(currentStep(s)).toBe(3);
    expect(ledsLit(s)).toBe(true);
    s = run(s, 'stick');
    expect(ledsLit(s)).toBe(false);
  });

  it('sticks the strip in chunks and caps at the segment length', () => {
    let s = fillStep(fillStep(fillStep(initialState)));
    expect(currentStep(s)).toBe(3);
    s = run(s, 'stick');
    expect(s.outer).toBe(STICK_CHUNK);
    for (let i = 0; i < 10; i++) s = run(s, 'stick');
    expect(s.outer).toBe(OUTER_COUNT);
    expect(currentStep(s)).toBe(4);
    for (let i = 0; i < 20; i++) s = run(s, 'stick');
    expect(s.inner).toBe(INNER_COUNT);
    expect(primaryAction(s)?.label).toBe('Trim strip');
  });

  it('lights the LEDs after each power-up only: first test, strip check, final test', () => {
    let s = initialState;
    const litAt: Array<[number, string]> = [];
    for (let i = 0; i < 400 && currentStep(s) !== DONE; i++) {
      if (ledsLit(s)) litAt.push([currentStep(s), primaryAction(s)!.label]);
      s = advance(s);
    }
    expect([...new Set(litAt.map(([step]) => step))]).toEqual([3, 5, 7]);
    expect(litAt.every(([, label]) => ['Stick strip', 'Thread wires', 'Tidy up'].includes(label))).toBe(true);
    expect(ledsLit(finished())).toBe(false);
  });

  it('"Do all" finishes the current step and is not offered at the final test or the end', () => {
    let s = initialState;
    for (const step of [0, 1, 2, 3, 4, 5]) {
      expect(currentStep(s)).toBe(step);
      expect(secondaryAction(s)).not.toBeNull();
      s = fillStep(s);
      expect(currentStep(s)).toBeGreaterThan(step);
    }
    expect(currentStep(s)).toBe(6);
    expect(secondaryAction(s)).toBeNull();
    s = run(s, 'finalPower');
    expect(secondaryAction(s)?.label).toBe('Do all');
    expect(currentStep(fillStep(s))).toBe(DONE);
    expect(secondaryAction(finished())).toBeNull();
  });

  it('reports progress only where a step has a count', () => {
    expect(progressCount(initialState)).toEqual({ done: 0, total: KIT_COUNT, noun: 'parts' });
    expect(progressCount(finished())).toBeNull();
  });
});

describe('screwdriver', () => {
  it('visits terminals 1, 3 and 4 for every loosen and every tighten, including the last white one', () => {
    let s = fillStep(initialState);
    const visits: Array<number | null> = [];
    for (const type of ['loosen', 'loosen', 'loosen', 'insert', 'insert', 'insert', 'tighten', 'tighten', 'tighten'] as const) {
      s = run(s, type);
      visits.push(driverTerminal(s));
    }
    expect(visits).toEqual([0, 2, 3, null, null, null, 0, 2, 3]);
  });

  it('stays on the white terminal after the last tighten, and leaves when the strip is uncoiled', () => {
    const s = fillStep(fillStep(initialState));
    expect(currentStep(fillStep(fillStep(initialState)))).toBe(2);
    expect(driverTerminal(s)).toBe(3);
    expect(driverTerminal(run(s, 'uncoil'))).toBeNull();
    expect(driverTerminal(initialState)).toBeNull();
    expect(driverTerminal(finished())).toBeNull();
  });
});

describe('USB cable', () => {
  it('is plugged into the board and the power supply for each test, only into the board during assembly', () => {
    const { trail, end } = walk();
    const at = (label: string, nth = 0) => usbPlugs(trail.filter((t) => t.label === label)[nth].state);
    expect(usbPlugs(initialState)).toEqual({ board: false, supply: false });
    expect(at('Stick strip', 0)).toEqual({ board: true, supply: true });
    expect(at('Thread wires')).toEqual({ board: true, supply: true });
    expect(at('Flip, seat board')).toEqual({ board: false, supply: false });
    expect(at('Snap cover')).toEqual({ board: true, supply: false });
    expect(at('Plug in USB', 2)).toEqual({ board: true, supply: false });
    expect(at('Tidy up')).toEqual({ board: true, supply: true });
    expect(at('Pack lamp')).toEqual({ board: true, supply: false });
    expect(usbPlugs(end)).toEqual({ board: true, supply: false });
  });
});

describe('persistence', () => {
  it('round-trips every state along the primary path', () => {
    for (const { state } of walk().trail) expect(parseBuild(JSON.stringify(state))).toEqual(state);
    expect(parseBuild(JSON.stringify(finished()))).toEqual(finished());
  });

  const wired = { laidOut: KIT_COUNT, loosened: 3, wired: 3, tightened: 3 };
  const tested = { ...wired, uncoiled: true, connected: true, powered: true };
  const stuck = { ...tested, outer: OUTER_COUNT, inner: INNER_COUNT, trimmed: true };
  const assembled = { ...stuck, stripPowered: true, assembled: ASSEMBLY_COUNT };
  const invalid: Array<[string, Partial<Record<keyof BuildState, unknown>>]> = [
    ['wrong type', { powered: 'yes' }],
    ['a missing flag', { packed: undefined }],
    ['negative count', { laidOut: -1 }],
    ['count too high', { outer: OUTER_COUNT + 1 }],
    ['fractional count', { laidOut: 1.5 }],
    ['wiring before the kit is out', { loosened: 1 }],
    ['wires before the terminals are loosened', { laidOut: KIT_COUNT, wired: 1 }],
    ['tightened before wired', { laidOut: KIT_COUNT, loosened: 3, tightened: 1 }],
    ['powered without connecting', { ...wired, uncoiled: true, powered: true }],
    ['sticking before the test', { ...wired, outer: 1 }],
    ['inner ring before the outer ring', { ...tested, inner: 1 }],
    ['trimmed early', { ...tested, trimmed: true }],
    ['strip powered before trimming', { ...tested, outer: OUTER_COUNT, inner: INNER_COUNT, stripPowered: true }],
    ['assembled before the strip check', { ...stuck, assembled: 1 }],
    ['final power early', { ...stuck, stripPowered: true, finalPowered: true }],
    ['tidied early', { ...assembled, tidied: true }],
    ['packed before tidying', { ...assembled, finalPowered: true, packed: true }],
  ];
  it.each(invalid)('rejects a save with %s', (_, patch) => {
    expect(() => parseBuild(JSON.stringify({ ...initialState, ...patch }))).toThrow();
  });

  it('rejects things that are not a build', () => {
    for (const raw of ['null', '[]', '3', '"x"', '{', '']) expect(() => parseBuild(raw)).toThrow();
  });

  it('restores a missing save as a fresh build', () => {
    expect(restoreBuild(() => null)).toEqual({ state: initialState, notice: '', blocked: false });
  });

  it('explains a corrupt save and blocks overwriting it', () => {
    const r = restoreBuild((key) => (key === STORAGE_KEY ? '{"laidOut":99}' : null));
    expect(r.state).toEqual(initialState);
    expect(r.blocked).toBe(true);
    expect(r.notice).toMatch(/could not be restored/);
  });

  it('never throws when storage itself fails', () => {
    expect(restoreBuild(() => { throw new Error('denied'); }).blocked).toBe(true);
  });
});
