/** Permission bits shown and edited by the editor (setuid/sticky bits are left alone). */
export const MODE_MASK = 0o777;
/** Windows only has a read-only attribute; these are the modes it maps to. */
export const WIN_READ_WRITE = 0o666;
export const WIN_READ_ONLY = 0o444;

/** Status-bar text: `rwxr-xr-x` on POSIX, `RW` / `RO` on Windows. */
export function formatMode(mode: number, win = process.platform === 'win32'): string {
  if (win) return mode & 0o200 ? 'RW' : 'RO';
  let out = '';
  for (const shift of [6, 3, 0]) {
    const bits = (mode >> shift) & 7;
    out += (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (bits & 1 ? 'x' : '-');
  }
  return out;
}

export function formatOctal(mode: number): string {
  return (mode & MODE_MASK).toString(8).padStart(3, '0');
}

/** Parses `644` / `0644`; returns null for anything that is not an octal permission. */
export function parseOctal(text: string): number | null {
  const m = /^0?([0-7]{3})$/.exec(text.trim());
  return m ? parseInt(m[1]!, 8) : null;
}
