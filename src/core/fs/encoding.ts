import chardet from 'chardet';
import iconv from 'iconv-lite';

export type EncodingId = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'big5' | 'gbk' | 'shift_jis' | 'euc-kr' | 'latin1';

export const ENCODINGS: { id: EncodingId; label: string; codec: string; bom?: Buffer }[] = [
  { id: 'utf8', label: 'UTF-8', codec: 'utf8' },
  { id: 'utf8bom', label: 'UTF-8 BOM', codec: 'utf8', bom: Buffer.from([0xef, 0xbb, 0xbf]) },
  { id: 'utf16le', label: 'UTF-16 LE BOM', codec: 'utf16le', bom: Buffer.from([0xff, 0xfe]) },
  { id: 'utf16be', label: 'UTF-16 BE BOM', codec: 'utf16-be', bom: Buffer.from([0xfe, 0xff]) },
  { id: 'big5', label: 'Big5 (Traditional Chinese)', codec: 'big5' },
  { id: 'gbk', label: 'GBK (Simplified Chinese)', codec: 'gbk' },
  { id: 'shift_jis', label: 'Shift-JIS (Japanese)', codec: 'shift_jis' },
  { id: 'euc-kr', label: 'EUC-KR (Korean)', codec: 'euc-kr' },
  { id: 'latin1', label: 'Windows-1252 (Latin)', codec: 'win1252' },
];

/** Short name for the status bar. */
export function encodingLabel(id: EncodingId): string {
  return ENCODINGS.find((e) => e.id === id)?.label.split(' (')[0] ?? id;
}

function info(id: EncodingId) {
  return ENCODINGS.find((e) => e.id === id)!;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

const CHARDET_MAP: Record<string, EncodingId> = {
  big5: 'big5',
  gb18030: 'gbk',
  gb2312: 'gbk',
  gbk: 'gbk',
  shift_jis: 'shift_jis',
  'euc-kr': 'euc-kr',
  'utf-16le': 'utf16le',
  'utf-16be': 'utf16be',
};

export function detectEncoding(buf: Buffer): EncodingId {
  for (const e of ENCODINGS) {
    if (e.bom && buf.length >= e.bom.length && buf.subarray(0, e.bom.length).equals(e.bom)) return e.id;
  }
  try {
    strictUtf8.decode(buf);
    return 'utf8';
  } catch {
    const guess = chardet.detect(buf)?.toLowerCase() ?? '';
    return CHARDET_MAP[guess] ?? 'latin1';
  }
}

export function decode(buf: Buffer, id: EncodingId): string {
  const e = info(id);
  if (e.bom && buf.subarray(0, e.bom.length).equals(e.bom)) buf = buf.subarray(e.bom.length);
  return iconv.decode(buf, e.codec);
}

export function encode(text: string, id: EncodingId): Buffer {
  const e = info(id);
  const body = iconv.encode(text, e.codec);
  return e.bom ? Buffer.concat([e.bom, body]) : body;
}

/** True when `text` survives an encode/decode round trip in `id` (no lossy replacement). */
export function canEncode(text: string, id: EncodingId): boolean {
  if (id.startsWith('utf')) return true;
  return decode(encode(text, id), id) === text;
}
