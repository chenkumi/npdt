import stringWidth from 'string-width';
import { displayWidth, getTabSize } from './buffer/graphemes.js';
import type { Motion } from './buffer/document.js';
import { SPECIAL_CATEGORIES, type SpecialCategory } from './buffer/specials.js';
import { advance, type Edit, type Pos } from './buffer/types.js';
import { THEME_IDS, type ThemeId } from './config/config.js';
import { openFileDialog } from './dialogs.js';
import { ENCODINGS, type EncodingId } from './fs/encoding.js';
import type { Eol } from './fs/eol.js';
import { formatMode, formatOctal, parseOctal, WIN_READ_ONLY, WIN_READ_WRITE } from './fs/permissions.js';
import { LOCALES, t } from './i18n.js';
import { LANGUAGES } from './lang.js';
import { isSupported } from './syntax.js';
import { MENUS } from './menus.js';
import type { Session } from './session.js';
import { TextField } from './text-field.js';

export interface Command {
  run(s: Session, arg?: unknown): void | Promise<void>;
  enabled?(s: Session): boolean;
}

export const COMMANDS: Record<string, Command> = {};

function def(id: string, run: Command['run'], enabled?: Command['enabled']): void {
  COMMANDS[id] = { run, enabled };
}

// ---- helpers ----

function lineRange(s: Session): { first: number; last: number } {
  const sel = s.doc.selection();
  if (!sel) return { first: s.doc.cursor.line, last: s.doc.cursor.line };
  let last = sel.end.line;
  if (sel.end.col === 0 && last > sel.start.line) last--;
  return { first: sel.start.line, last };
}

function linesOf(s: Session, first: number, last: number): string[] {
  const out: string[] = [];
  for (let i = first; i <= last; i++) out.push(s.doc.buffer.line(i));
  return out;
}

/** Moves a position through single-line edits (none of them contain newlines). */
function shiftPos(p: Pos, edits: Edit[]): Pos {
  let col = p.col;
  for (const e of edits) {
    if (e.start.line !== p.line) continue;
    const end = e.start.col + e.removed.length;
    if (p.col >= end) col += e.inserted.length - e.removed.length;
    else if (p.col > e.start.col) col = e.start.col + e.inserted.length;
  }
  return { line: p.line, col: Math.max(col, 0) };
}

/** Applies single-line edits and keeps cursor/selection anchored to the same text. */
function applyLineEdits(s: Session, edits: Edit[]): void {
  if (edits.length === 0) return;
  const cursor = shiftPos(s.doc.cursor, edits);
  const anchor = s.doc.anchor ? shiftPos(s.doc.anchor, edits) : null;
  s.doc.applyEdits(edits, cursor, anchor);
}

function indentUnit(s: Session): string {
  return s.config.insertSpaces ? ' '.repeat(getTabSize()) : '\t';
}

const leading = (t: string): string => /^[ \t]*/.exec(t)![0];

function hasSelection(s: Session): boolean {
  return s.doc.selection() !== null;
}

// ---- file ----

def('file.new', (s) => s.guardUnsaved(() => s.newDocument()));
def('file.close', (s) => s.guardUnsaved(() => s.newDocument()));
def('file.open', (s) =>
  s.guardUnsaved(() =>
    openFileDialog(s, 'open', (file) => s.openPath(file), s.path),
  ),
);
def('file.recent', (s) => {
  if (s.recent.length === 0) {
    s.flash(t('msg.noRecent'), 'warn');
    return;
  }
  s.dialog = {
    kind: 'list',
    title: t('dlg.recentTitle'),
    items: s.recent.map((p) => ({ label: p, value: p })),
    index: 0,
    onPick: (p) => void s.guardUnsaved(() => s.openPath(p)),
  };
});
def('file.save', async (s) => void (await s.save()));
def('file.saveAs', (s) => s.saveAsDialog());
def(
  'file.permissions',
  (s) => {
    const mode = s.mode!;
    if (process.platform === 'win32') {
      const writable = (mode & 0o200) !== 0;
      s.dialog = {
        kind: 'list',
        title: t('dlg.permTitle'),
        items: [
          { label: t('perm.rw'), value: 'rw', checked: writable },
          { label: t('perm.ro'), value: 'ro', checked: !writable },
        ],
        index: writable ? 0 : 1,
        onPick: (v) => s.setPermissions(v === 'rw' ? WIN_READ_WRITE : WIN_READ_ONLY),
      };
      return;
    }
    s.dialog = {
      kind: 'prompt',
      title: t('dlg.permTitle'),
      label: t('dlg.permLabel', { mode: formatMode(mode) }),
      field: new TextField(formatOctal(mode)),
      onSubmit: async (value) => {
        const parsed = parseOctal(value);
        if (parsed === null) return t('dlg.permInvalid');
        await s.setPermissions(parsed);
      },
    };
  },
  (s) => s.mode !== null,
);
def('app.quit', (s) => s.quit());

// ---- cursor ----

def('cursor.move', (s, arg) => {
  const { motion, extend } = arg as { motion: Motion | 'pageUp' | 'pageDown'; extend: boolean };
  if (motion === 'pageUp' || motion === 'pageDown') {
    const h = Math.max(s.layout().editor.h - 1, 1);
    s.doc.moveLines(motion === 'pageUp' ? -h : h, extend);
    s.scrollBy(motion === 'pageUp' ? -h : h);
    return;
  }
  s.doc.move(motion, extend);
});

// ---- edit: basics ----

def('edit.undo', (s) => void s.doc.undo(), (s) => s.doc.history.canUndo);
def('edit.redo', (s) => void s.doc.redo(), (s) => s.doc.history.canRedo);
def('edit.selectAll', (s) => s.doc.selectAll());
def('edit.toggleOverwrite', (s) => {
  s.overwrite = !s.overwrite;
});
def('edit.escape', (s) => {
  if (s.find) s.closeFind();
  else if (hasSelection(s)) s.doc.moveTo(s.doc.cursor);
});
def('edit.backspace', (s) => s.doc.backspace());
def('edit.delete', (s) => s.doc.deleteForward());
def('edit.deleteWordLeft', (s) => {
  if (!hasSelection(s)) s.doc.move('wordLeft', true);
  s.doc.deleteSelection();
});
def('edit.deleteWordRight', (s) => {
  if (!hasSelection(s)) s.doc.move('wordRight', true);
  s.doc.deleteSelection();
});

def('edit.newline', (s) => {
  if (!s.config.autoIndent) return s.doc.insert('\n');
  const at = s.doc.selection()?.start ?? s.doc.cursor;
  s.doc.insert('\n' + leading(s.doc.buffer.line(at.line).slice(0, at.col)));
});

// ---- edit: clipboard ----

def('edit.copy', async (s) => {
  const text = hasSelection(s) ? s.doc.selectedText() : s.doc.buffer.line(s.doc.cursor.line) + '\n';
  await s.clipboard.write(text);
});
def('edit.cut', async (s) => {
  if (hasSelection(s)) {
    await s.clipboard.write(s.doc.selectedText());
    s.doc.deleteSelection();
    return;
  }
  const line = s.doc.cursor.line;
  await s.clipboard.write(s.doc.buffer.line(line) + '\n');
  deleteLines(s, line, line);
});
def('edit.paste', async (s) => {
  const text = await s.clipboard.read();
  if (text) s.doc.insert(text);
});

// ---- edit: lines ----

function deleteLines(s: Session, first: number, last: number): void {
  const b = s.doc.buffer;
  let start: Pos;
  let end: Pos;
  if (last < b.lineCount - 1) {
    start = { line: first, col: 0 };
    end = { line: last + 1, col: 0 };
  } else if (first > 0) {
    start = { line: first - 1, col: b.line(first - 1).length };
    end = { line: last, col: b.line(last).length };
  } else {
    start = { line: 0, col: 0 };
    end = { line: last, col: b.line(last).length };
  }
  s.doc.applyEdits([b.deleteEdit(start, end)], { line: Math.min(first, b.lineCount - 1 - (last - first)), col: 0 });
}

def('edit.deleteLine', (s) => {
  const { first, last } = lineRange(s);
  deleteLines(s, first, last);
});

def('edit.duplicateLine', (s) => {
  const { first, last } = lineRange(s);
  const b = s.doc.buffer;
  const block = linesOf(s, first, last).join('\n');
  const n = last - first + 1;
  const edit = b.insertEdit({ line: last, col: b.line(last).length }, '\n' + block);
  const shift = (p: Pos): Pos => ({ line: p.line + n, col: p.col });
  s.doc.applyEdits([edit], shift(s.doc.cursor), s.doc.anchor ? shift(s.doc.anchor) : null);
});

function moveLines(s: Session, dir: -1 | 1): void {
  const { first, last } = lineRange(s);
  const b = s.doc.buffer;
  if ((dir < 0 && first === 0) || (dir > 0 && last >= b.lineCount - 1)) return;
  const block = linesOf(s, first, last);
  const other = b.line(dir < 0 ? first - 1 : last + 1);
  const from = dir < 0 ? first - 1 : first;
  const to = dir < 0 ? last : last + 1;
  const original = [...(dir < 0 ? [other] : []), ...block, ...(dir > 0 ? [other] : [])].join('\n');
  const swapped = (dir < 0 ? [...block, other] : [other, ...block]).join('\n');
  const edit: Edit = { start: { line: from, col: 0 }, removed: original, inserted: swapped };
  void to;
  const shift = (p: Pos): Pos => ({ line: p.line + dir, col: p.col });
  s.doc.applyEdits([edit], shift(s.doc.cursor), s.doc.anchor ? shift(s.doc.anchor) : null);
}
def('edit.moveLineUp', (s) => moveLines(s, -1));
def('edit.moveLineDown', (s) => moveLines(s, 1));

// ---- edit: indentation ----

def('edit.indent', (s) => {
  const sel = s.doc.selection();
  if (!sel || sel.start.line === sel.end.line) {
    if (s.config.insertSpaces) {
      const { line, col } = s.doc.cursor;
      const at = sel?.start.col ?? col;
      const w = getTabSize() - (displayWidth(s.doc.buffer.line(line), at) % getTabSize());
      s.doc.insert(' '.repeat(w));
    } else s.doc.insert('\t');
    return;
  }
  const { first, last } = lineRange(s);
  const unit = indentUnit(s);
  const edits: Edit[] = [];
  for (let l = last; l >= first; l--) {
    if (s.doc.buffer.line(l).length > 0) edits.push({ start: { line: l, col: 0 }, removed: '', inserted: unit });
  }
  const cursor = s.doc.cursor;
  const anchor = s.doc.anchor;
  // Positions at column 0 stay at column 0 so the selection keeps covering whole lines.
  const move = (p: Pos): Pos => (p.col === 0 ? p : shiftPos(p, edits));
  s.doc.applyEdits(edits, move(cursor), anchor ? move(anchor) : null);
});

def('edit.unindent', (s) => {
  const { first, last } = lineRange(s);
  const edits: Edit[] = [];
  for (let l = last; l >= first; l--) {
    const t = s.doc.buffer.line(l);
    if (t.startsWith('\t')) edits.push({ start: { line: l, col: 0 }, removed: '\t', inserted: '' });
    else {
      const n = Math.min(/^ */.exec(t)![0].length, getTabSize());
      if (n > 0) edits.push({ start: { line: l, col: 0 }, removed: ' '.repeat(n), inserted: '' });
    }
  }
  applyLineEdits(s, edits);
});

def('edit.trimTrailing', (s) => {
  const edits: Edit[] = [];
  const b = s.doc.buffer;
  for (let l = b.lineCount - 1; l >= 0; l--) {
    const t = b.line(l);
    const trimmed = t.replace(/[ \t]+$/, '');
    if (trimmed.length !== t.length) edits.push({ start: { line: l, col: trimmed.length }, removed: t.slice(trimmed.length), inserted: '' });
  }
  if (edits.length === 0) return s.flash(t('msg.nothingToTrim'));
  applyLineEdits(s, edits);
  s.flash(t('msg.trimmed', { n: edits.length }));
});

// ---- edit: case ----

function convertCase(s: Session, fn: (t: string) => string): void {
  const sel = s.doc.selection();
  if (!sel) return s.flash(t('msg.selectFirst'), 'warn');
  const removed = s.doc.selectedText();
  const inserted = fn(removed);
  if (inserted === removed) return;
  s.doc.applyEdits([{ start: sel.start, removed, inserted }], advance(sel.start, inserted), sel.start);
}
def('edit.upper', (s) => convertCase(s, (t) => t.toUpperCase()));
def('edit.lower', (s) => convertCase(s, (t) => t.toLowerCase()));

// ---- edit: comments ----

def('edit.toggleComment', (s) => {
  const lang = s.lang;
  const { first, last } = lineRange(s);
  const rows = linesOf(s, first, last)
    .map((text, i) => ({ text, line: first + i }))
    .filter((r) => r.text.trim().length > 0);
  if (rows.length === 0) return;
  const edits: Edit[] = [];
  if (lang.line) {
    const prefix = lang.line;
    const allCommented = rows.every((r) => r.text.trimStart().startsWith(prefix));
    if (allCommented) {
      for (const r of [...rows].reverse()) {
        const idx = r.text.indexOf(prefix);
        const removed = r.text.startsWith(' ', idx + prefix.length) ? prefix + ' ' : prefix;
        edits.push({ start: { line: r.line, col: idx }, removed, inserted: '' });
      }
    } else {
      const indent = Math.min(...rows.map((r) => leading(r.text).length));
      for (const r of [...rows].reverse()) edits.push({ start: { line: r.line, col: indent }, removed: '', inserted: prefix + ' ' });
    }
  } else if (lang.block) {
    const [a, b] = lang.block;
    const allWrapped = rows.every((r) => r.text.trim().startsWith(a) && r.text.trimEnd().endsWith(b));
    for (const r of [...rows].reverse()) {
      const start = leading(r.text).length;
      const end = r.text.trimEnd().length;
      if (allWrapped) {
        const inner = r.text.slice(start, end);
        const body = inner.slice(a.length, inner.length - b.length);
        const trimmed = body.startsWith(' ') && body.endsWith(' ') && body.length >= 2 ? body.slice(1, -1) : body;
        edits.push({ start: { line: r.line, col: start }, removed: inner, inserted: trimmed });
      } else {
        edits.push({ start: { line: r.line, col: end }, removed: '', inserted: ` ${b}` });
        edits.push({ start: { line: r.line, col: start }, removed: '', inserted: `${a} ` });
      }
    }
  } else {
    return s.flash(t('msg.noComment'), 'warn');
  }
  applyLineEdits(s, edits);
});

def('edit.blockComment', (s) => {
  const block = s.lang.block;
  if (!block) return s.flash(t('msg.noBlockComment'), 'warn');
  const [a, b] = block;
  const sel = s.doc.selection();
  let start: Pos;
  let text: string;
  if (sel) {
    start = sel.start;
    text = s.doc.selectedText();
  } else {
    const line = s.doc.cursor.line;
    const t = s.doc.buffer.line(line);
    const from = leading(t).length;
    start = { line, col: from };
    text = t.slice(from).trimEnd();
    if (!text) return;
  }
  const wrapped = text.length >= a.length + b.length && text.startsWith(a) && text.endsWith(b);
  const inserted = wrapped ? text.slice(a.length, text.length - b.length) : `${a}${text}${b}`;
  s.doc.applyEdits([{ start, removed: text, inserted }], advance(start, inserted), sel ? start : null);
});

// ---- search ----

def('find.open', (s) => s.openFind(false));
def('find.replace', (s) => s.openFind(true));
def('find.next', (s) => s.findNext(false));
def('find.prev', (s) => s.findNext(true));

def('goto', (s) => {
  const n = s.doc.buffer.lineCount;
  s.dialog = {
    kind: 'prompt',
    title: t('dlg.gotoTitle'),
    label: t('dlg.gotoLabel', { n }),
    field: new TextField(''),
    onSubmit: (value) => {
      const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(value);
      if (!m) return t('dlg.gotoNaN');
      const line = Number(m[1]);
      if (line < 1 || line > n) return t('dlg.gotoRange', { n });
      s.doc.moveTo({ line: line - 1, col: m[2] ? Number(m[2]) - 1 : 0 });
    },
  };
});

// ---- view ----

def('view.wrap', (s) => s.setConfig({ wordWrap: !s.config.wordWrap }));
def('view.lineNumbers', (s) => s.setConfig({ showLineNumbers: !s.config.showLineNumbers }));
def('view.special', (s, arg) => {
  const c = arg as SpecialCategory;
  s.setConfig({ specialChars: { ...s.config.specialChars, [c]: !s.config.specialChars[c] } });
});
def('view.special.all', (s) => s.setConfig({ specialChars: { whitespace: true, eol: true, nonPrinting: true, control: true } }), (s) => !SPECIAL_CATEGORIES.every((c) => s.config.specialChars[c]));
def('view.special.none', (s) => s.setConfig({ specialChars: { whitespace: false, eol: false, nonPrinting: false, control: false } }), (s) => SPECIAL_CATEGORIES.some((c) => s.config.specialChars[c]));
def('view.whitespace', (s) => void s.run(SPECIAL_CATEGORIES.some((c) => s.config.specialChars[c]) ? 'view.special.none' : 'view.special.all'));
def('view.currentLine', (s) => s.setConfig({ highlightCurrentLine: !s.config.highlightCurrentLine }));
def('view.syntax', (s) => s.setConfig({ syntaxHighlight: !s.config.syntaxHighlight }));
/** Opens the View menu with the given submenu expanded (used by status bar clicks and the old command ids). */
function openViewSubmenu(s: Session, id: string): void {
  const menu = MENUS.findIndex((m) => m.mnemonic === 'v');
  s.openMenu(menu);
  s.openSubmenu(menu, MENUS[menu]!.items.findIndex((it) => it.id === id));
}
def('view.syntaxLanguage', (s) => openViewSubmenu(s, 'syntaxLanguage'));
def('view.tabSettings', (s) => openViewSubmenu(s, 'tabSettings'));
def('view.theme', (s) => openViewSubmenu(s, 'theme'));
def('view.language', (s) => openViewSubmenu(s, 'language'));
def('view.theme.set', (s, arg) => s.setConfig({ theme: arg as ThemeId }));
def('view.language.set', (s, arg) => s.setConfig({ language: arg as string }));
def('view.tab.set', (s, arg) => {
  const [kind, n] = String(arg).split(':');
  s.setConfig({ insertSpaces: kind === 'spaces', tabSize: Number(n) });
});
def('view.syntaxLanguage.set', (s, arg) => {
  s.setSyntaxLanguage(arg ? String(arg) : null);
  s.flash(s.lang.name);
});
def('view.toggleDark', (s) => s.setConfig({ theme: s.config.theme === 'dark' ? 'light' : 'dark' }));

// ---- encoding ----

def('encoding.set', (s, arg) => s.setEncoding(arg as EncodingId));
def('eol.set', (s, arg) => s.setEol(arg as Eol));
def('encoding.reload', (s) => {
  if (!s.path) return s.flash(t('msg.noReload'), 'warn');
  s.dialog = {
    kind: 'list',
    title: t('dlg.reloadTitle'),
    items: ENCODINGS.map((e) => ({ label: e.label, value: e.id, checked: s.encoding === e.id })),
    index: Math.max(ENCODINGS.findIndex((e) => e.id === s.encoding), 0),
    onPick: (id) => s.reloadWithEncoding(id as EncodingId),
  };
});

// ---- menu / help ----

def('menu.open', (s, arg) => s.openMenu(typeof arg === 'number' ? arg : 0));

def('help.keys', (s) => {
  const lines: string[] = [];
  for (const m of MENUS) {
    lines.push(`[${m.label}]`);
    for (const it of m.items) {
      if (!it.cmd || it.sep) continue;
      const key = s.shortcutFor(it.cmd, it.arg);
      if (key) lines.push(`  ${it.label}${' '.repeat(Math.max(2, 34 - stringWidth(it.label)))}${key}`);
    }
  }
  lines.push(`[${t('help.other')}]`, ...t('help.extra').split('\n').map((l) => `  ${l}`));
  lines.push('', t('help.footer'));
  s.dialog = { kind: 'info', title: t('dlg.keysTitle'), lines, scroll: 0 };
});

def('help.about', (s) => {
  s.dialog = { kind: 'info', title: t('dlg.aboutTitle'), lines: t('help.aboutText').split('\n'), scroll: 0 };
});
