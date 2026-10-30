import { nextBoundary, prevBoundary } from './buffer/graphemes.js';
import type { KeyEvent } from '../input/parser.js';

/** Single-line text input state shared by dialogs and the find panel. */
export class TextField {
  caret: number;

  constructor(public value = '') {
    this.caret = value.length;
  }

  set(value: string): void {
    this.value = value;
    this.caret = value.length;
  }

  insert(text: string): void {
    const clean = text.replace(/\r\n?|\n/g, ' ');
    this.value = this.value.slice(0, this.caret) + clean + this.value.slice(this.caret);
    this.caret += clean.length;
  }

  /** Handles an editing key; returns true when the field consumed it. */
  key(k: KeyEvent): boolean {
    if (k.alt || k.super) return false;
    if (k.ctrl) {
      switch (k.name) {
        case 'left':
          this.caret = this.wordLeft();
          return true;
        case 'right':
          this.caret = this.wordRight();
          return true;
        case 'backspace': {
          const to = this.wordLeft();
          this.value = this.value.slice(0, to) + this.value.slice(this.caret);
          this.caret = to;
          return true;
        }
        case 'u':
          this.set('');
          return true;
        case 'a':
          this.caret = 0;
          return true;
        case 'e':
          this.caret = this.value.length;
          return true;
        default:
          return false;
      }
    }
    switch (k.name) {
      case 'left':
        this.caret = prevBoundary(this.value, this.caret);
        return true;
      case 'right':
        this.caret = nextBoundary(this.value, this.caret);
        return true;
      case 'home':
        this.caret = 0;
        return true;
      case 'end':
        this.caret = this.value.length;
        return true;
      case 'backspace': {
        const to = prevBoundary(this.value, this.caret);
        this.value = this.value.slice(0, to) + this.value.slice(this.caret);
        this.caret = to;
        return true;
      }
      case 'delete': {
        const to = nextBoundary(this.value, this.caret);
        this.value = this.value.slice(0, this.caret) + this.value.slice(to);
        return true;
      }
      default:
        return false;
    }
  }

  private wordLeft(): number {
    let c = this.caret;
    while (c > 0 && /\s/.test(this.value[c - 1]!)) c--;
    while (c > 0 && !/\s/.test(this.value[c - 1]!)) c--;
    return c;
  }

  private wordRight(): number {
    let c = this.caret;
    while (c < this.value.length && /\s/.test(this.value[c]!)) c++;
    while (c < this.value.length && !/\s/.test(this.value[c]!)) c++;
    return c;
  }
}
