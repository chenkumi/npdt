import os from 'node:os';
import path from 'node:path';

/** Directory holding config.json / state.json / recovery files. NPDT_HOME overrides (used by tests). */
export function dataDir(): string {
  if (process.env.NPDT_HOME) return process.env.NPDT_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npdt');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'npdt');
}
