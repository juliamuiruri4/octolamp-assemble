import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY, FOOTPRINT, INNER_COUNT, KIT_COUNT, LED_COUNT, LED_INNER, LED_OUTER, LED_PITCH, OUTER_COUNT, PARTS, REST, TERMINAL_COUNT, WIRES,
} from './layout';

describe('layout', () => {
  it('lists the ten kit parts from the guide', () => {
    expect(PARTS.map((p) => p.id)).toEqual(['base', 'cover', 'inner', 'reflector', 'screwdriver', 'board', 'usb', 'ledcable', 'strip', 'tie']);
    expect(KIT_COUNT).toBe(10);
  });

  it('gives every part a unique id, a desk position and (when it has one) a model file', () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    for (const p of PARTS) {
      expect(REST[p.id]).toBeDefined();
      if (p.glb) expect(existsSync(`public/models/${p.glb}.glb`)).toBe(true);
    }
  });

  it('lays the kit out without parts overlapping, screwdriver included', () => {
    const solid = PARTS.filter((p) => p.id !== 'ledcable');
    for (const [i, a] of solid.entries()) {
      for (const b of solid.slice(i + 1)) {
        const gap = Math.hypot(REST[a.id].x - REST[b.id].x, REST[a.id].z - REST[b.id].z) - FOOTPRINT[a.id] - FOOTPRINT[b.id];
        expect(gap, `${a.id} and ${b.id}`).toBeGreaterThan(8);
      }
    }
  });

  it('uses the terminals the guide names: first, third and fourth, red green white', () => {
    expect(WIRES.map((w) => w.terminal)).toEqual([0, 2, 3]);
    expect(WIRES.map((w) => w.color)).toEqual(['red', 'green', 'white']);
    expect(WIRES.every((w) => w.terminal < TERMINAL_COUNT)).toBe(true);
  });

  it('keeps the strip route inside the printed part, spaced at the 60 LEDs per metre pitch', () => {
    expect(LED_COUNT).toBe(OUTER_COUNT + INNER_COUNT);
    expect(LED_COUNT).toBeGreaterThan(85);
    expect(LED_COUNT).toBeLessThan(110);
    expect(LED_PITCH).toBeCloseTo(1000 / 60, 1);
    for (const [x, y, tx, ty, nx, ny] of [...LED_OUTER, ...LED_INNER]) {
      expect(Math.hypot(x, y)).toBeLessThan(100);
      expect(Math.hypot(tx, ty)).toBeCloseTo(1, 1);
      expect(Math.hypot(nx, ny)).toBeCloseTo(1, 1);
      expect(tx * nx + ty * ny).toBeCloseTo(0, 1);
    }
  });

  it('puts the reflector first in the final assembly and pressing together last', () => {
    expect(ASSEMBLY[0].id).toBe('reflector');
    expect(ASSEMBLY[ASSEMBLY.length - 1].id).toBe('press');
  });
});
