/**
 * Visualization of invisible characters. Module-global like the tab size: a marked character is drawn as a
 * ` LABEL ` badge, so its display width is the badge width and every width-based computation stays consistent.
 */

export const SPECIAL_CATEGORIES = ['whitespace', 'eol', 'nonPrinting', 'control'] as const;
export type SpecialCategory = (typeof SPECIAL_CATEGORIES)[number];
export type SpecialChars = Record<SpecialCategory, boolean>;

/** Visual kinds; `eof` is only ever drawn at the end of the document. */
export type MarkKind = SpecialCategory | 'eof';

export interface Mark {
  label: string;
  kind: MarkKind;
}

const OFF: SpecialChars = { whitespace: false, eol: false, nonPrinting: false, control: false };
let active: SpecialChars = OFF;
let any = false;

export function setSpecialChars(cfg: SpecialChars): void {
  active = cfg;
  any = SPECIAL_CATEGORIES.some((c) => cfg[c]);
}

export function specialsActive(): boolean {
  return any;
}

export function specialOn(c: SpecialCategory): boolean {
  return active[c];
}

/** Badge text including the one-cell padding on each side. */
export function badge(label: string): string {
  return ` ${label} `;
}

const C0 = [
  'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', '', '', 'VT', 'FF', '', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US',
];

const C1: Record<number, string> = { 0x85: 'NEL', 0x84: 'IND', 0x88: 'HTS', 0x8d: 'RI', 0x8e: 'SS2', 0x8f: 'SS3', 0x9b: 'CSI', 0x9c: 'ST', 0x9d: 'OSC' };

const SPACES = new Set([0xa0, 0x1680, 0x202f, 0x205f, 0x3000]);

const HIDDEN: Record<number, string> = {
  0x200b: 'ZWSP', 0x200c: 'ZWNJ', 0x200d: 'ZWJ', 0xfeff: 'BOM', 0xad: 'SHY',
  0x2060: 'WJ', 0x2061: 'FA', 0x2062: 'IT', 0x2063: 'IS', 0x2064: 'IP',
  0x200e: 'LRM', 0x200f: 'RLM', 0x61c: 'ALM',
  0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x202d: 'LRO', 0x202e: 'RLO',
  0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI', 0x2069: 'PDI',
  0x34f: 'CGJ', 0x180e: 'MVS',
};

function hex(cp: number): string {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/** Label for an invisible format character, or undefined for anything else. */
function hiddenLabel(cp: number): string | undefined {
  const named = HIDDEN[cp];
  if (named) return named;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VS${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VS${cp - 0xe0100 + 17}`;
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'TAG';
  if (cp >= 0xd800 && cp <= 0xdfff) return hex(cp);
  if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) return hex(cp);
  return undefined;
}

const HIDDEN_TEST = /[­͏؜᠎​-‏‪-‮⁠-⁤⁦-⁩︀-️﻿\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}\ud800-\udfff﷐-﷯￾￿]/u;
const EMOJI_TEST = /\p{Extended_Pictographic}|⃣|\p{Regional_Indicator}/u;

/** Characters that legitimately glue emoji sequences together; never flagged inside one. */
function emojiGlue(cp: number): boolean {
  return cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e || (cp >= 0xe0020 && cp <= 0xe007f);
}

/** Splits a grapheme cluster so each invisible code point becomes its own piece (only when non-printing is shown). */
export function splitCluster(cluster: string): string[] {
  if (!active.nonPrinting || cluster.length < 2 || !HIDDEN_TEST.test(cluster)) return [cluster];
  const isEmoji = EMOJI_TEST.test(cluster);
  const out: string[] = [];
  let cur = '';
  for (const ch of cluster) {
    const cp = ch.codePointAt(0)!;
    if (hiddenLabel(cp) !== undefined && !(isEmoji && emojiGlue(cp))) {
      if (cur) out.push(cur);
      out.push(ch);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** The badge for one display cell, if its category is currently shown. Tab and U+0020 are handled by the renderer. */
export function markFor(segment: string): Mark | undefined {
  if (!any) return undefined;
  const cp = segment.codePointAt(0)!;
  if (segment.length !== (cp > 0xffff ? 2 : 1)) return undefined;
  if (cp < 0x20) {
    if (!active.control || cp === 9 || cp === 10 || cp === 13) return undefined;
    return { label: C0[cp]!, kind: 'control' };
  }
  if (cp < 0x7f) return undefined;
  if (cp === 0x7f) return active.control ? { label: 'DEL', kind: 'control' } : undefined;
  if (cp <= 0x9f) return active.control ? { label: C1[cp] ?? 'x' + cp.toString(16), kind: 'control' } : undefined;
  if (active.whitespace && (SPACES.has(cp) || (cp >= 0x2000 && cp <= 0x200a))) {
    return { label: cp === 0xa0 ? 'NBSP' : hex(cp), kind: 'whitespace' };
  }
  if (active.nonPrinting) {
    const label = hiddenLabel(cp);
    if (label) return { label, kind: 'nonPrinting' };
  }
  return undefined;
}

/** Display width of the badge for `segment`, or 0 when it is not marked. */
export function markWidth(segment: string): number {
  const m = markFor(segment);
  return m ? m.label.length + 2 : 0;
}
