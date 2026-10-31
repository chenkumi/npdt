import path from 'node:path';
import { Document } from './buffer/document.js';
import { colForWidth, displayWidth, lineCells, prevBoundary, setTabSize } from './buffer/graphemes.js';
import type { Pos } from './buffer/types.js';
import { comparePos } from './buffer/types.js';
import { COMMANDS } from './commands.js';
import { DEFAULT_CONFIG, MAX_VIEWS, saveConfig, saveState, type Config, type ViewState } from './config/config.js';
import { dialogText, handleDialogKey, openFileDialog, pickButton, pickListItem, type Dialog } from './dialogs.js';
import { formatMode } from './fs/permissions.js';
import { encodingLabel, type EncodingId } from './fs/encoding.js';
import { setLocale, t } from './i18n.js';
import type { Eol } from './fs/eol.js';
import { platformEol } from './fs/eol.js';
import { clearRecovery, readRecovery, writeRecovery } from './fs/recovery.js';
import { FileError, getMode, getMtime, isReadOnly, loadFile, saveFile, setMode } from './fs/file-io.js';
import { buildKeymap, type KeyBinding } from './keymap.js';
import { languageByName, languageFor, type LangInfo } from './lang.js';
import { setSpecialChars } from './buffer/specials.js';
import { MENUS, type MenuItem } from './menus.js';
import {
  DocIndex,
  allRanges,
  buildMatcher,
  countMatches,
  expandReplacement,
  findMatch,
  matchesInLine,
  pickRange,
  rangesOnLine,
  replaceAllEdits,
  replaceAllRanges,
  type Match,
  type Matcher,
  type Range,
} from './search/search.js';
import { highlightLines, isSupported, type Span } from './syntax.js';
import { TextField } from './text-field.js';
import { keyId, type InputEvent, type KeyEvent, type MouseEvent } from '../input/parser.js';
import type { ClipboardApi } from '../platform/clipboard.js';
import { memoryClipboard } from '../platform/clipboard.js';
import { computeLayout, wrapStarts, type Layout } from '../ui/layout.js';

const WATCH_INTERVAL_MS = 1000;
const AUTOSAVE_DELAY_MS = 5000;
const DOUBLE_CLICK_MS = 450;
/** Lines highlighted above/below the visible window, so multi-line tokens start in the right state. */
const HIGHLIGHT_LOOKBACK = 100;
const HIGHLIGHT_LOOKAHEAD = 20;
/** Lines longer than this disable highlighting for the window (keeps the regex engine fast). */
const HIGHLIGHT_MAX_LINE = 5000;

/** How long the pointer may be away from a submenu and its parent row before the submenu closes. */
const SUBMENU_CLOSE_DELAY_MS = 1000;

export interface SessionOptions {
  config?: Config;
  warnings?: string[];
  recent?: string[];
  /** Remembered cursor/scroll positions per file path. */
  views?: Record<string, ViewState>;
  /** Poll for external file changes (default: same as `autosave`). */
  watch?: boolean;
  clipboard?: ClipboardApi;
  /** Periodic crash-recovery snapshots (default true). */
  autosave?: boolean;
  /** Write config/recent-file changes to disk (default true). */
  persist?: boolean;
  onExit?: () => void;
}

export interface FindState {
  replace: boolean;
  query: TextField;
  replacement: TextField;
  field: 'find' | 'replace';
  focus: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  total: number;
  /** 1-based index of the current match, 0 when none is selected. */
  index: number;
  error?: string;
}

/** Hit target registered by the renderer for mouse handling. */
export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  onMouse(ev: MouseEvent): void | Promise<void>;
  /** Called when the pointer moves onto this (topmost) target. */
  onHover?(): void;
}

/** One visible text row of the editor, as drawn by the last frame. */
export interface RowInfo {
  line: number;
  start: number;
  end: number;
  /** Display column of the first character in this row. */
  baseCol: number;
}

export interface Message {
  text: string;
  level: 'info' | 'warn' | 'error';
}

export class Session {
  doc = new Document();
  path: string | null = null;
  encoding: EncodingId = 'utf8';
  eol: Eol = platformEol();
  readOnly = false;
  /** Permission bits of the file on disk; null for an unsaved document. */
  mode: number | null = null;
  config: Config;
  recent: string[];
  clipboard: ClipboardApi;

  size = { cols: 80, rows: 24 };
  scroll = { top: 0, sub: 0, left: 0 };
  overwrite = false;
  message: Message | null = null;
  menu = { open: false, index: 0, item: 0, sub: -1, subTop: 0 };
  dialog: Dialog | null = null;
  find: FindState | null = null;
  lastQuery = '';
  /** Manually chosen syntax language (by LangInfo.name); reset when another document is opened. */
  langOverride: string | null = null;
  exitRequested = false;

  /** Filled by the renderer on every frame. */
  hits: Hit[] = [];
  rowMap: RowInfo[] = [];
  /** Last pointer cell reported by the terminal (any-motion tracking); drives hover highlights. */
  hover: { x: number; y: number } | null = null;

  version = 0;
  private listeners = new Set<() => void>();
  private mtimeMs: number | null = null;
  private forceDirty = false;
  private keymap: Map<string, KeyBinding>;
  private seenState = '';
  private rangeCache: { rev: number; key: string; ranges: Range[] } | null = null;
  private messageTimer: NodeJS.Timeout | undefined;
  private autosaveTimer: NodeJS.Timeout | undefined;
  private watchTimer: NodeJS.Timeout | undefined;
  /** True while a save is in flight, so our own write is not mistaken for an external change. */
  private saving = false;
  /** mtime we already warned about (unsaved edits + changed file), to warn once per change. */
  private notifiedMtime: number | null = null;
  private views: Record<string, ViewState>;
  private drag = false;
  private lastClick = { t: 0, x: -1, y: -1, count: 0 };
  private highlight: { rev: number; lang: string; from: number; to: number; spans: Span[][] } | null = null;
  private untitledCounter = 1;
  private readonly opts: SessionOptions;

  constructor(opts: SessionOptions = {}) {
    this.opts = opts;
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.recent = opts.recent ?? [];
    this.views = { ...opts.views };
    this.clipboard = opts.clipboard ?? memoryClipboard();
    if (opts.watch ?? opts.autosave !== false) {
      this.watchTimer = setInterval(() => void this.checkExternalChange().catch(() => {}), WATCH_INTERVAL_MS);
      this.watchTimer.unref();
    }
    this.keymap = buildKeymap(this.config.keymap);
    setTabSize(this.config.tabSize);
    setSpecialChars(this.config.specialChars);
    setLocale(this.config.language);
    for (const w of opts.warnings ?? []) this.flash(w, 'warn', 8000);
  }

  // ---- observers ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- derived state ----

  get dirty(): boolean {
    return this.forceDirty || !this.doc.history.isClean;
  }

  get title(): string {
    return this.path ? path.basename(this.path) : t('doc.untitled', { n: this.untitledCounter });
  }

  get lang(): LangInfo {
    return (this.langOverride && languageByName(this.langOverride)) || languageFor(this.path);
  }

  /** Picks the syntax language by name; null returns to detection by file name. */
  setSyntaxLanguage(name: string | null): void {
    this.langOverride = name;
    this.highlight = null;
  }

  get shortcutFor() {
    return (cmd: string, arg?: unknown): string => {
      for (const [id, b] of this.keymap) if (b.cmd === cmd && JSON.stringify(b.arg) === JSON.stringify(arg)) return formatKey(id);
      return '';
    };
  }

  layout(): Layout {
    const findRows = this.find ? (this.find.replace ? 2 : 1) : 0;
    return computeLayout(this.size.cols, this.size.rows, this.doc.buffer.lineCount, this.config.showLineNumbers, findRows);
  }

  // ---- messages ----

  flash(text: string, level: Message['level'] = 'info', ms = 4000): void {
    this.message = { text, level };
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message = null;
      this.emit();
    }, ms);
    this.messageTimer.unref();
  }

  // ---- configuration ----

  setConfig(patch: Partial<Config>): void {
    this.config = { ...this.config, ...patch };
    setTabSize(this.config.tabSize);
    setSpecialChars(this.config.specialChars);
    if ('language' in patch) setLocale(this.config.language);
    if ('keymap' in patch) this.keymap = buildKeymap(this.config.keymap);
    this.highlight = null;
    this.ensureCursorVisible();
    if (this.opts.persist !== false) void saveConfig(this.config).catch(() => {});
  }

  // ---- viewport ----

  setSize(cols: number, rows: number): void {
    if (cols === this.size.cols && rows === this.size.rows) return;
    this.size = { cols, rows };
    this.ensureCursorVisible();
    this.emit();
  }

  private rowCount(line: number, width: number): number {
    return wrapStarts(this.doc.buffer.line(line), width).length;
  }

  private cursorSub(width: number): number {
    const { line, col } = this.doc.cursor;
    const starts = wrapStarts(this.doc.buffer.line(line), width);
    let sub = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= col) sub = i;
    return sub;
  }

  ensureCursorVisible(): void {
    const L = this.layout();
    if (L.tooSmall) return;
    const h = L.editor.h;
    const { line, col } = this.doc.cursor;
    const sc = this.scroll;
    sc.top = Math.min(Math.max(sc.top, 0), this.doc.buffer.lineCount - 1);

    if (!this.config.wordWrap) {
      sc.sub = 0;
      if (line < sc.top) sc.top = line;
      else if (line >= sc.top + h) sc.top = line - h + 1;
      const dcol = displayWidth(this.doc.buffer.line(line), col);
      if (dcol < sc.left) sc.left = dcol;
      else if (dcol >= sc.left + L.textW) sc.left = dcol - L.textW + 1;
      return;
    }

    sc.left = 0;
    const width = Math.max(L.textW - 1, 1);
    const sub = this.cursorSub(width);
    if (line < sc.top || (line === sc.top && sub < sc.sub)) {
      sc.top = line;
      sc.sub = sub;
      return;
    }
    // Rows between the top of the viewport and the cursor row.
    let dist = -sc.sub + sub;
    if (line - sc.top >= h) dist = h;
    else for (let l = sc.top; l < line; l++) dist += this.rowCount(l, width);
    if (dist < h) return;
    let l = line;
    let s = sub;
    for (let remaining = h - 1; remaining > 0; remaining--) {
      if (s > 0) s--;
      else if (l > 0) {
        l--;
        s = this.rowCount(l, width) - 1;
      } else break;
    }
    sc.top = l;
    sc.sub = s;
  }

  scrollBy(lines: number, columns = 0): void {
    const max = this.doc.buffer.lineCount - 1;
    this.scroll.top = Math.min(Math.max(this.scroll.top + lines, 0), max);
    this.scroll.sub = 0;
    if (!this.config.wordWrap) this.scroll.left = Math.max(this.scroll.left + columns, 0);
  }

  /** Syntax spans for a visible line range (cached per revision). */
  spansFor(top: number, bottom: number): (line: number) => Span[] | undefined {
    const lang = this.lang.hljs;
    if (!this.config.syntaxHighlight || !isSupported(lang)) return () => undefined;
    const buf = this.doc.buffer;
    const last = Math.min(bottom, buf.lineCount - 1);
    const c = this.highlight;
    if (!(c && c.rev === this.doc.revision && c.lang === lang && c.from <= top && c.to >= last)) {
      const from = Math.max(0, top - HIGHLIGHT_LOOKBACK);
      const to = Math.min(buf.lineCount - 1, last + HIGHLIGHT_LOOKAHEAD);
      const lines: string[] = [];
      let tooLong = false;
      for (let i = from; i <= to; i++) {
        const t = buf.line(i);
        if (t.length > HIGHLIGHT_MAX_LINE) tooLong = true;
        lines.push(t);
      }
      this.highlight = { rev: this.doc.revision, lang, from, to, spans: tooLong ? lines.map(() => []) : highlightLines(lines, lang) };
    }
    const h = this.highlight!;
    return (line) => h.spans[line - h.from];
  }

  // ---- document lifecycle ----

  private resetDocument(text: string): void {
    this.doc = new Document(text);
    this.forceDirty = false;
    this.scroll = { top: 0, sub: 0, left: 0 };
    this.highlight = null;
    this.find = this.find ? { ...this.find, index: 0, total: 0 } : null;
  }

  newDocument(): void {
    this.rememberView();
    this.untitledCounter++;
    this.path = null;
    this.langOverride = null;
    this.mtimeMs = null;
    this.readOnly = false;
    this.mode = null;
    this.encoding = 'utf8';
    this.eol = platformEol();
    this.resetDocument('');
    void clearRecovery(null);
    this.emit();
  }

  /** Runs `next` immediately, or after the user decides what to do with unsaved changes. */
  guardUnsaved(next: () => void | Promise<void>): void | Promise<void> {
    if (!this.dirty) return next();
    this.dialog = {
      kind: 'confirm',
      title: t('dlg.unsavedTitle'),
      message: t('dlg.unsavedMsg', { name: this.title }),
      index: 0,
      buttons: [
        {
          label: `${t('btn.save')}(S)`,
          hotkey: 's',
          run: async () => {
            if (await this.save()) await next();
          },
        },
        { label: `${t('btn.dontSave')}(N)`, hotkey: 'n', run: () => next() },
        { label: `${t('btn.cancel')}(C)`, hotkey: 'c', run: () => {} },
      ],
    };
  }

  async openPath(file: string, forcedEncoding?: EncodingId): Promise<void> {
    const full = path.resolve(file);
    const loaded = await loadFile(full, forcedEncoding);
    this.rememberView();
    if (full !== this.path) this.langOverride = null;
    this.path = full;
    this.applyFileMeta(loaded);
    this.notifiedMtime = null;
    this.resetDocument(loaded.text);
    if (loaded.exists) {
      this.restoreView(full);
      this.addRecent(full);
    }
    const name = path.basename(full);
    this.flash(
      loaded.exists ? (loaded.large ? t('msg.large') : loaded.readOnly ? t('msg.readOnly') : t('msg.opened', { name })) : t('msg.newFile', { name }),
      loaded.large || loaded.readOnly ? 'warn' : 'info',
    );
    await this.offerRecovery(full);
    this.emit();
  }

  /** Asks to restore an unsaved snapshot left by a crashed session. */
  async offerRecovery(file: string | null): Promise<void> {
    const data = await readRecovery(file);
    if (!data) return;
    if (data.text === this.doc.text) {
      await clearRecovery(file);
      return;
    }
    const when = new Date(data.savedAt).toLocaleString();
    this.dialog = {
      kind: 'confirm',
      title: t('dlg.recoveryTitle'),
      message: t('dlg.recoveryMsg', { when }),
      index: 0,
      buttons: [
        {
          label: `${t('btn.restore')}(Y)`,
          hotkey: 'y',
          run: () => {
            this.resetDocument(data.text);
            this.forceDirty = true;
            this.flash(t('msg.recovered'), 'warn');
          },
        },
        { label: `${t('btn.discard')}(N)`, hotkey: 'n', run: () => clearRecovery(file) },
      ],
    };
  }

  private addRecent(full: string): void {
    const max = this.config.recentFilesMax;
    this.recent = [full, ...this.recent.filter((p) => p !== full)].slice(0, max);
    this.persistState();
  }

  private persistState(): void {
    if (this.opts.persist !== false) void saveState({ recent: this.recent, views: this.views });
  }

  /** Remembers where the cursor and scroll are for the current file (most recent last, capped). */
  rememberView(): void {
    const file = this.path;
    if (!file) return;
    delete this.views[file];
    this.views[file] = { line: this.doc.cursor.line, col: this.doc.cursor.col, top: this.scroll.top };
    for (const old of Object.keys(this.views).slice(0, Math.max(Object.keys(this.views).length - MAX_VIEWS, 0))) delete this.views[old];
    this.persistState();
  }

  private restoreView(file: string): void {
    const v = this.views[file];
    if (!v) return;
    this.doc.moveTo(this.doc.buffer.clamp({ line: v.line, col: v.col }));
    this.scroll.top = this.clampTop(v.top);
    this.ensureCursorVisible();
  }

  private clampTop(top: number): number {
    return Math.min(top, Math.max(this.doc.buffer.lineCount - 1, 0));
  }

  private applyFileMeta(loaded: { encoding: EncodingId; eol: Eol; readOnly: boolean; mode: number | null; mtimeMs: number | null }): void {
    this.encoding = loaded.encoding;
    this.eol = loaded.eol;
    this.readOnly = loaded.readOnly;
    this.mode = loaded.mode;
    this.mtimeMs = loaded.mtimeMs;
  }

  /** Reloads the file when it changed on disk and nothing unsaved would be lost; otherwise warns once. */
  async checkExternalChange(): Promise<void> {
    const file = this.path;
    if (!file || !this.config.autoReload || this.saving || this.mtimeMs === null) return;
    const current = await getMtime(file);
    if (current === null || current === this.mtimeMs || current === this.notifiedMtime) return;
    if (this.saving || file !== this.path) return;
    if (this.dirty) {
      this.notifiedMtime = current;
      this.flash(t('msg.changedOnDisk', { name: path.basename(file) }), 'warn', 8000);
      this.emit();
      return;
    }
    const loaded = await loadFile(file, this.encoding);
    if (this.saving || this.dirty || file !== this.path) return;
    const cursor = this.doc.cursor;
    const top = this.scroll.top;
    this.applyFileMeta(loaded);
    this.resetDocument(loaded.text);
    this.doc.moveTo(this.doc.buffer.clamp(cursor));
    this.scroll.top = this.clampTop(top);
    this.ensureCursorVisible();
    this.flash(t('msg.reloaded', { name: path.basename(file) }));
    this.emit();
  }

  async save(): Promise<boolean> {
    if (!this.path) {
      await this.saveAsDialog();
      return false;
    }
    return this.writeTo(this.path, false);
  }

  saveAsDialog(): Promise<void> {
    return openFileDialog(
      this,
      'save',
      async (file) => {
        const full = path.resolve(file);
        const exists = (await getMtime(full)) !== null;
        if (exists && full !== this.path) {
          this.dialog = {
            kind: 'confirm',
            title: t('dlg.overwriteTitle'),
            message: t('dlg.overwriteMsg', { name: path.basename(full) }),
            index: 1,
            buttons: [
              { label: `${t('btn.overwrite')}(Y)`, hotkey: 'y', run: async () => void (await this.writeTo(full, true)) },
              { label: `${t('btn.cancel')}(N)`, hotkey: 'n', run: () => {} },
            ],
          };
          this.emit();
          return;
        }
        await this.writeTo(full, true);
      },
      this.path ?? `new ${this.untitledCounter}.txt`,
    );
  }

  private async writeTo(file: string, isNewTarget: boolean): Promise<boolean> {
    try {
      if (!isNewTarget && this.mtimeMs !== null) {
        const current = await getMtime(file);
        if (current !== null && current !== this.mtimeMs) {
          this.dialog = {
            kind: 'confirm',
            title: t('dlg.modifiedTitle'),
            message: t('dlg.modifiedMsg', { name: path.basename(file) }),
            index: 1,
            buttons: [
              {
                label: `${t('btn.overwrite')}(Y)`,
                hotkey: 'y',
                run: async () => {
                  this.mtimeMs = current;
                  await this.writeTo(file, false);
                },
              },
              { label: `${t('btn.cancel')}(N)`, hotkey: 'n', run: () => {} },
            ],
          };
          return false;
        }
      }
      const previous = this.path;
      this.saving = true;
      try {
        this.mtimeMs = await saveFile(file, this.doc.text, this.encoding, this.eol);
        this.notifiedMtime = null;
        this.path = file;
        this.doc.history.markClean();
      } finally {
        this.saving = false;
      }
      this.forceDirty = false;
      this.readOnly = false;
      this.mode = await getMode(file);
      this.addRecent(file);
      await clearRecovery(previous);
      await clearRecovery(file);
      this.highlight = null;
      this.flash(t('msg.saved', { name: path.basename(file) }));
      return true;
    } catch (e) {
      this.flash(t('msg.saveFailed', { err: (e as Error).message }), 'error', 8000);
      return false;
    }
  }

  /** Changes the permission bits of the open file on disk. */
  async setPermissions(mode: number): Promise<void> {
    const file = this.path;
    if (!file || this.mode === null) {
      this.flash(t('msg.permNoFile'), 'warn');
      return;
    }
    try {
      await setMode(file, mode);
      this.mode = await getMode(file);
      this.readOnly = await isReadOnly(file);
      this.flash(t('msg.permSet', { mode: formatMode(this.mode ?? mode) }));
    } catch (e) {
      this.flash(t('msg.permFailed', { err: (e as Error).message }), 'error', 8000);
    }
  }

  async setEncoding(enc: EncodingId): Promise<void> {
    if (enc === this.encoding) return;
    this.encoding = enc;
    this.forceDirty = true;
    this.flash(t('msg.encodingSet', { enc: encodingLabel(enc) }));
  }

  setEol(eol: Eol): void {
    if (eol === this.eol) return;
    this.eol = eol;
    this.forceDirty = true;
  }

  reloadWithEncoding(enc: EncodingId): void | Promise<void> {
    const file = this.path;
    if (!file) {
      this.flash(t('msg.noReload'), 'warn');
      return;
    }
    return this.guardUnsaved(async () => {
      await this.openPath(file, enc);
    });
  }

  quit(): void | Promise<void> {
    return this.guardUnsaved(async () => {
      this.rememberView();
      await clearRecovery(this.path);
      this.exitRequested = true;
      this.opts.onExit?.();
    });
  }

  // ---- find / replace ----

  openFind(replace: boolean): void {
    const sel = this.doc.selectedText();
    const prev = this.find;
    const seed = sel && !sel.includes('\n') ? sel : (prev?.query.value ?? this.lastQuery);
    this.find = {
      replace,
      query: new TextField(seed),
      replacement: prev?.replacement ?? new TextField(''),
      field: 'find',
      focus: true,
      caseSensitive: prev?.caseSensitive ?? false,
      wholeWord: prev?.wholeWord ?? false,
      regex: prev?.regex ?? false,
      total: 0,
      index: 0,
    };
    this.refreshFind(true);
    this.ensureCursorVisible();
  }

  closeFind(): void {
    if (this.find) this.lastQuery = this.find.query.value;
    this.find = null;
    this.ensureCursorVisible();
  }

  private matcher(): Matcher {
    const f = this.find;
    const query = f ? f.query.value : this.lastQuery;
    return buildMatcher({ query, caseSensitive: f?.caseSensitive ?? false, wholeWord: f?.wholeWord ?? false, regex: f?.regex ?? false });
  }

  /** All matches of a multi-line matcher, cached per document revision and pattern. */
  private multiRanges(re: RegExp): Range[] {
    const key = `${re.source}/${re.flags}`;
    const c = this.rangeCache;
    if (c && c.rev === this.doc.revision && c.key === key) return c.ranges;
    const ranges = allRanges(new DocIndex(this.doc.buffer), re);
    this.rangeCache = { rev: this.doc.revision, key, ranges };
    return ranges;
  }

  private sameRange(r: Range, sel: { start: Pos; end: Pos } | null): boolean {
    return !!sel && comparePos(r.start, sel.start) === 0 && comparePos(r.end, sel.end) === 0;
  }

  /** Matches on one line for highlighting; only meaningful while the find panel is open. */
  matchesForLine(line: number, text: string): (Match & { current?: boolean })[] {
    if (!this.find) return [];
    const m = this.matcher();
    if (!m || 'error' in m) return [];
    if (!m.multi) return matchesInLine(m.re, text, line);
    const sel = this.doc.selection();
    return rangesOnLine(this.multiRanges(m.re), line, text.length).map((p) => ({
      line,
      start: p.start,
      end: p.end,
      current: this.sameRange(p.range, sel),
    }));
  }

  /** Re-evaluates the match counter; with `jump` also selects the first match at/after the selection start. */
  refreshFind(jump = false): void {
    const f = this.find;
    if (!f) return;
    const m = this.matcher();
    f.error = m && 'error' in m ? m.error : undefined;
    if (!m || 'error' in m) {
      f.total = 0;
      f.index = 0;
      return;
    }
    const sel = this.doc.selection();
    const origin = sel?.start ?? this.doc.cursor;
    if (m.multi) {
      const ranges = this.multiRanges(m.re);
      if (jump && f.query.value) {
        const hit = pickRange(ranges, origin, false);
        if (hit) this.selectRange(hit);
      }
      const now = this.doc.selection();
      f.total = ranges.length;
      const at = ranges.findIndex((r) => this.sameRange(r, now));
      f.index = at >= 0 ? at + 1 : 0;
      return;
    }
    if (jump && f.query.value) {
      const hit = findMatch(this.doc.buffer, m.re, origin, false, true);
      if (hit) this.selectMatch(hit.line, hit.start, hit.end);
    }
    const here = this.doc.selection() ?? { start: this.doc.cursor, end: this.doc.cursor };
    const counts = countMatches(this.doc.buffer, m.re, here.start);
    f.total = counts.total;
    const atMatch = matchesInLine(m.re, this.doc.buffer.line(here.start.line), here.start.line).some((x) => x.start === here.start.col && here.end.line === here.start.line && x.end === here.end.col);
    f.index = atMatch ? counts.before + 1 : 0;
  }

  private selectMatch(line: number, start: number, end: number): void {
    this.selectRange({ start: { line, col: start }, end: { line, col: end } });
  }

  private selectRange(r: Range): void {
    this.doc.moveTo(r.start);
    this.doc.moveTo(r.end, true);
  }

  findNext(backward = false): void {
    const m = this.matcher();
    if (!m) {
      this.openFind(false);
      return;
    }
    if ('error' in m) {
      this.flash(t('msg.regexError', { err: m.error }), 'error');
      return;
    }
    const sel = this.doc.selection();
    const from = backward ? (sel?.start ?? this.doc.cursor) : (sel?.end ?? this.doc.cursor);
    let range: Range | null;
    if (m.multi) {
      range = pickRange(this.multiRanges(m.re), from, backward);
    } else {
      const hit = findMatch(this.doc.buffer, m.re, from, backward, true);
      range = hit && { start: { line: hit.line, col: hit.start }, end: { line: hit.line, col: hit.end } };
    }
    if (!range) {
      this.flash(t('msg.notFound', { q: this.find?.query.value ?? this.lastQuery }), 'warn');
      return;
    }
    const wrapped = backward ? comparePos(range.start, from) >= 0 : comparePos(range.start, from) < 0;
    this.selectRange(range);
    if (wrapped) this.flash(backward ? t('msg.wrapBottom') : t('msg.wrapTop'), 'warn');
    this.refreshFind();
  }

  replaceCurrent(): void {
    const f = this.find;
    const m = this.matcher();
    if (!f || !m || 'error' in m) return this.findNext();
    const sel = this.doc.selection();
    if (sel && m.multi) {
      if (this.multiRanges(m.re).some((r) => this.sameRange(r, sel))) this.replaceSelection(sel.start, this.doc.selectedText(), m.re, f);
    } else if (sel && sel.start.line === sel.end.line) {
      const text = this.doc.buffer.line(sel.start.line);
      const isMatch = matchesInLine(m.re, text, sel.start.line).some((x) => x.start === sel.start.col && x.end === sel.end.col);
      if (isMatch) this.replaceSelection(sel.start, text.slice(sel.start.col, sel.end.col), m.re, f);
    }
    this.findNext();
  }

  private replaceSelection(start: Pos, removed: string, re: RegExp, f: FindState): void {
    const inserted = expandReplacement(re, removed, f.replacement.value, f.regex).replace(/\r\n?/g, '\n');
    this.doc.applyEdits([{ start, removed, inserted }]);
  }

  replaceAll(): void {
    const f = this.find;
    const m = this.matcher();
    if (!f || !m || 'error' in m) return;
    const edits = m.multi
      ? replaceAllRanges(this.doc.buffer, this.multiRanges(m.re), m.re, f.replacement.value, f.regex)
      : replaceAllEdits(this.doc.buffer, m.re, f.replacement.value, f.regex);
    if (edits.length === 0) {
      this.flash(t('msg.nothingToReplace'), 'warn');
      return;
    }
    this.doc.applyEdits(edits, this.doc.cursor);
    this.flash(t('msg.replaced', { n: edits.length }));
    this.refreshFind();
  }

  // ---- input ----

  /** Entry point for every terminal event. */
  handleInput(ev: InputEvent): void {
    let pending: void | Promise<void> = undefined;
    try {
      pending = this.dispatch(ev);
    } catch (e) {
      this.flash(t('msg.error', { msg: (e as Error).message }), 'error', 6000);
    }
    this.afterInput();
    if (pending) {
      pending.then(
        () => this.afterInput(),
        (e: unknown) => {
          this.flash(t('msg.error', { msg: (e as Error).message }), 'error', 6000);
          this.afterInput();
        },
      );
    }
  }

  private afterInput(): void {
    const c = this.doc.cursor;
    const state = `${this.doc.revision}:${c.line}:${c.col}:${this.doc.anchor?.line}:${this.doc.anchor?.col}:${this.find ? 1 : 0}`;
    if (state !== this.seenState) {
      this.seenState = state;
      this.ensureCursorVisible();
      if (this.find) this.refreshFind();
      this.scheduleAutosave();
    }
    this.emit();
  }

  private scheduleAutosave(): void {
    if (this.opts.autosave === false) return;
    clearTimeout(this.autosaveTimer);
    if (!this.dirty) return;
    this.autosaveTimer = setTimeout(() => {
      if (this.dirty) void writeRecovery(this.path, this.doc.text).catch(() => {});
    }, AUTOSAVE_DELAY_MS);
    this.autosaveTimer.unref();
  }

  private dispatch(ev: InputEvent): void | Promise<void> {
    switch (ev.type) {
      case 'mouse':
        return this.onMouse(ev);
      case 'paste':
        return this.onText(ev.text, true);
      case 'text':
        return this.onText(ev.text, false);
      case 'key':
        return this.onKey(ev);
    }
  }

  private onText(text: string, pasted: boolean): void | Promise<void> {
    if (this.dialog) return dialogText(this, this.dialog, text);
    if (this.menu.open) return;
    const f = this.find;
    if (f?.focus) {
      (f.field === 'find' ? f.query : f.replacement).insert(text);
      if (f.field === 'find') this.refreshFind(true);
      return;
    }
    if (pasted) {
      this.doc.insert(text);
      return;
    }
    this.typeText(text);
  }

  typeText(text: string): void {
    if (this.overwrite && !this.doc.selection() && !text.includes('\n')) {
      const { line, col } = this.doc.cursor;
      if (col < this.doc.buffer.line(line).length) this.doc.move('right', true);
    }
    this.doc.insert(text);
  }

  private onKey(k: KeyEvent): void | Promise<void> {
    if (this.dialog) return handleDialogKey(this, this.dialog, k);
    if (this.menu.open) return this.menuKey(k);
    const id = keyId(k);
    const f = this.find;
    if (f?.focus && this.findKey(k, id)) return;
    const binding = this.keymap.get(id);
    if (binding) return this.run(binding.cmd, binding.arg);
  }

  private findKey(k: KeyEvent, id: string): boolean {
    const f = this.find!;
    const field = f.field === 'find' ? f.query : f.replacement;
    switch (id) {
      case 'escape':
        this.closeFind();
        return true;
      case 'return':
        if (f.field === 'replace') this.replaceCurrent();
        else this.findNext();
        return true;
      case 'shift+return':
        this.findNext(true);
        return true;
      case 'tab':
      case 'shift+tab':
        if (f.replace) f.field = f.field === 'find' ? 'replace' : 'find';
        return true;
      case 'up':
        this.findNext(true);
        return true;
      case 'down':
        this.findNext();
        return true;
      case 'alt+c':
        f.caseSensitive = !f.caseSensitive;
        this.refreshFind(true);
        return true;
      case 'alt+w':
        f.wholeWord = !f.wholeWord;
        this.refreshFind(true);
        return true;
      case 'alt+r':
        f.regex = !f.regex;
        this.refreshFind(true);
        return true;
      case 'alt+a':
      case 'ctrl+return':
        if (f.replace) this.replaceAll();
        return true;
    }
    if (field.key(k)) {
      if (f.field === 'find') this.refreshFind(true);
      return true;
    }
    return false;
  }

  /** Runs a command by id. */
  run(id: string, arg?: unknown): void | Promise<void> {
    const cmd = COMMANDS[id];
    if (!cmd) {
      this.flash(t('msg.unknownCommand', { id }), 'error');
      return;
    }
    if (cmd.enabled && !cmd.enabled(this)) return;
    return cmd.run(this, arg);
  }

  isEnabled(id: string): boolean {
    const cmd = COMMANDS[id];
    return !!cmd && (!cmd.enabled || cmd.enabled(this));
  }

  // ---- menu ----

  openMenu(index = 0): void {
    this.cancelSubmenuClose();
    this.menu = { open: true, index, item: this.firstItem(index), sub: -1, subTop: 0 };
  }

  closeMenu(): void {
    this.menu.open = false;
    this.cancelSubmenuClose();
  }

  /** Cells that keep an open submenu alive (its parent row and its box) and the parent box, set by the renderer. */
  submenuKeep: { x: number; y: number; w: number; h: number }[] = [];
  menuParentBox = { x: 0, y: 0, w: 0 };
  private subCloseTimer: ReturnType<typeof setTimeout> | undefined;

  private cancelSubmenuClose(): void {
    clearTimeout(this.subCloseTimer);
    this.subCloseTimer = undefined;
  }

  /**
   * The pointer left the submenu's parent row. The way to the submenu usually crosses other rows, so closing is
   * deferred: after a delay it re-checks where the pointer actually is.
   */
  leaveSubmenu(): void {
    if (this.subCloseTimer) return;
    this.subCloseTimer = setTimeout(() => {
      this.subCloseTimer = undefined;
      const m = this.menu;
      const p = this.hover;
      if (!m.open || m.sub < 0) return;
      if (p && this.submenuKeep.some((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)) return;
      const box = this.menuParentBox;
      const row = p && p.x > box.x && p.x < box.x + box.w - 1 ? MENUS[m.index]?.items[p.y - box.y - 1] : undefined;
      const at = p ? p.y - box.y - 1 : -1;
      if (row && !row.sep && row.submenu) this.openSubmenu(m.index, at);
      else {
        m.sub = -1;
        if (row && !row.sep && (!row.cmd || this.isEnabled(row.cmd))) m.item = at;
      }
      this.emit();
    }, SUBMENU_CLOSE_DELAY_MS);
    this.subCloseTimer.unref();
  }

  private firstItem(menu: number): number {
    return this.stepItem(MENUS[menu]!.items, -1, 1);
  }

  private stepItem(items: MenuItem[], from: number, dir: 1 | -1): number {
    for (let n = 1; n <= items.length; n++) {
      const i = (((from + dir * n) % items.length) + items.length) % items.length;
      const it = items[i]!;
      if (!it.sep && (!it.cmd || this.isEnabled(it.cmd))) return i;
    }
    return from;
  }

  /** Opens the submenu of the highlighted item, if it has one. */
  openSubmenu(menu: number, item: number): boolean {
    const parent = MENUS[menu]?.items[item];
    const sub = parent?.submenu;
    if (!sub) return false;
    const checked = parent.selectChecked ? sub.findIndex((it) => !it.sep && it.checked?.(this)) : -1;
    this.menu = { open: true, index: menu, item, sub: checked >= 0 ? checked : this.stepItem(sub, -1, 1), subTop: 0 };
    return true;
  }

  async activateMenuItem(menu: number, item: number, subItem = -1): Promise<void> {
    const parent = MENUS[menu]?.items[item];
    if (parent?.submenu && subItem < 0) {
      this.openSubmenu(menu, item);
      return;
    }
    const it = subItem >= 0 ? parent?.submenu?.[subItem] : parent;
    if (!it || it.sep || !it.cmd) return;
    if (!this.isEnabled(it.cmd)) return;
    if (!it.keepOpen) this.closeMenu();
    await this.run(it.cmd, it.arg);
    if (it.keepOpen) this.keepSubmenuValid();
  }

  /** After a toggle inside a submenu the highlighted item may have become disabled (Show All / Hide All). */
  private keepSubmenuValid(): void {
    const m = this.menu;
    const list = MENUS[m.index]?.items[m.item]?.submenu;
    if (!list || m.sub < 0) return;
    const cur = list[m.sub];
    if (cur && cur.cmd && !this.isEnabled(cur.cmd)) m.sub = this.stepItem(list, m.sub, -1);
  }

  private menuKey(k: KeyEvent): void | Promise<void> {
    const m = this.menu;
    const id = keyId(k);
    const count = MENUS.length;
    const subList = m.sub >= 0 ? MENUS[m.index]?.items[m.item]?.submenu : undefined;
    if (subList) {
      switch (id) {
        case 'escape':
        case 'left':
          m.sub = -1;
          return;
        case 'f10':
          this.closeMenu();
          return;
        case 'up':
          m.sub = this.stepItem(subList, m.sub, -1);
          return;
        case 'down':
          m.sub = this.stepItem(subList, m.sub, 1);
          return;
        case 'home':
          m.sub = this.stepItem(subList, -1, 1);
          return;
        case 'return':
        case 'space':
          return this.activateMenuItem(m.index, m.item, m.sub);
      }
      return;
    }
    switch (id) {
      case 'escape':
      case 'f10':
        this.closeMenu();
        return;
      case 'left':
        m.index = (m.index + count - 1) % count;
        m.item = this.firstItem(m.index);
        return;
      case 'right':
        if (this.openSubmenu(m.index, m.item)) return;
        m.index = (m.index + 1) % count;
        m.item = this.firstItem(m.index);
        return;
      case 'up':
        m.item = this.stepItem(MENUS[m.index]!.items, m.item, -1);
        return;
      case 'down':
        m.item = this.stepItem(MENUS[m.index]!.items, m.item, 1);
        return;
      case 'home':
        m.item = this.firstItem(m.index);
        return;
      case 'return':
      case 'space':
        return this.activateMenuItem(m.index, m.item);
    }
    const hot = MENUS.findIndex((x) => `alt+${x.mnemonic}` === id);
    if (hot >= 0) this.openMenu(hot);
  }

  // ---- mouse ----

  /** Maps a screen cell to a document position using the last rendered frame. */
  editorPos(x: number, y: number): Pos {
    const L = this.layout();
    const rows = this.rowMap;
    if (rows.length === 0) return this.doc.cursor;
    const r = rows[Math.min(Math.max(y - L.editor.y, 0), rows.length - 1)]!;
    const text = this.doc.buffer.line(r.line);
    const dx = Math.max(x - L.textX, 0) + (this.config.wordWrap ? 0 : this.scroll.left) + r.baseCol;
    for (const c of lineCells(text)) {
      if (c.index < r.start) continue;
      if (c.index >= r.end) break;
      if (dx < c.col + c.width) return { line: r.line, col: dx - c.col >= c.width / 2 && c.width > 1 ? c.index + c.text.length : c.index };
    }
    const last = r.end >= text.length;
    return { line: r.line, col: last ? text.length : prevBoundary(text, r.end) };
  }

  private onMouse(ev: MouseEvent): void | Promise<void> {
    if (!this.config.mouse) return;
    if (ev.kind === 'move') {
      if (this.hover?.x === ev.x && this.hover.y === ev.y) return;
      this.hover = { x: ev.x, y: ev.y };
      this.hitAt(ev.x, ev.y)?.onHover?.();
      return;
    }
    if (ev.kind === 'wheelUp' || ev.kind === 'wheelDown') {
      const dir = ev.kind === 'wheelUp' ? -1 : 1;
      const list = this.menu.open && this.menu.sub >= 0 ? MENUS[this.menu.index]?.items[this.menu.item]?.submenu : undefined;
      if (list) {
        for (let n = 0; n < 3; n++) this.menu.sub = this.stepItem(list, this.menu.sub, dir);
        return;
      }
      const d = this.dialog;
      if (d?.kind === 'list') d.index = Math.min(Math.max(d.index + dir, 0), d.items.length - 1);
      else if (d?.kind === 'info') d.scroll = Math.min(Math.max(d.scroll + dir * 2, 0), Math.max(d.lines.length - 1, 0));
      else if (d?.kind === 'file') d.index = Math.max(d.index + dir, 0);
      else if (!d && !this.menu.open) {
        if (ev.shift) this.scrollBy(0, dir * 6);
        else this.scrollBy(dir * 3);
      }
      return;
    }
    if (this.drag && (ev.kind === 'drag' || ev.kind === 'up')) {
      this.doc.moveTo(this.editorPos(ev.x, ev.y), true);
      if (ev.kind === 'up') this.drag = false;
      this.dragScroll(ev.y);
      return;
    }
    if (ev.kind !== 'down' || ev.button === 'none') return;
    return this.hitAt(ev.x, ev.y)?.onMouse(ev);
  }

  /** Topmost hit region under a cell (later registrations win). */
  private hitAt(x: number, y: number): Hit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return undefined;
  }

  private dragScroll(y: number): void {
    const L = this.layout();
    if (y < L.editor.y) this.scrollBy(-1);
    else if (y >= L.editor.y + L.editor.h) this.scrollBy(1);
  }

  /** Called by the renderer's editor hit on a left-button press. */
  editorMouseDown(ev: MouseEvent): void {
    this.closeMenu();
    const pos = this.editorPos(ev.x, ev.y);
    const now = Date.now();
    const l = this.lastClick;
    const count = now - l.t < DOUBLE_CLICK_MS && l.x === ev.x && l.y === ev.y ? Math.min(l.count + 1, 3) : 1;
    this.lastClick = { t: now, x: ev.x, y: ev.y, count };
    if (count === 2) {
      const text = this.doc.buffer.line(pos.line);
      let a = pos.col;
      let b = pos.col;
      const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
      if (isWord(text[a])) {
        while (a > 0 && isWord(text[a - 1])) a--;
        while (b < text.length && isWord(text[b])) b++;
      } else if (b < text.length) b++;
      this.doc.moveTo({ line: pos.line, col: a });
      this.doc.moveTo({ line: pos.line, col: b }, true);
    } else if (count === 3) {
      this.doc.moveTo({ line: pos.line, col: 0 });
      if (pos.line < this.doc.buffer.lineCount - 1) this.doc.moveTo({ line: pos.line + 1, col: 0 }, true);
      else this.doc.moveTo({ line: pos.line, col: this.doc.buffer.line(pos.line).length }, true);
    } else {
      this.doc.moveTo(pos, ev.shift);
      this.drag = true;
    }
  }

  /** For tests / the renderer: whether a column in the given row maps to display. */
  displayColOf(line: number, col: number): number {
    return displayWidth(this.doc.buffer.line(line), col);
  }

  colAtWidth(line: number, width: number): number {
    return colForWidth(this.doc.buffer.line(line), width);
  }

  // Exposed so dialog hits (mouse) can reuse the keyboard paths.
  pickButton = pickButton;
  pickListItem = pickListItem;
}

function formatKey(id: string): string {
  return id
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p === 'pageup' ? 'PgUp' : p === 'pagedown' ? 'PgDn' : p[0]!.toUpperCase() + p.slice(1)))
    .join('+');
}
