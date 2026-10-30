import { advance, comparePos, type Edit, type Pos } from './types.js';

/** Line-array text storage. Text is always '\n'-separated; EOL style is a file-IO concern. */
export class TextBuffer {
  private lines: string[];
  private chars: number;

  constructor(text = '') {
    this.lines = normalize(text).split('\n');
    this.chars = this.computeLength();
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** Total characters including the '\n' separators. */
  get length(): number {
    return this.chars;
  }

  line(i: number): string {
    return this.lines[i] ?? '';
  }

  getText(): string {
    return this.lines.join('\n');
  }

  clamp(pos: Pos): Pos {
    const line = Math.min(Math.max(pos.line, 0), this.lines.length - 1);
    const col = Math.min(Math.max(pos.col, 0), this.line(line).length);
    return { line, col };
  }

  endPos(): Pos {
    const line = this.lines.length - 1;
    return { line, col: this.line(line).length };
  }

  getRange(start: Pos, end: Pos): string {
    if (comparePos(start, end) > 0) [start, end] = [end, start];
    start = this.clamp(start);
    end = this.clamp(end);
    if (start.line === end.line) return this.line(start.line).slice(start.col, end.col);
    const parts = [this.line(start.line).slice(start.col)];
    for (let i = start.line + 1; i < end.line; i++) parts.push(this.line(i));
    parts.push(this.line(end.line).slice(0, end.col));
    return parts.join('\n');
  }

  posToOffset(pos: Pos): number {
    pos = this.clamp(pos);
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += this.line(i).length + 1;
    return off + pos.col;
  }

  offsetToPos(offset: number): Pos {
    let rest = Math.min(Math.max(offset, 0), this.chars);
    for (let i = 0; i < this.lines.length; i++) {
      const len = this.line(i).length;
      if (rest <= len) return { line: i, col: rest };
      rest -= len + 1;
    }
    return this.endPos();
  }

  /** Builds an edit that deletes [start, end). */
  deleteEdit(start: Pos, end: Pos): Edit {
    if (comparePos(start, end) > 0) [start, end] = [end, start];
    start = this.clamp(start);
    return { start, removed: this.getRange(start, end), inserted: '' };
  }

  insertEdit(at: Pos, text: string): Edit {
    return { start: this.clamp(at), removed: '', inserted: normalize(text) };
  }

  /** Applies the edit; returns the position just after the inserted text. */
  apply(edit: Edit): Pos {
    const { start, removed, inserted } = edit;
    const end = advance(start, removed);
    const head = this.line(start.line).slice(0, start.col);
    const tail = this.line(end.line).slice(end.col);
    const middle = (head + inserted + tail).split('\n');
    if (middle.length < 5000) this.lines.splice(start.line, end.line - start.line + 1, ...middle);
    else this.lines = this.lines.slice(0, start.line).concat(middle, this.lines.slice(end.line + 1)); // spread would overflow the call stack
    this.chars += inserted.length - removed.length;
    return advance(start, inserted);
  }

  private computeLength(): number {
    let n = this.lines.length - 1;
    for (const l of this.lines) n += l.length;
    return n;
  }
}

export function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
