import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { canEncode, decode, detectEncoding, encode, type EncodingId } from './encoding.js';
import { applyEol, detectEol, platformEol, type Eol } from './eol.js';
import { t } from '../i18n.js';
import { MODE_MASK } from './permissions.js';

export const WARN_SIZE = 10 * 1024 * 1024;
export const MAX_SIZE = 100 * 1024 * 1024;

export interface LoadedFile {
  /** Text with '\n' line endings. */
  text: string;
  encoding: EncodingId;
  eol: Eol;
  /** False when the file does not exist yet (it is created on first save). */
  exists: boolean;
  mtimeMs: number | null;
  readOnly: boolean;
  /** Permission bits (`mode & 0o777`); null when the file does not exist yet. */
  mode: number | null;
  large: boolean;
}

export class FileError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function loadFile(file: string, forcedEncoding?: EncodingId): Promise<LoadedFile> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { text: '', encoding: forcedEncoding ?? 'utf8', eol: platformEol(), exists: false, mtimeMs: null, readOnly: false, mode: null, large: false };
    }
    throw new FileError(errorMessage(e), (e as NodeJS.ErrnoException).code ?? 'EIO');
  }
  if (stat.isDirectory()) throw new FileError(t('err.folder', { path: file }), 'EISDIR');
  if (stat.size > MAX_SIZE) {
    throw new FileError(t('err.tooBig', { mb: Math.round(stat.size / 1048576), max: MAX_SIZE / 1048576 }), 'ETOOBIG');
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch (e) {
    throw new FileError(errorMessage(e), (e as NodeJS.ErrnoException).code ?? 'EIO');
  }
  const encoding = forcedEncoding ?? detectEncoding(buf);
  const raw = decode(buf, encoding);
  const eol = detectEol(raw);
  const text = raw.replace(/\r\n?/g, '\n');
  const readOnly = await isReadOnly(file);
  return { text, encoding, eol, exists: true, mtimeMs: stat.mtimeMs, readOnly, mode: stat.mode & MODE_MASK, large: stat.size > WARN_SIZE };
}

export function isReadOnly(file: string): Promise<boolean> {
  return fs.access(file, constants.W_OK).then(() => false, () => true);
}

export async function getMode(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mode & MODE_MASK;
  } catch {
    return null;
  }
}

export async function setMode(file: string, mode: number): Promise<void> {
  try {
    await fs.chmod(file, mode);
  } catch (e) {
    throw new FileError(errorMessage(e), (e as NodeJS.ErrnoException).code ?? 'EIO');
  }
}

export async function getMtime(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** Writes via a temp file in the same directory, then renames over the target. Returns the new mtime. */
export async function saveFile(file: string, text: string, encoding: EncodingId, eol: Eol): Promise<number> {
  if (!canEncode(text, encoding)) throw new FileError(t('err.encode'), 'ENCODE');
  const data = encode(applyEol(text, eol), encoding);

  let target = file;
  let mode: number | undefined;
  try {
    target = await fs.realpath(file);
    mode = (await fs.stat(target)).mode;
  } catch {
    /* new file */
  }

  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString('hex')}.npdt-tmp`);
  try {
    const fh = await fs.open(tmp, 'w', mode !== undefined ? mode & 0o777 : 0o666);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await fs.rename(tmp, target);
    } catch (e) {
      // Windows refuses to replace files that are open elsewhere; fall back to an in-place write.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e;
      await fs.writeFile(target, data);
      await fs.rm(tmp, { force: true });
    }
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new FileError(errorMessage(e), (e as NodeJS.ErrnoException).code ?? 'EIO');
  }
  return (await fs.stat(target)).mtimeMs;
}

function errorMessage(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  switch (err.code) {
    case 'EACCES':
    case 'EPERM':
      return t('err.permission');
    case 'ENOENT':
      return t('err.notFound');
    case 'EISDIR':
      return t('err.isDir');
    case 'ENOSPC':
      return t('err.noSpace');
    default:
      return err.message;
  }
}
