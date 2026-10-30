import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KeyEvent } from '../input/parser.js';
import { t } from './i18n.js';
import type { Session } from './session.js';
import { TextField } from './text-field.js';

export interface FileEntry {
  name: string;
  dir: boolean;
}

export interface ConfirmDialog {
  kind: 'confirm';
  title: string;
  message: string;
  buttons: { label: string; hotkey: string; run: () => void | Promise<void> }[];
  index: number;
}

export interface PromptDialog {
  kind: 'prompt';
  title: string;
  label: string;
  field: TextField;
  error?: string;
  /** Return an error string to keep the dialog open. */
  onSubmit: (value: string) => string | void | Promise<string | void>;
}

export interface ListDialog {
  kind: 'list';
  title: string;
  items: { label: string; value: string; checked?: boolean }[];
  index: number;
  onPick: (value: string) => void | Promise<void>;
}

export interface InfoDialog {
  kind: 'info';
  title: string;
  lines: string[];
  scroll: number;
}

export interface FileDialog {
  kind: 'file';
  mode: 'open' | 'save';
  /** '' means the Windows drive list. */
  dir: string;
  entries: FileEntry[];
  index: number;
  name: TextField;
  focus: 'list' | 'name';
  error?: string;
  onPick: (file: string) => void | Promise<void>;
}

export type Dialog = ConfirmDialog | PromptDialog | ListDialog | InfoDialog | FileDialog;

// ---- file dialog helpers ----

export async function listDir(dir: string): Promise<FileEntry[]> {
  if (dir === '') {
    const drives: FileEntry[] = [];
    for (let c = 65; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`;
      if (await fs.access(d).then(() => true, () => false)) drives.push({ name: d, dir: true });
    }
    return drives;
  }
  const raw = await fs.readdir(dir, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of raw) {
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) isDir = await fs.stat(path.join(dir, d.name)).then((s) => s.isDirectory(), () => false);
    entries.push({ name: d.name, dir: isDir });
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  return entries;
}

function parentDir(dir: string): string {
  const parent = path.dirname(dir);
  if (parent !== dir) return parent;
  return process.platform === 'win32' ? '' : dir;
}

/** Entries as displayed: ".." first, then those matching the typed filter (open mode). */
export function visibleEntries(d: FileDialog): FileEntry[] {
  const filter = d.mode === 'open' ? d.name.value.toLowerCase() : '';
  const shown = filter ? d.entries.filter((e) => e.name.toLowerCase().includes(filter)) : d.entries;
  const up: FileEntry[] = d.dir === '' || (parentDir(d.dir) === d.dir) ? [] : [{ name: '..', dir: true }];
  return [...up, ...shown];
}

export async function openFileDialog(s: Session, mode: 'open' | 'save', onPick: (file: string) => void | Promise<void>, startPath?: string | null): Promise<void> {
  const start = startPath ? path.resolve(startPath) : path.resolve(process.cwd(), 'x');
  const dir = path.dirname(start);
  const dialog: FileDialog = {
    kind: 'file',
    mode,
    dir,
    entries: [],
    index: 0,
    name: new TextField(mode === 'save' && startPath ? path.basename(startPath) : ''),
    focus: mode === 'open' ? 'list' : 'name',
    onPick,
  };
  s.dialog = dialog;
  await chdir(s, dialog, dir);
}

async function chdir(s: Session, d: FileDialog, dir: string): Promise<void> {
  try {
    d.entries = await listDir(dir);
    d.dir = dir;
    d.index = 0;
    d.error = undefined;
    if (d.mode === 'open') d.name.set('');
  } catch (e) {
    d.error = (e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM' ? t('err.permission') : (e as Error).message;
  }
  s.emit();
}

// ---- key handling ----

export async function handleDialogKey(s: Session, d: Dialog, k: KeyEvent): Promise<void> {
  const plain = !k.ctrl && !k.alt && !k.super;
  switch (d.kind) {
    case 'confirm': {
      if (plain && (k.name === 'left' || (k.name === 'tab' && k.shift))) d.index = (d.index + d.buttons.length - 1) % d.buttons.length;
      else if (plain && (k.name === 'right' || k.name === 'tab')) d.index = (d.index + 1) % d.buttons.length;
      else if (k.name === 'escape') s.dialog = null;
      else if (k.name === 'return' || k.name === 'space') await pickButton(s, d, d.index);
      else {
        const i = d.buttons.findIndex((b) => b.hotkey === k.name);
        if (i >= 0 && !k.ctrl) await pickButton(s, d, i);
      }
      return;
    }
    case 'prompt': {
      if (k.name === 'escape') s.dialog = null;
      else if (k.name === 'return') {
        const err = await d.onSubmit(d.field.value);
        if (err) d.error = err;
        else if (s.dialog === d) s.dialog = null;
      } else if (d.field.key(k)) d.error = undefined;
      return;
    }
    case 'list': {
      const n = d.items.length;
      if (k.name === 'escape') s.dialog = null;
      else if (k.name === 'up') d.index = (d.index + n - 1) % n;
      else if (k.name === 'down') d.index = (d.index + 1) % n;
      else if (k.name === 'home') d.index = 0;
      else if (k.name === 'end') d.index = n - 1;
      else if (k.name === 'pageup') d.index = Math.max(d.index - 8, 0);
      else if (k.name === 'pagedown') d.index = Math.min(d.index + 8, n - 1);
      else if (k.name === 'return') await pickListItem(s, d, d.index);
      return;
    }
    case 'info': {
      if (k.name === 'escape' || k.name === 'return' || k.name === 'q') s.dialog = null;
      else if (k.name === 'up') d.scroll = Math.max(d.scroll - 1, 0);
      else if (k.name === 'down') d.scroll = Math.min(d.scroll + 1, Math.max(d.lines.length - 1, 0));
      else if (k.name === 'pageup') d.scroll = Math.max(d.scroll - 10, 0);
      else if (k.name === 'pagedown') d.scroll = Math.min(d.scroll + 10, Math.max(d.lines.length - 1, 0));
      return;
    }
    case 'file':
      return fileDialogKey(s, d, k);
  }
}

export async function pickButton(s: Session, d: ConfirmDialog, i: number): Promise<void> {
  const b = d.buttons[i];
  if (!b) return;
  if (s.dialog === d) s.dialog = null;
  await b.run();
}

export async function pickListItem(s: Session, d: ListDialog, i: number): Promise<void> {
  const item = d.items[i];
  if (!item) return;
  if (s.dialog === d) s.dialog = null;
  await d.onPick(item.value);
}

async function fileDialogKey(s: Session, d: FileDialog, k: KeyEvent): Promise<void> {
  const shown = visibleEntries(d);
  const clamp = () => {
    d.index = Math.min(Math.max(d.index, 0), Math.max(shown.length - 1, 0));
  };
  if (k.name === 'escape') {
    s.dialog = null;
    return;
  }
  if (k.name === 'tab') {
    d.focus = d.focus === 'list' ? 'name' : 'list';
    return;
  }
  if (k.name === 'up' || k.name === 'down' || k.name === 'pageup' || k.name === 'pagedown') {
    const delta = { up: -1, down: 1, pageup: -8, pagedown: 8 }[k.name];
    d.index += delta;
    clamp();
    d.focus = 'list';
    return;
  }
  if (k.name === 'backspace' && d.focus === 'list') {
    await chdir(s, d, parentDir(d.dir));
    return;
  }
  if (k.name === 'return') {
    const entry = d.focus === 'list' ? shown[d.index] : undefined;
    if (entry) {
      if (entry.dir) {
        await chdir(s, d, entry.name === '..' ? parentDir(d.dir) : path.join(d.dir, entry.name));
        return;
      }
      if (d.mode === 'open') return finishFile(s, d, path.join(d.dir, entry.name));
      d.name.set(entry.name);
      d.focus = 'name';
      return;
    }
    const typed = d.name.value.trim();
    if (!typed) return;
    const full = path.resolve(d.dir || process.cwd(), typed);
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isDirectory()) return chdir(s, d, full);
    // Open mode: the text is a filter, so Enter picks the highlighted match when it is not an exact name.
    if (d.mode === 'open' && !stat) {
      const match = shown.find((e) => e.name !== '..');
      if (match) {
        const chosen = shown[d.index] && shown[d.index]!.name !== '..' ? shown[d.index]! : match;
        if (chosen.dir) return chdir(s, d, path.join(d.dir, chosen.name));
        return finishFile(s, d, path.join(d.dir, chosen.name));
      }
    }
    return finishFile(s, d, full);
  }
  if (d.focus === 'name') {
    if (d.name.key(k)) {
      d.error = undefined;
      d.index = 0;
    }
  }
}

async function finishFile(s: Session, d: FileDialog, file: string): Promise<void> {
  if (s.dialog === d) s.dialog = null;
  await d.onPick(file);
}

/** Handles printable text typed (or pasted) while a dialog is open. */
export async function dialogText(s: Session, d: Dialog, text: string): Promise<void> {
  if (d.kind === 'prompt') {
    d.field.insert(text);
    d.error = undefined;
  } else if (d.kind === 'file') {
    d.focus = 'name';
    d.name.insert(text);
    d.error = undefined;
    d.index = 0;
  } else if (d.kind === 'confirm') {
    const i = d.buttons.findIndex((b) => b.hotkey === text.toLowerCase());
    if (i >= 0) await pickButton(s, d, i);
  }
}
