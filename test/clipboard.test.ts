import { expect, test } from 'vitest';
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
