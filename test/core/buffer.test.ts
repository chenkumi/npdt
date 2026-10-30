import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { Document } from '../../src/core/buffer/document.js';
import { TextBuffer } from '../../src/core/buffer/text-buffer.js';

describe('TextBuffer', () => {
  test('normalizes CRLF and tracks length', () => {
    const b = new TextBuffer('a\r\nbc\rd');
    expect(b.getText()).toBe('a\nbc\nd');
    expect(b.lineCount).toBe(3);
    expect(b.length).toBe(6);
  });

  test('multi-line insert and delete', () => {
    const b = new TextBuffer('hello world');
    b.apply(b.insertEdit({ line: 0, col: 5 }, '\nX\n'));
    expect(b.getText()).toBe('hello\nX\n world');
    b.apply(b.deleteEdit({ line: 0, col: 3 }, { line: 2, col: 1 }));
    expect(b.getText()).toBe('helworld');
    expect(b.length).toBe(8);
  });

  test('offset <-> pos round trip', () => {
    const b = new TextBuffer('ab\n\ncde');
    for (let o = 0; o <= b.length; o++) expect(b.posToOffset(b.offsetToPos(o))).toBe(o);
  });
});

describe('Document', () => {
  test('typing merges into one undo step; movement splits it', () => {
    const d = new Document();
    for (const ch of 'abc') d.insert(ch);
    d.move('left');
    d.insert('X');
    expect(d.text).toBe('abXc');
    d.undo();
    expect(d.text).toBe('abc');
    d.undo();
    expect(d.text).toBe('');
    d.redo();
    d.redo();
    expect(d.text).toBe('abXc');
  });

  test('backspace joins lines and deletes whole graphemes', () => {
    const d = new Document('a\n👨‍👩‍👧');
    d.move('docEnd');
    d.backspace();
    expect(d.text).toBe('a\n');
    d.backspace();
    expect(d.text).toBe('a');
  });

  test('selection replace is a single undo step', () => {
    const d = new Document('hello world');
    d.moveTo({ line: 0, col: 0 });
    d.move('right', true);
    d.move('right', true);
    expect(d.selectedText()).toBe('he');
    d.insert('J');
    expect(d.text).toBe('Jllo world');
    d.undo();
    expect(d.text).toBe('hello world');
    expect(d.selectedText()).toBe('he');
  });

  test('up/down keeps display column across CJK lines', () => {
    const d = new Document('中文字\nabcdef\n中文字');
    d.moveTo({ line: 0, col: 2 }); // width 4
    d.move('down');
    expect(d.cursor).toEqual({ line: 1, col: 4 });
    d.move('down');
    expect(d.cursor).toEqual({ line: 2, col: 2 });
  });

  test('up at first line goes to start, down at last goes to end', () => {
    const d = new Document('ab\ncd');
    d.moveTo({ line: 0, col: 1 });
    d.move('up');
    expect(d.cursor).toEqual({ line: 0, col: 0 });
    d.move('down');
    d.move('down');
    expect(d.cursor).toEqual({ line: 1, col: 2 });
  });

  test('left/right collapse a selection to its edges', () => {
    const d = new Document('abcd');
    d.moveTo({ line: 0, col: 1 });
    d.move('right', true);
    d.move('right', true);
    d.move('left');
    expect(d.cursor).toEqual({ line: 0, col: 1 });
    expect(d.selection()).toBeNull();
  });
});

type Op =
  | { t: 'insert'; s: string }
  | { t: 'back' }
  | { t: 'del' }
  | { t: 'move'; m: 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd'; ext: boolean }
  | { t: 'selAll' };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('insert' as const), s: fc.string({ unit: fc.constantFrom('a', 'b', ' ', '\n', '中', '😀', 'é'), maxLength: 4 }) }),
  fc.constant({ t: 'back' as const }),
  fc.constant({ t: 'del' as const }),
  fc.record({
    t: fc.constant('move' as const),
    m: fc.constantFrom('left', 'right', 'up', 'down', 'lineStart', 'lineEnd'),
    ext: fc.boolean(),
  }),
  fc.constant({ t: 'selAll' as const }),
);

function run(d: Document, o: Op): void {
  if (o.t === 'insert') d.insert(o.s);
  else if (o.t === 'back') d.backspace();
  else if (o.t === 'del') d.deleteForward();
  else if (o.t === 'move') d.move(o.m, o.ext);
  else d.selectAll();
}

describe('Document properties', () => {
  test('undo-all restores the initial text; redo-all restores the final text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.array(op, { maxLength: 60 }), (init, ops) => {
        const d = new Document(init);
        const start = d.text;
        for (const o of ops) run(d, o);
        const end = d.text;
        while (d.undo());
        expect(d.text).toBe(start);
        while (d.redo());
        expect(d.text).toBe(end);
      }),
      { numRuns: 300 },
    );
  });

  test('buffer matches a plain-string model and stays consistent', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.array(fc.tuple(fc.nat(60), fc.nat(60), fc.string({ maxLength: 6 })), { maxLength: 40 }),
        (init, edits) => {
          const b = new TextBuffer(init);
          let model = b.getText();
          for (const [a, len, ins] of edits) {
            const from = Math.min(a, model.length);
            const to = Math.min(from + len, model.length);
            const e = { start: b.offsetToPos(from), removed: model.slice(from, to), inserted: ins.replace(/\r\n?/g, '\n') };
            b.apply(e);
            model = model.slice(0, from) + e.inserted + model.slice(to);
            expect(b.getText()).toBe(model);
            expect(b.length).toBe(model.length);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('cursor always stays inside the buffer', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const d = new Document('ab\n中\n');
        for (const o of ops) {
          run(d, o);
          expect(d.buffer.clamp(d.cursor)).toEqual(d.cursor);
        }
      }),
      { numRuns: 300 },
    );
  });
});
