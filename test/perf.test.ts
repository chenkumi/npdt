import { expect, test } from 'vitest';
import { Session } from '../src/core/session.js';
import { InputParser } from '../src/input/parser.js';
import { renderFrame } from '../src/ui/frame.js';

// Budgets are deliberately loose (CI machines vary); they catch accidental O(n) per-keystroke work.
const LINES = 200_000;

function bigSession(): Session {
  const s = new Session({ autosave: false, persist: false });
  s.size = { cols: 120, rows: 40 };
  const text = Array.from({ length: LINES }, (_, i) => `const value${i} = compute(${i}, "text ${i}"); // comment ${i}`).join('\n');
  s.doc.insert(text);
  s.doc.moveTo({ line: 0, col: 0 });
  return s;
}

function time(fn: () => void, runs = 20): number {
  fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t) / runs;
}

test(`typing and rendering stay fast on ${LINES} lines`, () => {
  const s = bigSession();
  const parser = new InputParser();
  s.config = { ...s.config, syntaxHighlight: true };
  s.path = 'big.js';
  s.doc.moveTo({ line: 100_000, col: 5 });
  s.ensureCursorVisible();

  const render = time(() => renderFrame(s).rows());
  const type = time(() => {
    for (const ev of parser.feed('x')) s.handleInput(ev);
    renderFrame(s);
  });
  const down = time(() => {
    for (const ev of parser.feed('\x1b[B')) s.handleInput(ev);
  });
  console.log(`render ${render.toFixed(2)}ms, type+render ${type.toFixed(2)}ms, cursor down ${down.toFixed(2)}ms`);
  expect(render).toBeLessThan(60);
  expect(type).toBeLessThan(80);
  expect(down).toBeLessThan(30);
}, 60_000);

test('find panel counting on a large document stays interactive', () => {
  const s = bigSession();
  s.openFind(false);
  const t = performance.now();
  for (const ch of 'comment 1999') s.handleInput({ type: 'text', text: ch });
  const per = (performance.now() - t) / 12;
  console.log(`find keystroke ${per.toFixed(1)}ms, total=${s.find?.total}`);
  expect(s.find?.total).toBeGreaterThan(0);
  expect(per).toBeLessThan(400);
}, 60_000);
