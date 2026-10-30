/** Zero-based line and UTF-16 column within that line. */
export interface Pos {
  line: number;
  col: number;
}

/** Replaces `removed` at `start` with `inserted`. Its inverse swaps the two strings. */
export interface Edit {
  start: Pos;
  removed: string;
  inserted: string;
}

export function comparePos(a: Pos, b: Pos): number {
  return a.line - b.line || a.col - b.col;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.line === b.line && a.col === b.col;
}

/** Position reached after writing `text` starting at `from`. */
export function advance(from: Pos, text: string): Pos {
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return { line: from.line, col: from.col + text.length };
  let lines = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lines++;
  return { line: from.line + lines, col: text.length - nl - 1 };
}
