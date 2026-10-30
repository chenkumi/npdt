import { expect, test } from 'vitest';
import { formatMode, formatOctal, parseOctal } from '../src/core/fs/permissions.js';

test('formatMode renders POSIX bits and the Windows read-only attribute', () => {
  expect(formatMode(0o755, false)).toBe('rwxr-xr-x');
  expect(formatMode(0o640, false)).toBe('rw-r-----');
  expect(formatMode(0o666, true)).toBe('RW');
  expect(formatMode(0o444, true)).toBe('RO');
});

test('parseOctal accepts 3 octal digits only', () => {
  expect(parseOctal('644')).toBe(0o644);
  expect(parseOctal(' 0755 ')).toBe(0o755);
  for (const bad of ['', '64', '888', 'rwx', '6444']) expect(parseOctal(bad)).toBeNull();
  expect(formatOctal(0o600)).toBe('600');
  expect(formatOctal(0o7)).toBe('007');
});
