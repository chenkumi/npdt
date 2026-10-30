import { expect, test } from 'vitest';
import { InputParser, keyId, type InputEvent } from '../src/input/parser.js';

const parse = (s: string, p = new InputParser()): InputEvent[] => p.feed(s);
const ids = (s: string) => parse(s).map((e) => (e.type === 'key' ? keyId(e) : e.type));

test('plain text is batched', () => {
  expect(parse('abc中')).toEqual([{ type: 'text', text: 'abc中' }]);
});

test('control keys', () => {
  expect(ids('\x0b')).toEqual(['ctrl+k']);
  expect(ids('\x11')).toEqual(['ctrl+q']);
  expect(ids('\r')).toEqual(['return']);
  expect(ids('\t')).toEqual(['tab']);
  expect(ids('\x7f')).toEqual(['backspace']);
  expect(ids('\x08')).toEqual(['ctrl+backspace']);
  expect(ids('\x1b')).toEqual(['escape']);
});

test('arrows, modifiers, function keys', () => {
  expect(ids('\x1b[A\x1b[1;5C\x1b[1;2B')).toEqual(['up', 'ctrl+right', 'shift+down']);
  expect(ids('\x1b[3~\x1b[5~\x1b[Z')).toEqual(['delete', 'pageup', 'shift+tab']);
  expect(ids('\x1bOP\x1b[13~\x1b[21~\x1b[24;2~')).toEqual(['f1', 'f3', 'f10', 'shift+f12']);
});

test('alt combos', () => {
  expect(ids('\x1bk')).toEqual(['alt+k']);
  expect(ids('\x1b\x7f')).toEqual(['alt+backspace']);
});

test('kitty and modifyOtherKeys', () => {
  expect(ids('\x1b[107;6u')).toEqual(['ctrl+shift+k']);
  expect(ids('\x1b[27;6;75~')).toEqual(['ctrl+shift+k']);
  expect(ids('\x1b[104;5u')).toEqual(['ctrl+h']);
});

test('sgr mouse', () => {
  expect(parse('\x1b[<0;10;5M\x1b[<0;10;5m\x1b[<32;11;5M\x1b[<64;1;1M\x1b[<65;1;1M')).toMatchObject([
    { kind: 'down', button: 'left', x: 9, y: 4 },
    { kind: 'up', button: 'left' },
    { kind: 'drag', x: 10 },
    { kind: 'wheelUp' },
    { kind: 'wheelDown' },
  ]);
});

test('bracketed paste across chunks, with partial terminator', () => {
  const p = new InputParser();
  expect(p.feed('\x1b[200~hello\nwo')).toEqual([]);
  expect(p.feed('rld\x1b[20')).toEqual([]);
  expect(p.feed('1~x')).toEqual([
    { type: 'paste', text: 'hello\nworld' },
    { type: 'text', text: 'x' },
  ]);
});

test('incomplete CSI waits for the rest', () => {
  const p = new InputParser();
  expect(p.feed('\x1b[1;')).toEqual([]);
  expect(p.feed('5A').map((e) => (e.type === 'key' ? keyId(e) : ''))).toEqual(['ctrl+up']);
});

test('escape directly followed by another sequence stays a plain escape', () => {
  expect(ids('\x1b\x1b[21~')).toEqual(['escape', 'f10']);
  expect(ids('\x1b\x1b')).toEqual(['alt+escape']);
});
