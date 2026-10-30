import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canEncode, detectEncoding } from '../../src/core/fs/encoding.js';
import { applyEol, detectEol } from '../../src/core/fs/eol.js';
import { loadFile, saveFile } from '../../src/core/fs/file-io.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'npdt-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

test('detects BOMs, utf8, and legacy CJK encodings', () => {
  expect(detectEncoding(Buffer.from('hello'))).toBe('utf8');
  expect(detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')]))).toBe('utf8bom');
  expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe('utf16le');
  const big5 = iconv.encode('這是一段繁體中文測試文字，用來偵測編碼。', 'big5');
  expect(detectEncoding(big5)).toBe('big5');
});

test('eol detection and conversion', () => {
  expect(detectEol('a\r\nb\r\nc\n')).toBe('crlf');
  expect(detectEol('a\nb\n')).toBe('lf');
  expect(detectEol('a\rb\r')).toBe('cr');
  expect(applyEol('a\nb', 'crlf')).toBe('a\r\nb');
});

test('missing file loads empty and is not created', async () => {
  const f = path.join(dir, 'new.txt');
  const r = await loadFile(f);
  expect(r.exists).toBe(false);
  expect(r.text).toBe('');
  expect(await readdir(dir)).not.toContain('new.txt');
});

test('round trip keeps encoding and line endings', async () => {
  const f = path.join(dir, 'rt.txt');
  await writeFile(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('一\r\n二\r\n')]));
  const r = await loadFile(f);
  expect(r).toMatchObject({ text: '一\n二\n', encoding: 'utf8bom', eol: 'crlf', exists: true });
  await saveFile(f, r.text + '三', r.encoding, r.eol);
  const bytes = await readFile(f);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString()).toBe('一\r\n二\r\n三');
  expect((await readdir(dir)).filter((n) => n.endsWith('.npdt-tmp'))).toEqual([]);
});

test('refuses lossy encodings', async () => {
  expect(canEncode('abc', 'latin1')).toBe(true);
  expect(canEncode('中', 'latin1')).toBe(false);
  await expect(saveFile(path.join(dir, 'x.txt'), '中', 'latin1', 'lf')).rejects.toThrow();
});

test('directory is rejected', async () => {
  await expect(loadFile(dir)).rejects.toThrow();
});
