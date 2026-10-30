import { lineCells } from '../core/buffer/graphemes.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  cols: number;
  rows: number;
  tooSmall: boolean;
  menuY: number;
  toolbarY: number;
  find: Rect;
  editor: Rect;
  gutterW: number;
  textX: number;
  textW: number;
  statusY: number;
}

export const MIN_COLS = 30;
export const MIN_ROWS = 6;

export function computeLayout(cols: number, rows: number, lineCount: number, showLineNumbers: boolean, findRows: number): Layout {
  const gutterW = showLineNumbers ? Math.max(3, String(lineCount).length) + 2 : 0;
  const editorY = 2 + findRows;
  const editorH = Math.max(rows - 3 - findRows, 1);
  return {
    cols,
    rows,
    tooSmall: cols < MIN_COLS || rows < MIN_ROWS,
    menuY: 0,
    toolbarY: 1,
    find: { x: 0, y: 2, w: cols, h: findRows },
    editor: { x: 0, y: editorY, w: cols, h: editorH },
    gutterW,
    textX: gutterW,
    textW: Math.max(cols - gutterW, 1),
    statusY: rows - 1,
  };
}

/** Start column (UTF-16 index) of every visual row of `line` when wrapped at `width` display columns. */
export function wrapStarts(line: string, width: number): number[] {
  if (line.length * 2 <= width && !line.includes('\t')) return [0];
  const starts = [0];
  let base = 0;
  for (const c of lineCells(line)) {
    if (c.col + c.width - base > width && c.col > base) {
      starts.push(c.index);
      base = c.col;
    }
  }
  return starts;
}
