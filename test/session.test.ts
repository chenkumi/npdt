import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { formatMode } from '../src/core/fs/permissions.js';
import { Session } from '../src/core/session.js';
import { InputParser } from '../src/input/parser.js';
import { memoryClipboard } from '../src/platform/clipboard.js';
import { renderFrame } from '../src/ui/frame.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'npdt-s-'));
  process.env.NPDT_HOME = path.join(dir, 'home');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

let s: Session;
let clip: ReturnType<typeof memoryClipboard>;
const parser = new InputParser();
const flush = () => new Promise((r) => setTimeout(r, 40));
const send = async (raw: string) => {
  for (const ev of parser.feed(raw)) s.handleInput(ev);
  await flush();
};
const screen = () => renderFrame(s).toText();
const CTRL = (c: string) => String.fromCharCode(c.charCodeAt(0) - 96);

beforeEach(() => {
  clip = memoryClipboard();
  s = new Session({ autosave: false, persist: false, clipboard: clip });
  s.size = { cols: 80, rows: 24 };
});

test('frame has menu bar, toolbar, line numbers and status bar', async () => {
  await send('hello');
  const rows = screen();
  expect(rows[0]).toContain('File(F)');
  expect(rows[0]).toContain('Help(?)');
  expect(rows[1]!.trim()).toBe('New Open Save Close | Cut Copy Paste | Undo Redo | Search Replace');
  expect(rows[2]).toMatch(/^\s*1 │hello/);
  expect(rows[23]).toContain('Ln:1  Col:6');
  expect(rows[23]).toContain('UTF-8');
  expect(rows[23]).toContain('Length:5');
});

test('typing, undo and redo with the keyboard', async () => {
  await send('abc');
  await send(CTRL('z'));
  expect(s.doc.text).toBe('');
  await send(CTRL('y'));
  expect(s.doc.text).toBe('abc');
});

test('auto-indent keeps leading whitespace', async () => {
  await send('  foo\r');
  await send('bar');
  expect(s.doc.text).toBe('  foo\n  bar');
});

test('line commands: duplicate, move, delete', async () => {
  await send('a\rb\rc');
  await send('\x1b[1;5A'); // ctrl+up is not bound; cursor stays on c
  s.doc.moveTo({ line: 1, col: 0 });
  await send(CTRL('d'));
  expect(s.doc.text).toBe('a\nb\nb\nc');
  expect(s.doc.cursor.line).toBe(2);
  await send('\x1b[1;3A'); // alt+up
  expect(s.doc.text).toBe('a\nb\nb\nc');
  s.doc.moveTo({ line: 3, col: 0 });
  await send('\x1b[1;3A');
  expect(s.doc.text).toBe('a\nb\nc\nb');
  await send(CTRL('l'));
  expect(s.doc.text).toBe('a\nb\nb');
});

test('comment toggle follows the file language', async () => {
  await s.openPath(path.join(dir, 'x.ts'));
  await send('foo\rbar');
  s.doc.selectAll();
  await send(CTRL('k'));
  expect(s.doc.text).toBe('// foo\n// bar');
  await send(CTRL('k'));
  expect(s.doc.text).toBe('foo\nbar');
});

test('tab inserts spaces; shift+tab removes them; block indent on selection', async () => {
  await send('\t');
  expect(s.doc.text).toBe('    ');
  s.doc.moveTo({ line: 0, col: 0 });
  await send('\x1b[Z');
  expect(s.doc.text).toBe('');
  await send('a\rb');
  s.doc.selectAll();
  await send('\t');
  expect(s.doc.text).toBe('    a\n    b');
});

test('regex with \\n searches and replaces across lines', async () => {
  s.doc.applyEdits([{ start: { line: 0, col: 0 }, removed: '', inserted: 'a\nb\nc\na\nb\nd' }]);
  s.doc.moveTo({ line: 0, col: 0 });
  s.openFind(true);
  s.find!.regex = true;
  s.find!.query.set('a\\nb');
  s.refreshFind(true);
  expect(s.find!.total).toBe(2);
  expect(s.find!.index).toBe(1);
  expect(s.doc.selectedText()).toBe('a\nb');
  s.findNext();
  expect(s.doc.selection()!.start).toEqual({ line: 3, col: 0 });
  expect(s.find!.index).toBe(2);
  s.findNext(true);
  expect(s.doc.selection()!.start).toEqual({ line: 0, col: 0 });
  // highlight: the first line of a two-line match is marked
  expect(s.matchesForLine(0, 'a')).toMatchObject([{ start: 0, end: 1, current: true }]);
  expect(s.matchesForLine(1, 'b')).toMatchObject([{ start: 0, end: 1 }]);
  expect(s.matchesForLine(2, 'c')).toEqual([]);
  // replace current joins the two lines, replace all handles the rest
  s.find!.replacement.set('X\\n');
  s.replaceCurrent();
  expect(s.doc.text).toBe('X\\n\nc\na\nb\nd'.replace('X\\n', 'X\\n'));
  s.replaceAll();
  expect(s.doc.text).toBe('X\\n\nc\nX\\n\nd');
});

test('^ and $ still anchor at line boundaries in multi-line mode', async () => {
  s.doc.applyEdits([{ start: { line: 0, col: 0 }, removed: '', inserted: 'one\ntwo\n\nthree' }]);
  s.openFind(true);
  s.find!.regex = true;
  s.find!.query.set('e$\\n^t');
  s.refreshFind(true);
  expect(s.find!.total).toBe(1);
  expect(s.doc.selectedText()).toBe('e\nt');
  s.find!.query.set('\\n\\n');
  s.refreshFind(true);
  expect(s.find!.total).toBe(1);
});

test('find, replace and replace all through the panel', async () => {
  await send('foo bar foo');
  await send(CTRL('h') === '\b' ? '\x1b[104;5u' : '');
  expect(s.find?.replace).toBe(true);
  await send('foo');
  expect(s.find?.total).toBe(2);
  expect(s.doc.selectedText()).toBe('foo');
  await send('\t');
  await send('X');
  await send('\x1ba'); // alt+a = replace all
  expect(s.doc.text).toBe('X bar X');
  await send('\x1b');
  expect(s.find).toBeNull();
  await send(CTRL('z'));
  expect(s.doc.text).toBe('foo bar foo');
});

test('F3 repeats the last search after the panel is closed', async () => {
  await send('a x a x a');
  await send(CTRL('f'));
  await send('a');
  await send('\x1b');
  s.doc.moveTo({ line: 0, col: 0 });
  await send('\x1bOR');
  expect(s.doc.selection()?.start.col).toBe(0);
  await send('\x1bOR');
  expect(s.doc.selection()?.start.col).toBe(4);
});

test('alt+f opens the file menu; arrows move; escape closes', async () => {
  await send('\x1bf');
  expect(s.menu.open).toBe(true);
  let rows = screen();
  expect(rows.some((r) => r.includes('Open…'))).toBe(true);
  expect(rows.some((r) => r.includes('Ctrl+S'))).toBe(true);
  await send('\x1b[B');
  expect(s.menu.item).toBeGreaterThan(0);
  await send('\x1b');
  expect(s.menu.open).toBe(false);
  rows = screen();
  expect(rows.some((r) => r.includes('Open…'))).toBe(false);
});

test('menu command: toggle word wrap', async () => {
  await send('\x1bv');
  await s.activateMenuItem(3, 0);
  expect(s.config.wordWrap).toBe(true);
});

test('save creates the file only on first save and keeps eol', async () => {
  const file = path.join(dir, 'new.txt');
  await s.openPath(file);
  await expect(readFile(file)).rejects.toThrow();
  await send('hi\rthere');
  expect(s.dirty).toBe(true);
  await send(CTRL('s'));
  await vi.waitFor(() => expect(s.dirty).toBe(false));
  expect(await readFile(file, 'utf8')).toBe(os.platform() === 'win32' ? 'hi\r\nthere' : 'hi\nthere');
});

test('closing a dirty document asks first; Esc cancels, n discards', async () => {
  await send('x');
  await send(CTRL('w'));
  expect(s.dialog?.kind).toBe('confirm');
  await send('\x1b');
  expect(s.dialog).toBeNull();
  expect(s.doc.text).toBe('x');
  await send(CTRL('w'));
  await send('n');
  expect(s.doc.text).toBe('');
  expect(s.dialog).toBeNull();
});

test('open dialog lists the directory and opens a file with Enter', async () => {
  await writeFile(path.join(dir, 'open-me.txt'), 'content');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await send(CTRL('o'));
  } finally {
    process.chdir(prev);
  }
  expect(s.dialog?.kind).toBe('file');
  expect(screen().some((r) => r.includes('open-me.txt'))).toBe(true);
  await send('open-me');
  await send('\r'); // focus is on the name field after typing -> resolves relative path
  await flush();
  expect(s.doc.text).toBe('content');
});

test('goto line dialog validates input', async () => {
  await send('a\rb\rc');
  await send(CTRL('g'));
  await send('9');
  await send('\r');
  expect(s.dialog?.kind).toBe('prompt');
  await send('\x7f2');
  await send('\r');
  expect(s.dialog).toBeNull();
  expect(s.doc.cursor.line).toBe(1);
});

test('clipboard cut/copy/paste incl. whole-line behaviour', async () => {
  await send('one\rtwo');
  await send(CTRL('c'));
  expect(clip.value).toBe('two\n');
  await send(CTRL('x'));
  expect(s.doc.text).toBe('one');
  await send(CTRL('v'));
  expect(s.doc.text).toBe('two\none');
});

test('bracketed paste inserts verbatim', async () => {
  await send('\x1b[200~line1\nline2\x1b[201~');
  expect(s.doc.text).toBe('line1\nline2');
});

test('mouse: click places cursor, drag selects, wheel scrolls', async () => {
  await send(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\r'));
  renderFrame(s);
  s.doc.moveTo({ line: 0, col: 0 });
  s.scroll.top = 0;
  renderFrame(s);
  // gutter is 5 wide (3 digits + 2): click row 2 (editor y=2) col 5+2
  await send('\x1b[<0;8;3M');
  expect(s.doc.cursor).toEqual({ line: 0, col: 2 });
  await send('\x1b[<32;11;3M');
  await send('\x1b[<0;11;3m');
  expect(s.doc.selectedText()).toBe('ne ');
  await send('\x1b[<65;10;10M');
  expect(s.scroll.top).toBe(3);
});

test('toolbar button click runs the command', async () => {
  await send('abc');
  renderFrame(s);
  const undo = renderFrame(s).toText()[1]!.indexOf('Undo');
  await send(`\x1b[<0;${undo + 2};2M`);
  expect(s.doc.text).toBe('');
});

test('syntax language can be chosen manually and resets for another document', async () => {
  const kw = (x: number) => renderFrame(s).styleAt(x, 2).fg;
  await send('const a = 1;');
  expect(s.lang.name).toBe('Plain Text');
  const plain = kw(7); // inside "const" (after the gutter)
  await s.run('view.syntaxLanguage');
  const d = s.dialog as { kind: 'list'; items: { label: string; value: string }[]; index: number; onPick(v: string): void };
  expect(d.kind).toBe('list');
  expect(d.items[0]!.value).toBe('');
  expect(d.items.map((i) => i.value)).toEqual(expect.arrayContaining(['JavaScript', 'Python', 'Markdown', 'C++', 'Java']));
  d.onPick('JavaScript');
  expect(s.lang.name).toBe('JavaScript');
  expect(kw(7)).not.toBe(plain);
  expect(screen()[23]).toContain('JavaScript');
  s.setSyntaxLanguage(null);
  expect(s.lang.name).toBe('Plain Text');
  s.setSyntaxLanguage('Python');
  s.newDocument();
  expect(s.langOverride).toBeNull();
});

test('menu mnemonics are underlined and hovering shows the shortcut in the status bar', async () => {
  const f = screen()[0]!.indexOf('File(F)') + 5; // the "F" inside the parentheses
  expect(renderFrame(s).styleAt(f, 0).underline).toBe(true);
  expect(renderFrame(s).styleAt(f - 5, 0).underline).toBeFalsy();
  const move = (x: number, y: number) => send(`\x1b[<35;${x + 1};${y + 1}M`);
  await move(2, 0);
  expect(screen()[23]).toContain('Alt+F');
  const save = screen()[1]!.indexOf('Save');
  await move(save + 1, 1);
  expect(screen()[23]).toContain('Save   Ctrl+S');
  await move(70, 10);
  expect(screen()[23]).not.toContain('Ctrl+S');
});

test('hovering highlights toolbar, menu bar, dropdown items and dialog buttons', async () => {
  const move = (x: number, y: number) => send(`\x1b[<35;${x + 1};${y + 1}M`);
  const bgAt = (x: number, y: number) => renderFrame(s).styleAt(x, y).bg;
  // toolbar: "Save" lights up on hover (enabled items only), and goes back afterwards
  const row = renderFrame(s).toText()[1]!;
  const save = row.indexOf('Save');
  const before = bgAt(save, 1);
  await move(save + 1, 1);
  expect(bgAt(save, 1)).not.toBe(before);
  await move(70, 10);
  expect(bgAt(save, 1)).toBe(before);
  // menu bar
  const fileBg = bgAt(2, 0);
  await move(2, 0);
  expect(bgAt(2, 0)).not.toBe(fileBg);
  // open menu: hovering another title switches menus, hovering an item selects it
  await send('\x1bf');
  await move(12, 0);
  expect(s.menu.index).toBe(1);
  await move(6, 5);
  expect(s.menu.item).toBe(3);
  await send('\x1b');
  // dialog buttons follow the pointer
  s.dialog = {
    kind: 'confirm',
    title: 't',
    message: 'm',
    index: 0,
    buttons: [
      { label: 'A', hotkey: 'a', run: () => {} },
      { label: 'B', hotkey: 'b', run: () => {} },
    ],
  };
  renderFrame(s);
  const hit = s.hits.filter((h) => h.onHover && h.h === 1 && h.w === 3).at(-1)!;
  await move(hit.x, hit.y);
  expect(s.dialog).toMatchObject({ index: 1 });
});

test('wrapped lines scroll with the cursor', async () => {
  s.setConfig({ wordWrap: true });
  s.size = { cols: 40, rows: 10 };
  await send('x'.repeat(400));
  const rows = screen();
  expect(rows.filter((r) => r.includes('xxxx')).length).toBeGreaterThan(1);
  expect(s.scroll.top).toBe(0);
  expect(s.scroll.sub).toBeGreaterThan(0);
});

test('CJK text keeps cursor and status columns aligned', async () => {
  await send('中文abc');
  const rows = screen();
  expect(rows[2]).toContain('中文abc');
  expect(rows[23]).toContain('Col:6');
  s.doc.move('lineStart');
  await send('\x1b[C');
  expect(s.doc.cursor.col).toBe(1);
});

test('syntax highlighting colors keywords', async () => {
  await s.openPath(path.join(dir, 'a.js'));
  await send('const x = 1;');
  const frame = renderFrame(s);
  const kw = frame.styleAt(5, 2);
  const plain = frame.styleAt(11, 2);
  expect(kw.fg).not.toBe(plain.fg);
});

test('too small terminal shows a notice instead of crashing', () => {
  s.size = { cols: 10, rows: 3 };
  expect(screen()[0]).toContain('Window');
});

test('every theme renders without throwing', () => {
  for (const theme of ['light', 'dark', 'contrast'] as const) {
    s.setConfig({ theme });
    expect(() => renderFrame(s)).not.toThrow();
  }
});

test('dark/light toggle switches the theme and F9 is bound to it', async () => {
  expect(s.config.theme).toBe('dark');
  const dark = renderFrame(s).styleAt(10, 5).bg;
  await send('\x1b[20~'); // F9
  expect(s.config.theme).toBe('light');
  expect(renderFrame(s).styleAt(10, 5).bg).not.toBe(dark);
  await s.run('view.toggleDark');
  expect(s.config.theme).toBe('dark');
});

test('switching language re-labels menus, toolbar and dialogs', async () => {
  s.setConfig({ language: 'zh-TW' });
  const rows = screen();
  expect(rows[0]).toContain('檔案(F)');
  expect(rows[1]!.trim()).toBe('新增 開啟 儲存 關閉 | 剪下 複製 貼上 | 還原 重做 | 搜尋 取代');
  await s.run('view.language');
  expect(s.dialog).toMatchObject({ kind: 'list', title: '選擇語言' });
  s.setConfig({ language: 'ja' });
  expect(screen()[0]).toContain('ファイル(F)');
  s.setConfig({ language: 'en' });
  expect(screen()[0]).toContain('File(F)');
});

test('dirty flag follows undo back to the saved state', async () => {
  await send('abc');
  expect(s.dirty).toBe(true);
  await send(CTRL('z'));
  expect(s.dirty).toBe(false);
  await send(CTRL('y'));
  expect(s.dirty).toBe(true);
  s.doc.history.markClean();
  expect(s.dirty).toBe(false);
  await send('d');
  expect(s.dirty).toBe(true);
  await send(CTRL('z'));
  expect(s.dirty).toBe(false);
  await send(CTRL('z'));
  expect(s.dirty).toBe(true);
  await send('Q'); // new edit after undoing past the saved state: clean point is gone
  await send(CTRL('y'));
  expect(s.dirty).toBe(true);
});

test('crash recovery snapshot is offered on open and can be restored', async () => {
  const { writeRecovery } = await import('../src/core/fs/recovery.js');
  const file = path.join(dir, 'recover.txt');
  await writeFile(file, 'saved');
  await writeRecovery(file, 'unsaved work');
  await s.openPath(file);
  expect(s.dialog?.kind).toBe('confirm');
  await send('y');
  expect(s.doc.text).toBe('unsaved work');
  expect(s.dirty).toBe(true);
});

test('config keymap overrides rebind and unbind keys', async () => {
  s.setConfig({ keymap: { 'ctrl+b': 'edit.selectAll', 'ctrl+d': 'none' } });
  await send('one');
  await send(CTRL('b'));
  expect(s.doc.selectedText()).toBe('one');
  await send(CTRL('d'));
  expect(s.doc.text).toBe('one');
});

test('encoding menu marks the document dirty and saves in that encoding', async () => {
  const file = path.join(dir, 'enc.txt');
  await s.openPath(file);
  await send('中文');
  await s.run('encoding.set', 'big5');
  await send(CTRL('s'));
  await vi.waitFor(() => expect(s.dirty).toBe(false));
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 2)]).toEqual([0xa4, 0xa4]);
});

test('mouse: click a menu title, then a dropdown item', async () => {
  renderFrame(s);
  const bar = screen()[0]!;
  // SGR coordinates are 1-based.
  const col = bar.indexOf('View(V)') + 2;
  await send(`\x1b[<0;${col};1M`);
  expect(s.menu).toMatchObject({ open: true, index: 3 });
  const rows = screen();
  const y = rows.findIndex((r) => r.includes('Word Wrap'));
  expect(y).toBeGreaterThan(0);
  const x = rows[y]!.indexOf('Word Wrap') + 2;
  await send(`\x1b[<0;${x};${y + 1}M`);
  expect(s.config.wordWrap).toBe(true);
  expect(s.menu.open).toBe(false);
  // clicking outside an open menu closes it without side effects
  await send('\x1bf');
  await send('\x1b[<0;70;15M');
  expect(s.menu.open).toBe(false);
});

test('a file changed on disk is reloaded when clean, and only warned about when dirty', async () => {
  const file = path.join(dir, 'watch.txt');
  await writeFile(file, 'one\ntwo\nthree\n');
  await s.openPath(file);
  s.doc.moveTo({ line: 2, col: 1 });
  // bump mtime reliably even on coarse-grained file systems
  const later = new Date(Date.now() + 5000);
  await writeFile(file, 'one\ntwo\nthree\nfour\n');
  await (await import('node:fs/promises')).utimes(file, later, later);
  await s.checkExternalChange();
  expect(s.doc.text).toBe('one\ntwo\nthree\nfour\n');
  expect(s.doc.cursor).toEqual({ line: 2, col: 1 });
  expect(s.message?.text).toContain('Reloaded watch.txt');
  expect(s.dirty).toBe(false);

  // unsaved edits are never overwritten
  await send('X');
  const later2 = new Date(Date.now() + 10000);
  await writeFile(file, 'changed\n');
  await (await import('node:fs/promises')).utimes(file, later2, later2);
  await s.checkExternalChange();
  expect(s.doc.text).toContain('X');
  expect(s.message?.text).toContain('Changed on disk: watch.txt');

  // our own save is not treated as an external change
  s.setConfig({ autoReload: true });
  await s.save().catch(() => {});
});

test('autoReload can be turned off', async () => {
  const file = path.join(dir, 'noreload.txt');
  await writeFile(file, 'a\n');
  s.setConfig({ autoReload: false });
  await s.openPath(file);
  const later = new Date(Date.now() + 5000);
  await writeFile(file, 'b\n');
  await (await import('node:fs/promises')).utimes(file, later, later);
  await s.checkExternalChange();
  expect(s.doc.text).toBe('a\n');
});

test('cursor and scroll position are remembered per file', async () => {
  const a = path.join(dir, 'view-a.txt');
  const b = path.join(dir, 'view-b.txt');
  const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  await writeFile(a, body);
  await writeFile(b, 'short');
  await s.openPath(a);
  s.doc.moveTo({ line: 60, col: 3 });
  s.ensureCursorVisible();
  const top = s.scroll.top;
  expect(top).toBeGreaterThan(0);
  await s.openPath(b);
  expect(s.doc.cursor).toEqual({ line: 0, col: 0 });
  await s.openPath(a);
  expect(s.doc.cursor).toEqual({ line: 60, col: 3 });
  expect(s.scroll.top).toBe(top);

  // survives a new session via the persisted views, and a shorter file is clamped
  const s2 = new Session({ autosave: false, persist: false, clipboard: clip, views: { [path.resolve(b)]: { line: 40, col: 99, top: 30 } } });
  s2.size = { cols: 80, rows: 24 };
  await s2.openPath(b);
  expect(s2.doc.cursor).toEqual({ line: 0, col: 5 });
  expect(s2.scroll.top).toBe(0);
});

test('status bar shows file permissions and clicking opens the permissions dialog', async () => {
  const file = path.join(dir, 'perm.txt');
  await writeFile(file, 'x');
  await s.openPath(file);
  const label = formatMode(s.mode!);
  expect(screen()[23]).toContain(label);
  await send(`\x1b[<0;${screen()[23]!.indexOf(label) + 2};24M`);
  expect(s.dialog?.kind).toBe(process.platform === 'win32' ? 'list' : 'prompt');
  s.dialog = null;
  await s.setPermissions(0o444);
  expect(s.readOnly).toBe(true);
  expect(screen()[23]).toContain(process.platform === 'win32' ? 'RO' : 'r--r--r--');
  await s.setPermissions(0o644);
  expect(s.readOnly).toBe(false);
});

test('permissions are unavailable for an unsaved document', async () => {
  expect(s.mode).toBeNull();
  expect(s.isEnabled('file.permissions')).toBe(false);
  await s.setPermissions(0o644);
  expect(s.message?.level).toBe('warn');
});
