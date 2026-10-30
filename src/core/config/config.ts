import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { dataDir } from './paths.js';

import { LOCALE_IDS } from '../i18n.js';

export const THEME_IDS = ['light', 'dark', 'contrast'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const LANGUAGE_IDS = ['auto', ...LOCALE_IDS] as [string, ...string[]];

const schema = z.object({
  /** "classic" is the pre-1.1 name of the light theme. */
  theme: z.preprocess((v) => (v === 'classic' ? 'light' : v), z.enum(THEME_IDS)).default('dark'),
  language: z.enum(LANGUAGE_IDS).default('en'),
  tabSize: z.number().int().min(1).max(16).default(4),
  insertSpaces: z.boolean().default(true),
  wordWrap: z.boolean().default(false),
  /** Reload the file automatically when it changes on disk and there are no unsaved edits. */
  autoReload: z.boolean().default(true),
  showLineNumbers: z.boolean().default(true),
  showWhitespace: z.boolean().default(false),
  highlightCurrentLine: z.boolean().default(true),
  syntaxHighlight: z.boolean().default(true),
  autoIndent: z.boolean().default(true),
  mouse: z.boolean().default(true),
  kittyKeyboard: z.boolean().default(true),
  recentFilesMax: z.number().int().min(0).max(50).default(10),
  /** Overrides, e.g. { "ctrl+b": "file.save", "ctrl+t": "none" }. */
  keymap: z.record(z.string(), z.string()).default({}),
});

export type Config = z.infer<typeof schema>;

export const DEFAULT_CONFIG: Config = schema.parse({});

export interface LoadedConfig {
  config: Config;
  /** Human-readable problems; the affected settings fall back to defaults. */
  warnings: string[];
}

export function configPath(): string {
  return path.join(dataDir(), 'config.json');
}

/** Reads config.json; invalid values never abort startup. */
export async function loadConfig(): Promise<LoadedConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(configPath(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { config: DEFAULT_CONFIG, warnings: [] };
    return { config: DEFAULT_CONFIG, warnings: [`Config file could not be parsed; using defaults (${configPath()})`] };
  }
  return parseConfig(raw);
}

export function parseConfig(raw: unknown): LoadedConfig {
  const warnings: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config: DEFAULT_CONFIG, warnings: ['Config file is malformed; using defaults'] };
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.shape)) {
    if (!(name in input)) continue;
    const r = (field as z.ZodType).safeParse(input[name]);
    if (r.success) out[name] = r.data;
    else warnings.push(`Setting "${name}" is invalid; using its default`);
  }
  return { config: schema.parse(out), warnings };
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2));
}

// ---- recent files (state.json) ----

function statePath(): string {
  return path.join(dataDir(), 'state.json');
}

/** Where the cursor and scroll position were when a file was last closed. */
export interface ViewState {
  line: number;
  col: number;
  top: number;
}

export interface AppState {
  recent: string[];
  views: Record<string, ViewState>;
}

export const MAX_VIEWS = 200;

export async function loadState(): Promise<AppState> {
  const state: AppState = { recent: [], views: {} };
  try {
    const data = JSON.parse(await fs.readFile(statePath(), 'utf8')) as { recent?: unknown; views?: unknown };
    if (Array.isArray(data.recent)) state.recent = data.recent.filter((p): p is string => typeof p === 'string');
    if (typeof data.views === 'object' && data.views !== null) {
      for (const [file, v] of Object.entries(data.views)) {
        const o = v as Partial<ViewState> | null;
        if (o && [o.line, o.col, o.top].every((n) => Number.isInteger(n) && (n as number) >= 0)) {
          state.views[file] = { line: o.line!, col: o.col!, top: o.top! };
        }
      }
    }
  } catch {
    /* missing or unreadable: start fresh */
  }
  return state;
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(statePath(), JSON.stringify(state));
  } catch {
    /* non-critical */
  }
}
