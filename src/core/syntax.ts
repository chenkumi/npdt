import { common, createLowlight } from 'lowlight';

export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'type'
  | 'attr'
  | 'tag'
  | 'meta'
  | 'variable'
  | 'symbol'
  | 'function';

export interface Span {
  start: number;
  end: number;
  kind: TokenKind;
}

const lowlight = createLowlight(common);

const KIND_BY_CLASS: Record<string, TokenKind> = {
  keyword: 'keyword',
  doctag: 'keyword',
  'selector-tag': 'keyword',
  string: 'string',
  regexp: 'string',
  addition: 'string',
  comment: 'comment',
  quote: 'comment',
  deletion: 'comment',
  number: 'number',
  literal: 'number',
  built_in: 'type',
  type: 'type',
  class: 'type',
  title: 'function',
  function: 'function',
  attr: 'attr',
  attribute: 'attr',
  property: 'attr',
  'selector-class': 'attr',
  'selector-id': 'attr',
  tag: 'tag',
  name: 'tag',
  meta: 'meta',
  'meta-keyword': 'meta',
  variable: 'variable',
  'template-variable': 'variable',
  params: 'variable',
  symbol: 'symbol',
  bullet: 'symbol',
  link: 'symbol',
  section: 'symbol',
  emphasis: 'string',
  strong: 'keyword',
  formula: 'string',
  subst: 'variable',
  operator: 'symbol',
  punctuation: 'symbol',
};

function kindOf(classes: unknown): TokenKind | null {
  if (!Array.isArray(classes)) return null;
  for (const c of classes) {
    if (typeof c !== 'string') continue;
    const name = c.replace(/^hljs-/, '');
    const k = KIND_BY_CLASS[name] ?? KIND_BY_CLASS[name.split('.')[0]!];
    if (k) return k;
  }
  return null;
}

export function isSupported(lang: string | undefined): lang is string {
  return !!lang && lowlight.registered(lang);
}

/** Highlights `lines` as one snippet and returns spans per line (UTF-16 offsets within each line). */
export function highlightLines(lines: string[], lang: string): Span[][] {
  const out: Span[][] = lines.map(() => []);
  let tree;
  try {
    tree = lowlight.highlight(lang, lines.join('\n'));
  } catch {
    return out;
  }
  let line = 0;
  let col = 0;
  const emit = (text: string, kind: TokenKind | null) => {
    let rest = text;
    while (rest.length > 0) {
      const nl = rest.indexOf('\n');
      const chunk = nl < 0 ? rest : rest.slice(0, nl);
      if (chunk && kind) {
        const spans = out[line];
        const last = spans?.[spans.length - 1];
        if (last && last.kind === kind && last.end === col) last.end += chunk.length;
        else spans?.push({ start: col, end: col + chunk.length, kind });
      }
      col += chunk.length;
      if (nl < 0) break;
      line++;
      col = 0;
      rest = rest.slice(nl + 1);
    }
  };
  const walk = (nodes: readonly unknown[], inherited: TokenKind | null) => {
    for (const n of nodes) {
      const node = n as { type: string; value?: string; children?: unknown[]; properties?: { className?: unknown } };
      if (node.type === 'text') emit(node.value ?? '', inherited);
      else if (node.type === 'element') walk(node.children ?? [], kindOf(node.properties?.className) ?? inherited);
    }
  };
  walk(tree.children, null);
  return out;
}
