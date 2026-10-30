import type { TextBuffer } from '../buffer/text-buffer.js';
import { comparePos, type Edit, type Pos } from '../buffer/types.js';

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface Match {
  line: number;
  start: number;
  end: number;
}

/** `multi` matchers run over the whole document text; the others match line by line. */
export type Matcher = { re: RegExp; multi: boolean } | { error: string } | null;

/** A match that may span lines. `end` is exclusive. */
export interface Range {
  start: Pos;
  end: Pos;
}

/** True when a regex query explicitly mentions a line break (`\n`, `\r`, `\x0a`, `\u000d`...), so it must see the whole text. */
export function spansLines(query: string): boolean {
  for (let i = 0; i < query.length; i++) {
    if (query[i] !== '\\') continue;
    const rest = query.slice(i + 1, i + 6);
    if (/^[nr]/.test(rest) || /^x0[ad]/i.test(rest) || /^u000[ad]/i.test(rest)) return true;
    i++; // skip the escaped character
  }
  return false;
}

/** Builds a global RegExp for the options. Returns null for an empty query. Matching is per line unless the regex mentions a line break. */
export function buildMatcher(o: SearchOptions): Matcher {
  if (!o.query) return null;
  let source = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) source = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
  const multi = o.regex && spansLines(o.query);
  try {
    // In multi-line mode ^ and $ keep meaning "start/end of a line".
    return { re: new RegExp(source, (o.caseSensitive ? 'g' : 'gi') + (multi ? 'm' : '')), multi };
  } catch (e) {
    return { error: (e as Error).message.replace(/^Invalid regular expression: /, '') };
  }
}

/** Maps offsets in the joined document text to positions in O(log n). */
export class DocIndex {
  readonly text: string;
  private readonly starts: number[] = [0];

  constructor(buffer: TextBuffer) {
    this.text = buffer.getText();
    for (let i = 0; i < this.text.length; i++) if (this.text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }

  pos(offset: number): Pos {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: offset - this.starts[lo]! };
  }
}

/** Every non-empty match of `re` over the whole text, in order. */
export function allRanges(idx: DocIndex, re: RegExp): Range[] {
  const out: Range[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(idx.text); m; m = re.exec(idx.text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: idx.pos(m.index), end: idx.pos(m.index + m[0].length) });
  }
  return out;
}

/** Parts of `ranges` (sorted) that fall on `line`, clipped to the line. Used for highlighting. */
export function rangesOnLine(ranges: Range[], line: number, lineLength: number): { start: number; end: number; range: Range }[] {
  // First range whose end is on or after this line.
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid]!.end.line < line) lo = mid + 1;
    else hi = mid;
  }
  const out: { start: number; end: number; range: Range }[] = [];
  for (let i = lo; i < ranges.length && ranges[i]!.start.line <= line; i++) {
    const r = ranges[i]!;
    out.push({ start: r.start.line === line ? r.start.col : 0, end: r.end.line === line ? r.end.col : lineLength, range: r });
  }
  return out;
}

/** Next range starting at/after `from` (or the last one starting strictly before it when `backward`), wrapping around. */
export function pickRange(ranges: Range[], from: Pos, backward: boolean): Range | null {
  if (ranges.length === 0) return null;
  if (backward) {
    for (let i = ranges.length - 1; i >= 0; i--) if (comparePos(ranges[i]!.start, from) < 0) return ranges[i]!;
    return ranges[ranges.length - 1]!;
  }
  for (const r of ranges) if (comparePos(r.start, from) >= 0) return r;
  return ranges[0]!;
}

export function matchesInLine(re: RegExp, text: string, line: number): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ line, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Next match at or after `from` (or the previous one strictly before it when `backward`). */
export function findMatch(buffer: TextBuffer, re: RegExp, from: Pos, backward: boolean, wrap: boolean): Match | null {
  const n = buffer.lineCount;
  for (let step = 0; step <= n; step++) {
    const raw = backward ? from.line - step : from.line + step;
    if (!wrap && (raw < 0 || raw >= n)) return null;
    const line = ((raw % n) + n) % n;
    let all = matchesInLine(re, buffer.line(line), line);
    // The starting line is visited twice when wrapping: once for the part after `from`, once for the part before.
    if (step === 0) all = all.filter((m) => (backward ? m.start < from.col : m.start >= from.col));
    else if (step === n) all = all.filter((m) => (backward ? m.start >= from.col : m.start < from.col));
    const hit = backward ? all[all.length - 1] : all[0];
    if (hit) return hit;
  }
  return null;
}

export function countMatches(buffer: TextBuffer, re: RegExp, upTo: Pos): { total: number; before: number } {
  let total = 0;
  let before = 0;
  for (let i = 0; i < buffer.lineCount; i++) {
    for (const m of matchesInLine(re, buffer.line(i), i)) {
      total++;
      if (comparePos({ line: m.line, col: m.start }, upTo) < 0) before++;
    }
  }
  return { total, before };
}

/** Expands `$1`, `$&` etc. in regex mode; literal otherwise. */
export function expandReplacement(re: RegExp, matched: string, replacement: string, regex: boolean): string {
  if (!regex) return replacement;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  return matched.replace(single, replacement);
}

/** Edits replacing every multi-line match, bottom-to-top. */
export function replaceAllRanges(buffer: TextBuffer, ranges: Range[], re: RegExp, replacement: string, regex: boolean): Edit[] {
  const edits: Edit[] = [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    const removed = buffer.getRange(r.start, r.end);
    edits.push({ start: r.start, removed, inserted: expandReplacement(re, removed, replacement, regex).replace(/\r\n?/g, '\n') });
  }
  return edits;
}

/** Edits replacing every match, ordered bottom-to-top so positions stay valid when applied in order. */
export function replaceAllEdits(buffer: TextBuffer, re: RegExp, replacement: string, regex: boolean): Edit[] {
  const edits: Edit[] = [];
  for (let line = buffer.lineCount - 1; line >= 0; line--) {
    const text = buffer.line(line);
    const ms = matchesInLine(re, text, line);
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i]!;
      edits.push({
        start: { line, col: m.start },
        removed: text.slice(m.start, m.end),
        inserted: expandReplacement(re, text.slice(m.start, m.end), replacement, regex).replace(/\r\n?/g, '\n'),
      });
    }
  }
  return edits;
}
