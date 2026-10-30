import { expect, test } from 'vitest';
import { Document } from '../src/core/buffer/document.js';
import { TextBuffer } from '../src/core/buffer/text-buffer.js';
import { buildMatcher, countMatches, findMatch, replaceAllEdits } from '../src/core/search/search.js';
import { highlightLines } from '../src/core/syntax.js';
import { parseConfig } from '../src/core/config/config.js';

const opts = { query: 'ab', caseSensitive: false, wholeWord: false, regex: false };
const re = (o = {}) => {
  const m = buildMatcher({ ...opts, ...o });
  if (!m || 'error' in m) throw new Error('bad');
  return m.re;
};

test('forward/backward with wrap', () => {
  const b = new TextBuffer('ab x ab\nzz\nAB');
  expect(findMatch(b, re(), { line: 0, col: 0 }, false, true)).toMatchObject({ line: 0, start: 0 });
  expect(findMatch(b, re(), { line: 0, col: 1 }, false, true)).toMatchObject({ line: 0, start: 5 });
  expect(findMatch(b, re(), { line: 2, col: 1 }, false, true)).toMatchObject({ line: 0, start: 0 });
  expect(findMatch(b, re(), { line: 2, col: 1 }, false, false)).toBeNull();
  expect(findMatch(b, re(), { line: 0, col: 0 }, true, true)).toMatchObject({ line: 2, start: 0 });
  expect(findMatch(b, re(), { line: 0, col: 6 }, true, true)).toMatchObject({ line: 0, start: 5 });
});

test('single match wraps onto itself', () => {
  const b = new TextBuffer('xx ab xx');
  expect(findMatch(b, re(), { line: 0, col: 4 }, false, true)).toMatchObject({ start: 3 });
});

test('options and counting', () => {
  const b = new TextBuffer('ab abc ab');
  expect(countMatches(b, re(), { line: 0, col: 4 })).toEqual({ total: 3, before: 2 });
  expect(countMatches(b, re({ wholeWord: true }), { line: 0, col: 0 }).total).toBe(2);
  expect(countMatches(b, re({ caseSensitive: true, query: 'AB' }), { line: 0, col: 0 }).total).toBe(0);
  expect('error' in (buildMatcher({ ...opts, regex: true, query: '(' }) as object)).toBe(true);
});

test('replace all is one undo step, supports $1', () => {
  const d = new Document('a1 b2\nc3');
  const r = re({ regex: true, query: String.raw`([a-z])(\d)` });
  d.applyEdits(replaceAllEdits(d.buffer, r, '$2$1', true));
  expect(d.text).toBe('1a 2b\n3c');
  d.undo();
  expect(d.text).toBe('a1 b2\nc3');
});

test('syntax spans per line', () => {
  const lines = ['const a = 1; /* x', 'y */ "s"'];
  const spans = highlightLines(lines, 'javascript');
  expect(spans[0]!.some((s) => s.kind === 'keyword' && s.start === 0)).toBe(true);
  expect(spans[0]!.some((s) => s.kind === 'comment')).toBe(true);
  expect(spans[1]!.some((s) => s.kind === 'comment' && s.start === 0)).toBe(true);
  expect(spans[1]!.some((s) => s.kind === 'string')).toBe(true);
});

test('bad config values fall back individually', () => {
  const { config, warnings } = parseConfig({ tabSize: 99, theme: 'dark', wordWrap: 'yes' });
  expect(config.tabSize).toBe(4);
  expect(config.theme).toBe('dark');
  expect(config.wordWrap).toBe(false);
  expect(warnings).toHaveLength(2);
});
