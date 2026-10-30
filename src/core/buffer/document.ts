import { History, type CursorState, type EditKind } from './history.js';
import { colForWidth, displayWidth, isSingleGrapheme, nextBoundary, prevBoundary } from './graphemes.js';
import { TextBuffer, normalize } from './text-buffer.js';
import { comparePos, samePos, type Edit, type Pos } from './types.js';

export type Motion = 'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'lineStart' | 'lineEnd' | 'docStart' | 'docEnd';

function charClass(ch: string): 0 | 1 | 2 {
  if (/\s/u.test(ch)) return 0;
  return /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2;
}

/** A text buffer plus cursor, selection and undo history. */
export class Document {
  readonly buffer: TextBuffer;
  readonly history = new History();
  cursor: Pos = { line: 0, col: 0 };
  /** Selection anchor; the selection spans anchor..cursor. */
  anchor: Pos | null = null;
  private desiredWidth: number | null = null;
  /** Bumped on every text change (edit, undo, redo); used for dirty tracking and caches. */
  revision = 0;

  constructor(text = '') {
    this.buffer = new TextBuffer(text);
  }

  get text(): string {
    return this.buffer.getText();
  }

  selection(): { start: Pos; end: Pos } | null {
    if (!this.anchor || samePos(this.anchor, this.cursor)) return null;
    return comparePos(this.anchor, this.cursor) < 0
      ? { start: this.anchor, end: this.cursor }
      : { start: this.cursor, end: this.anchor };
  }

  selectedText(): string {
    const sel = this.selection();
    return sel ? this.buffer.getRange(sel.start, sel.end) : '';
  }

  // ---- movement ----

  move(motion: Motion, extend = false): void {
    this.history.seal();
    const sel = this.selection();
    // Collapsing a selection with plain left/right jumps to its edge.
    const target =
      sel && !extend && (motion === 'left' || motion === 'right')
        ? motion === 'left' ? sel.start : sel.end
        : this.target(motion);
    if (motion !== 'up' && motion !== 'down') this.desiredWidth = null;
    this.setCursor(target, extend);
  }

  /** Moves up/down by `n` lines (negative = up), keeping the display column. */
  moveLines(n: number, extend = false): void {
    this.history.seal();
    const { line, col } = this.cursor;
    const to = Math.min(Math.max(line + n, 0), this.buffer.lineCount - 1);
    this.desiredWidth ??= displayWidth(this.buffer.line(line), col);
    this.setCursor({ line: to, col: colForWidth(this.buffer.line(to), this.desiredWidth) }, extend);
  }

  moveTo(pos: Pos, extend = false): void {
    this.history.seal();
    this.desiredWidth = null;
    this.setCursor(this.buffer.clamp(pos), extend);
  }

  selectAll(): void {
    this.history.seal();
    this.anchor = { line: 0, col: 0 };
    this.cursor = this.buffer.endPos();
    this.desiredWidth = null;
  }

  private setCursor(pos: Pos, extend: boolean): void {
    if (extend) this.anchor ??= this.cursor;
    else this.anchor = null;
    this.cursor = pos;
  }

  private target(motion: Motion): Pos {
    const { line, col } = this.cursor;
    const text = this.buffer.line(line);
    switch (motion) {
      case 'left':
        if (col > 0) return { line, col: prevBoundary(text, col) };
        return line > 0 ? { line: line - 1, col: this.buffer.line(line - 1).length } : this.cursor;
      case 'right':
        if (col < text.length) return { line, col: nextBoundary(text, col) };
        return line < this.buffer.lineCount - 1 ? { line: line + 1, col: 0 } : this.cursor;
      case 'up':
      case 'down': {
        const to = line + (motion === 'up' ? -1 : 1);
        if (to < 0) return { line: 0, col: 0 };
        if (to >= this.buffer.lineCount) return this.buffer.endPos();
        this.desiredWidth ??= displayWidth(text, col);
        return { line: to, col: colForWidth(this.buffer.line(to), this.desiredWidth) };
      }
      case 'wordLeft': {
        if (col === 0) return line > 0 ? { line: line - 1, col: this.buffer.line(line - 1).length } : this.cursor;
        let c = col;
        while (c > 0 && charClass(text[c - 1]!) === 0) c--;
        if (c > 0) {
          const cls = charClass(text[c - 1]!);
          while (c > 0 && charClass(text[c - 1]!) === cls) c--;
        }
        return { line, col: c };
      }
      case 'wordRight': {
        if (col >= text.length) return line < this.buffer.lineCount - 1 ? { line: line + 1, col: 0 } : this.cursor;
        let c = col;
        const cls = charClass(text[c]!);
        if (cls !== 0) while (c < text.length && charClass(text[c]!) === cls) c++;
        while (c < text.length && charClass(text[c]!) === 0) c++;
        return { line, col: c };
      }
      case 'lineStart':
        return { line, col: 0 };
      case 'lineEnd':
        return { line, col: text.length };
      case 'docStart':
        return { line: 0, col: 0 };
      case 'docEnd':
        return this.buffer.endPos();
    }
  }

  // ---- editing ----

  /** Inserts text at the cursor, replacing the selection if any. */
  insert(text: string): void {
    text = normalize(text);
    if (!text) return;
    const sel = this.selection();
    const kind: EditKind = !sel && isSingleGrapheme(text) && text !== '\n' ? 'typing' : 'other';
    const before = this.state();
    const edits: Edit[] = [];
    let at = this.cursor;
    if (sel) {
      edits.push(this.buffer.deleteEdit(sel.start, sel.end));
      this.buffer.apply(edits[0]!);
      at = sel.start;
    }
    const ins = this.buffer.insertEdit(at, text);
    edits.push(ins);
    this.finish(edits, this.buffer.apply(ins), kind, before);
  }

  backspace(): void {
    if (this.deleteSelection()) return;
    const { line, col } = this.cursor;
    if (line === 0 && col === 0) return;
    const start: Pos =
      col > 0
        ? { line, col: prevBoundary(this.buffer.line(line), col) }
        : { line: line - 1, col: this.buffer.line(line - 1).length };
    this.remove(start, this.cursor, 'backspace');
  }

  deleteForward(): void {
    if (this.deleteSelection()) return;
    const { line, col } = this.cursor;
    const text = this.buffer.line(line);
    let end: Pos;
    if (col < text.length) end = { line, col: nextBoundary(text, col) };
    else if (line < this.buffer.lineCount - 1) end = { line: line + 1, col: 0 };
    else return;
    this.remove(this.cursor, end, 'delete');
  }

  /** Deletes the selection; returns false when there is none. */
  deleteSelection(): boolean {
    const sel = this.selection();
    if (!sel) return false;
    this.remove(sel.start, sel.end, 'other');
    return true;
  }

  private remove(start: Pos, end: Pos, kind: EditKind): void {
    const before = this.state();
    const edit = this.buffer.deleteEdit(start, end);
    this.buffer.apply(edit);
    this.finish([edit], edit.start, kind, before);
  }

  private finish(edits: Edit[], cursor: Pos, kind: EditKind, before: CursorState): void {
    this.cursor = cursor;
    this.anchor = null;
    this.desiredWidth = null;
    this.revision++;
    this.history.record(edits, kind, before, this.state());
  }

  /**
   * Applies several edits as one undo step. Edits are applied in the given order, so each
   * start position must be valid after the previous edits (e.g. sort bottom-to-top).
   */
  applyEdits(edits: Edit[], cursor?: Pos, anchor: Pos | null = null): void {
    if (edits.length === 0) return;
    const before = this.state();
    let last = this.cursor;
    for (const e of edits) last = this.buffer.apply(e);
    this.history.seal();
    this.finish(edits, this.buffer.clamp(cursor ?? last), 'other', before);
    this.anchor = anchor ? this.buffer.clamp(anchor) : null;
    this.history.seal();
  }

  // ---- undo / redo ----

  undo(): boolean {
    const entry = this.history.popUndo();
    if (!entry) return false;
    for (let i = entry.edits.length - 1; i >= 0; i--) {
      const e = entry.edits[i]!;
      this.buffer.apply({ start: e.start, removed: e.inserted, inserted: e.removed });
    }
    this.restore(entry.before);
    this.revision++;
    return true;
  }

  redo(): boolean {
    const entry = this.history.popRedo();
    if (!entry) return false;
    for (const e of entry.edits) this.buffer.apply(e);
    this.restore(entry.after);
    this.revision++;
    return true;
  }

  private state(): CursorState {
    return { cursor: this.cursor, anchor: this.anchor };
  }

  private restore(s: CursorState): void {
    this.cursor = s.cursor;
    this.anchor = s.anchor;
    this.desiredWidth = null;
  }
}
