import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config/paths.js';

export interface RecoveryData {
  path: string | null;
  text: string;
  savedAt: number;
}

function recoveryFile(file: string | null): string {
  const key = createHash('sha1').update(file ? path.resolve(file) : '<untitled>').digest('hex').slice(0, 16);
  return path.join(dataDir(), 'recovery', `${key}.json`);
}

export async function writeRecovery(file: string | null, text: string): Promise<void> {
  const target = recoveryFile(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const data: RecoveryData = { path: file ? path.resolve(file) : null, text, savedAt: Date.now() };
  await fs.writeFile(target, JSON.stringify(data));
}

export async function readRecovery(file: string | null): Promise<RecoveryData | null> {
  try {
    return JSON.parse(await fs.readFile(recoveryFile(file), 'utf8')) as RecoveryData;
  } catch {
    return null;
  }
}

export async function clearRecovery(file: string | null): Promise<void> {
  await fs.rm(recoveryFile(file), { force: true }).catch(() => {});
}
