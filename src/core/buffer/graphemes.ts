import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Column of the grapheme boundary before `col` (0 when already at the start). */
export function prevBoundary(line: string, col: number): number {
  let prev = 0;
  for (const { index } of segmenter.segment(line)) {
    if (index >= col) break;
    prev = index;
  }
  return prev;
}

/** Column of the grapheme boundary after `col` (line length when already at the end). */
export function nextBoundary(line: string, col: number): number {
  for (const { index, segment } of segmenter.segment(line)) {
    if (index + segment.length > col) return index + segment.length;
  }
  return line.length;
}

export function isSingleGrapheme(text: string): boolean {
  return text.length > 0 && nextBoundary(text, 0) === text.length;
}

let tabSize = 4;

export function setTabSize(n: number): void {
  tabSize = Math.min(Math.max(Math.trunc(n) || 4, 1), 16);
}

export function getTabSize(): number {
  return tabSize;
}

/** Width of one grapheme that starts at display column `at` (tabs expand to the next stop). */
export function graphemeWidth(segment: string, at: number): number {
  return segment === '\t' ? tabSize - (at % tabSize) : stringWidth(segment);
}

export interface Cell {
  /** UTF-16 index in the line. */
  index: number;
  text: string;
  /** Display column where this grapheme starts. */
  col: number;
  width: number;
}

/** Splits a line into display cells (tab-expanded, wide-char aware). */
export function lineCells(line: string): Cell[] {
  const out: Cell[] = [];
  let col = 0;
  for (const { index, segment } of segmenter.segment(line)) {
    const width = graphemeWidth(segment, col);
    out.push({ index, text: segment, col, width });
    col += width;
  }
  return out;
}

/** Display width of line[0, col). */
export function displayWidth(line: string, col: number): number {
  let w = 0;
  for (const { index, segment } of segmenter.segment(line)) {
    if (index >= col) break;
    w += graphemeWidth(segment, w);
  }
  return w;
}

/** Largest grapheme boundary whose display width does not exceed `width`. */
export function colForWidth(line: string, width: number): number {
  let col = 0;
  let w = 0;
  for (const { index, segment } of segmenter.segment(line)) {
    const sw = graphemeWidth(segment, w);
    if (w + sw > width) return index;
    w += sw;
    col = index + segment.length;
  }
  return col;
}
