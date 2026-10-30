import stringWidth from 'string-width';

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

const interned = new Map<string, Style>();

/** Styles are interned so cells can be compared by reference. */
export function style(s: Style): Style {
  const key = `${s.fg ?? ''}|${s.bg ?? ''}|${+!!s.bold}${+!!s.dim}${+!!s.italic}${+!!s.underline}${+!!s.inverse}`;
  let v = interned.get(key);
  if (!v) {
    v = Object.freeze({ ...s });
    interned.set(key, v);
  }
  return v;
}

export function merge(base: Style, over: Style): Style {
  return style({ ...base, ...over });
}

interface ScreenCell {
  /** Grapheme; '' marks the right half of a wide character. */
  ch: string;
  style: Style;
}

export interface Run {
  text: string;
  style: Style;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Off-screen cell grid; every UI element draws into it and overlays simply overwrite. */
export class Screen {
  private cells: ScreenCell[];

  constructor(
    readonly width: number,
    readonly height: number,
    base: Style,
  ) {
    this.cells = Array.from({ length: width * height }, () => ({ ch: ' ', style: base }));
  }

  private set(x: number, y: number, ch: string, st: Style): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    // Overwriting half of a wide character blanks its other half.
    if (this.cells[i]!.ch === '' && x > 0) this.cells[i - 1] = { ch: ' ', style: this.cells[i - 1]!.style };
    if (stringWidth(this.cells[i]!.ch) === 2 && x + 1 < this.width) this.cells[i + 1] = { ch: ' ', style: this.cells[i + 1]!.style };
    this.cells[i] = { ch, style: st };
  }

  /** Draws text starting at (x, y), clipped to [x, maxX). Returns the x after the last drawn cell. */
  put(x: number, y: number, text: string, st: Style, maxX = this.width): number {
    const limit = Math.min(maxX, this.width);
    for (const { segment } of segmenter.segment(text)) {
      const w = segment === '\t' ? 1 : Math.max(stringWidth(segment), 0);
      const ch = segment === '\t' ? ' ' : segment;
      if (w === 0) continue;
      if (x + w > limit) break;
      this.set(x, y, ch, st);
      if (w === 2) this.set(x + 1, y, '', st);
      x += w;
    }
    return x;
  }

  fill(x: number, y: number, w: number, h: number, st: Style, ch = ' '): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch, st);
  }

  /** Restyles existing cells without changing their text. */
  restyle(x: number, y: number, w: number, st: Style): void {
    for (let i = x; i < x + w; i++) {
      if (i < 0 || i >= this.width || y < 0 || y >= this.height) continue;
      const c = this.cells[y * this.width + i]!;
      c.style = st;
    }
  }

  rows(): Run[][] {
    const out: Run[][] = [];
    for (let y = 0; y < this.height; y++) {
      const runs: Run[] = [];
      for (let x = 0; x < this.width; x++) {
        const c = this.cells[y * this.width + x]!;
        if (c.ch === '') continue;
        const last = runs[runs.length - 1];
        if (last && last.style === c.style) last.text += c.ch;
        else runs.push({ text: c.ch, style: c.style });
      }
      out.push(runs);
    }
    return out;
  }

  /** Plain text per row, for tests. */
  toText(): string[] {
    return this.rows().map((r) => r.map((x) => x.text).join(''));
  }

  styleAt(x: number, y: number): Style {
    return this.cells[y * this.width + x]!.style;
  }
}
