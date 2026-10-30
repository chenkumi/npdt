export type Eol = 'crlf' | 'lf' | 'cr';

export const EOL_CHARS: Record<Eol, string> = { crlf: '\r\n', lf: '\n', cr: '\r' };
export const EOL_LABELS: Record<Eol, string> = { crlf: 'Windows (CRLF)', lf: 'Unix (LF)', cr: 'Mac (CR)' };

export function platformEol(): Eol {
  return process.platform === 'win32' ? 'crlf' : 'lf';
}

/** Dominant line ending of `text`; falls back to the platform default when there is none. */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf + lf + cr === 0) return platformEol();
  if (crlf >= lf && crlf >= cr) return 'crlf';
  return lf >= cr ? 'lf' : 'cr';
}

/** Converts '\n'-normalized text to the requested line ending. */
export function applyEol(text: string, eol: Eol): string {
  return eol === 'lf' ? text : text.replaceAll('\n', EOL_CHARS[eol]);
}
