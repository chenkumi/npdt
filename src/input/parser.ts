/** Terminal byte stream -> structured key / text / mouse / paste events. Pure and stateful only for partial sequences. */

export interface KeyEvent {
  type: 'key';
  /** Lower-case key name: 'a', 'left', 'f5', 'return', 'space', ... */
  name: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  super: boolean;
}

export interface TextEvent {
  type: 'text';
  text: string;
}

export interface MouseEvent {
  type: 'mouse';
  kind: 'down' | 'up' | 'drag' | 'move' | 'wheelUp' | 'wheelDown';
  button: 'left' | 'middle' | 'right' | 'none';
  /** Zero-based cell coordinates. */
  x: number;
  y: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface PasteEvent {
  type: 'paste';
  text: string;
}

export type InputEvent = KeyEvent | TextEvent | MouseEvent | PasteEvent;

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** Canonical id used by keymaps, e.g. "ctrl+shift+k", "alt+left", "f3". */
export function keyId(k: Pick<KeyEvent, 'name' | 'ctrl' | 'alt' | 'shift' | 'super'>): string {
  const parts: string[] = [];
  if (k.ctrl) parts.push('ctrl');
  if (k.alt) parts.push('alt');
  if (k.shift) parts.push('shift');
  if (k.super) parts.push('super');
  parts.push(k.name);
  return parts.join('+');
}

function key(name: string, mods: Partial<Omit<KeyEvent, 'type' | 'name'>> = {}): KeyEvent {
  return { type: 'key', name, ctrl: false, alt: false, shift: false, super: false, ...mods };
}

function modsFromParam(param: number): Partial<Omit<KeyEvent, 'type' | 'name'>> {
  const m = Math.max(param - 1, 0);
  return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4), super: !!(m & 8) };
}

const CSI_FINAL: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  E: 'clear',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

const TILDE: Record<number, string> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageup',
  6: 'pagedown',
  7: 'home',
  8: 'end',
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6',
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11',
  24: 'f12',
};

const KITTY_NAMES: Record<number, string> = {
  9: 'tab',
  13: 'return',
  27: 'escape',
  32: 'space',
  127: 'backspace',
  8: 'backspace',
};

/** Maps a (kitty / modifyOtherKeys) code point to a key name. */
function codeName(code: number): string {
  const named = KITTY_NAMES[code];
  if (named) return named;
  return String.fromCodePoint(code).toLowerCase();
}

function ctrlLetter(c: number): string | null {
  // 0x01..0x1a -> a..z (excluding tab/enter/backspace handled by caller)
  return c >= 1 && c <= 26 ? String.fromCharCode(96 + c) : null;
}

export class InputParser {
  private pending = '';
  private pasteBuf: string | null = null;

  /** Feeds a decoded chunk and returns the complete events it produced. */
  feed(chunk: string): InputEvent[] {
    const events: InputEvent[] = [];
    let s = this.pending + chunk;
    this.pending = '';
    let text = '';
    const flushText = () => {
      if (text) events.push({ type: 'text', text });
      text = '';
    };

    let i = 0;
    while (i < s.length) {
      if (this.pasteBuf !== null) {
        const end = s.indexOf(PASTE_END, i);
        if (end < 0) {
          // Keep a possible partial terminator for the next chunk.
          const keep = partialSuffix(s.slice(i), PASTE_END);
          this.pasteBuf += s.slice(i, s.length - keep);
          this.pending = s.slice(s.length - keep);
          return events;
        }
        this.pasteBuf += s.slice(i, end);
        events.push({ type: 'paste', text: this.pasteBuf });
        this.pasteBuf = null;
        i = end + PASTE_END.length;
        continue;
      }

      const c = s[i]!;
      const code = c.charCodeAt(0);

      if (c === '\x1b') {
        flushText();
        if (i + 1 >= s.length) {
          events.push(key('escape'));
          i++;
          continue;
        }
        const next = s[i + 1]!;
        if (next === '[') {
          if (s.startsWith(PASTE_START, i)) {
            this.pasteBuf = '';
            i += PASTE_START.length;
            continue;
          }
          const m = /^\x1b\[([<>=?]?)([0-9;:]*)([ -/]*)([@-~])/.exec(s.slice(i, i + 64));
          if (!m) {
            // Incomplete CSI (or garbage): keep waiting if it still looks like one.
            if (/^\x1b\[[<>=?]?[0-9;:]*[ -/]*$/.test(s.slice(i, i + 64))) {
              this.pending = s.slice(i);
              return events;
            }
            events.push(key('left_bracket', { alt: true }));
            i += 2;
            continue;
          }
          const ev = this.csi(m[1]!, m[2]!, m[4]!);
          if (ev) events.push(ev);
          i += m[0].length;
          continue;
        }
        if (next === 'O') {
          if (i + 2 >= s.length) {
            this.pending = s.slice(i);
            return events;
          }
          const name = CSI_FINAL[s[i + 2]!];
          if (name) events.push(key(name));
          i += 3;
          continue;
        }
        if (next === '\x1b') {
          // ESC followed by another sequence (two keys arrived in one chunk) is a plain Escape;
          // a bare ESC ESC is how terminals report Alt+Escape.
          const after = s[i + 2];
          if (after === '[' || after === 'O') {
            events.push(key('escape'));
            i++;
          } else {
            events.push(key('escape', { alt: true }));
            i += 2;
          }
          continue;
        }
        // ESC <char>: alt+char
        const cp = s.codePointAt(i + 1)!;
        const ch = String.fromCodePoint(cp);
        i += 1 + ch.length;
        events.push(this.plainKey(ch, true));
        continue;
      }

      if (code < 0x20 || code === 0x7f) {
        flushText();
        events.push(this.control(code));
        i++;
        continue;
      }

      text += c;
      i++;
    }
    flushText();
    return events;
  }

  private control(code: number): KeyEvent {
    switch (code) {
      case 0:
        return key('space', { ctrl: true });
      case 9:
        return key('tab');
      case 13:
        return key('return');
      case 10:
        return key('j', { ctrl: true });
      case 8:
        // Windows Terminal sends 0x08 for Ctrl+Backspace; plain Backspace is 0x7f.
        return key('backspace', { ctrl: true });
      case 0x7f:
        return key('backspace');
      default: {
        const letter = ctrlLetter(code);
        return letter ? key(letter, { ctrl: true }) : key(`ctrl_${code}`);
      }
    }
  }

  private plainKey(ch: string, alt: boolean): KeyEvent {
    if (ch === '\x7f') return key('backspace', { alt });
    if (ch === '\r') return key('return', { alt });
    if (ch === '\t') return key('tab', { alt });
    if (ch === ' ') return key('space', { alt });
    const upper = ch !== ch.toLowerCase();
    return key(ch.toLowerCase(), { alt, shift: upper });
  }

  private csi(prefix: string, params: string, final: string): InputEvent | null {
    if (prefix === '<' && (final === 'M' || final === 'm')) return this.sgrMouse(params, final);
    if (prefix !== '') return null;
    const nums = params.split(';').map((p) => parseInt(p.split(':')[0] ?? '', 10));
    const num = (i: number, d: number) => (Number.isFinite(nums[i]) ? nums[i]! : d);

    if (final === 'Z') return key('tab', { shift: true });
    if (final === 'u') {
      // kitty: CSI code ; mods u
      const code = num(0, 0);
      return key(codeName(code), modsFromParam(num(1, 1)));
    }
    if (final === '~') {
      const first = num(0, 0);
      if (first === 27) {
        // modifyOtherKeys: CSI 27 ; mods ; code ~
        return key(codeName(num(2, 0)), modsFromParam(num(1, 1)));
      }
      const name = TILDE[first];
      return name ? key(name, modsFromParam(num(1, 1))) : null;
    }
    const name = CSI_FINAL[final];
    if (name) return key(name, modsFromParam(num(1, 1)));
    return null;
  }

  private sgrMouse(params: string, final: string): MouseEvent | null {
    const [b, x, y] = params.split(';').map((p) => parseInt(p, 10));
    if (b === undefined || x === undefined || y === undefined || [b, x, y].some(Number.isNaN)) return null;
    const mods = { shift: !!(b & 4), alt: !!(b & 8), ctrl: !!(b & 16) };
    const base = { type: 'mouse' as const, x: x - 1, y: y - 1, ...mods };
    if (b & 64) return { ...base, kind: (b & 1) === 0 ? 'wheelUp' : 'wheelDown', button: 'none' };
    const button = (['left', 'middle', 'right', 'none'] as const)[b & 3]!;
    if (b & 32) return { ...base, kind: button === 'none' ? 'move' : 'drag', button };
    return { ...base, kind: final === 'M' ? 'down' : 'up', button };
  }
}

/** Length of the longest suffix of `s` that is a proper prefix of `term`. */
function partialSuffix(s: string, term: string): number {
  for (let n = Math.min(term.length - 1, s.length); n > 0; n--) {
    if (term.startsWith(s.slice(s.length - n))) return n;
  }
  return 0;
}
