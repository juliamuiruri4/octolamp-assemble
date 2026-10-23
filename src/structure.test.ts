import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

describe('three.js stays out of the first load', () => {
  it('only imports scene files dynamically or as types, outside src/scene', () => {
    const offenders = files('src')
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith('src/scene/') && !f.endsWith('.test.ts'))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n')
        .filter((l) => /from ['"]\.\/scene\/|from ['"]three/.test(l) && !/^\s*import type /.test(l))
        .map((l) => `${f}: ${l.trim()}`));
    expect(offenders).toEqual([]);
  });

  it('builds a small entry chunk with three.js in a separate chunk', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const result = await build({ logLevel: 'silent', mode: 'production', build: { write: false } }).finally(() => { process.env.NODE_ENV = env; });
    const output = (Array.isArray(result) ? result[0] : result) as { output: Array<{ type: string; isEntry?: boolean; code?: string; fileName: string }> };
    const chunks = output.output.filter((o) => o.type === 'chunk');
    const entry = chunks.find((c) => c.isEntry)!;
    const scene = chunks.find((c) => c.code!.includes('WebGLRenderer'))!;
    expect(scene).not.toBe(entry);
    expect(entry.code).not.toContain('WebGLRenderer');
    expect(entry.code!.length).toBeLessThan(260_000);
  }, 60_000);
});
