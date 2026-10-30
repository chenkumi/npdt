import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClipboard } from '../src/platform/clipboard.js';

// Exercises the real system clipboard on Windows/macOS (where a tool always exists); skipped elsewhere.
const hasNative = process.platform === 'win32' || process.platform === 'darwin';

test.skipIf(!hasNative)('round-trips unicode and newlines through the system clipboard', async () => {
  const osc: string[] = [];
  const clip = createClipboard((d) => osc.push(d));
  const text = '中文 emoji 😀\nsecond line\ttab';
  await clip.write(text);
  expect(osc).toEqual([]);
  expect(await clip.read()).toBe(text);
}, 20_000);

test('falls back to OSC 52 when no tool works', async () => {
  const osc: string[] = [];
  const saved = { path: process.env.PATH, display: process.env.DISPLAY, wayland: process.env.WAYLAND_DISPLAY };
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  delete process.env.WSL_DISTRO_NAME;
  try {
    const clip = createClipboard((d) => osc.push(d));
    await clip.write('hi');
    expect(osc[0]).toBe(`\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07`);
    expect(await clip.read()).toBe('hi');
  } finally {
    Object.defineProperty(process, 'platform', platform);
    process.env.PATH = saved.path;
    if (saved.display) process.env.DISPLAY = saved.display;
    if (saved.wayland) process.env.WAYLAND_DISPLAY = saved.wayland;
  }
});

// Linux tools are faked with shell scripts on PATH so the xclip / wl-copy code paths run without a display server.
describe.skipIf(process.platform === 'win32')('linux clipboard tools', () => {
  const KEYS = ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'WSL_DISTRO_NAME', 'FAKE_CLIP_FILE'] as const;
  let saved: Partial<Record<(typeof KEYS)[number], string | undefined>>;
  let platform: PropertyDescriptor;
  let dir: string;

  beforeEach(async () => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    dir = await mkdtemp(path.join(os.tmpdir(), 'npdt-clip-'));
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
    process.env.FAKE_CLIP_FILE = path.join(dir, 'clipboard');
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.WSL_DISTRO_NAME;
    process.env.DISPLAY = ':99';
  });

  afterEach(async () => {
    Object.defineProperty(process, 'platform', platform);
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  const fake = (name: string, script: string) => writeFile(path.join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const STORE = 'case "$*" in *-out*|*--output*) cat "$FAKE_CLIP_FILE";; *) cat > "$FAKE_CLIP_FILE";; esac';

  test('round-trips through xclip without using OSC 52', async () => {
    await fake('xclip', STORE);
    const osc: string[] = [];
    const clip = createClipboard((d) => osc.push(d));
    const text = '中文 emoji 😀\nsecond line\r\nthird';
    await clip.write(text);
    expect(osc).toEqual([]);
    expect(await readFile(process.env.FAKE_CLIP_FILE!, 'utf8')).toBe(text);
    expect(await clip.read()).toBe(text);
  });

  test('falls through to xsel when xclip is missing', async () => {
    await fake('xsel', STORE);
    const osc: string[] = [];
    const clip = createClipboard((d) => osc.push(d));
    await clip.write('via xsel');
    expect(osc).toEqual([]);
    expect(await clip.read()).toBe('via xsel');
  });

  test('prefers wl-copy / wl-paste on Wayland and passes --no-newline', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-99';
    await fake('wl-copy', 'cat > "$FAKE_CLIP_FILE"');
    await fake('wl-paste', '[ "$1" = "--no-newline" ] && cat "$FAKE_CLIP_FILE" || exit 1');
    const osc: string[] = [];
    const clip = createClipboard((d) => osc.push(d));
    await clip.write('wayland text\n');
    expect(osc).toEqual([]);
    expect(await clip.read()).toBe('wayland text\n');
  });

  test('does not strip a trailing newline from reads outside Windows/WSL', async () => {
    await fake('xclip', STORE);
    const clip = createClipboard(() => {});
    await clip.write('line\n');
    expect(await clip.read()).toBe('line\n');
  });

  test('uses OSC 52 when the tool exits non-zero', async () => {
    await fake('xclip', 'exit 1');
    const osc: string[] = [];
    const clip = createClipboard((d) => osc.push(d));
    await clip.write('hi');
    expect(osc).toEqual([`\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07`]);
    expect(await clip.read()).toBe('hi');
  });

  test('write returns promptly when the tool leaves a background process holding stdout (xclip daemon)', async () => {
    await fake('xclip', `${STORE}\n(sleep 30 &) `);
    const osc: string[] = [];
    const clip = createClipboard((d) => osc.push(d));
    const t0 = Date.now();
    await clip.write('daemon');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(osc).toEqual([]);
  }, 10_000);
});
