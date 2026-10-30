import type { Edit, Pos } from './types.js';

export interface CursorState {
  cursor: Pos;
  anchor: Pos | null;
}

export interface HistoryEntry {
  edits: Edit[];
  before: CursorState;
  after: CursorState;
}

/** Edits of the same non-'other' kind merge into one undo step until `seal()`. */
export type EditKind = 'typing' | 'backspace' | 'delete' | 'other';

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private openKind: EditKind | null = null;
  /** Undo depth at which the content matched the last save; null once that state is unreachable. */
  private cleanDepth: number | null = 0;

  constructor(private readonly limit = 1000) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isClean(): boolean {
    return this.cleanDepth === this.undoStack.length;
  }

  /** Marks the current content as saved. */
  markClean(): void {
    this.seal();
    this.cleanDepth = this.undoStack.length;
  }

  /** Closes the current group so the next edit starts a new undo step. */
  seal(): void {
    this.openKind = null;
  }

  record(edits: Edit[], kind: EditKind, before: CursorState, after: CursorState): void {
    // Editing after an undo past the saved state makes that state unreachable.
    if (this.redoStack.length > 0 && this.cleanDepth !== null && this.cleanDepth > this.undoStack.length) this.cleanDepth = null;
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && kind !== 'other' && this.openKind === kind) {
      top.edits.push(...edits);
      top.after = after;
      return;
    }
    this.undoStack.push({ edits, before, after });
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
      if (this.cleanDepth !== null) this.cleanDepth = this.cleanDepth > 0 ? this.cleanDepth - 1 : null;
    }
    this.openKind = kind === 'other' ? null : kind;
  }

  popUndo(): HistoryEntry | undefined {
    this.seal();
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    return entry;
  }

  popRedo(): HistoryEntry | undefined {
    this.seal();
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    return entry;
  }
}
