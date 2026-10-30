import stringWidth from 'string-width';
import { displayWidth, lineCells } from '../core/buffer/graphemes.js';
import { handleDialogKey, visibleEntries, type Dialog } from '../core/dialogs.js';
import { EOL_LABELS } from '../core/fs/eol.js';
import { formatMode } from '../core/fs/permissions.js';
import { encodingLabel } from '../core/fs/encoding.js';
import { t, type MsgKey } from '../core/i18n.js';
import { MENUS } from '../core/menus.js';
import type { Hit, RowInfo, Session } from '../core/session.js';
import type { TextField } from '../core/text-field.js';
import type { KeyEvent } from '../input/parser.js';
import { wrapStarts, type Layout } from './layout.js';
import { merge, Screen, style, type Style } from './screen.js';
import { THEMES, type Theme } from './theme.js';

interface Ctx {
  s: Session;
  screen: Screen;
  theme: Theme;
  L: Layout;
  hits: Hit[];
  /** Hover tooltips (shown in the status bar), registered by the menu bar and toolbar. */
  tips: { x: number; y: number; w: number; text: string }[];
  /** Right edge of the status bar's left text area. */
  statusLeftMax: number;
}

const w =(t: string): number => stringWidth(t);

function truncate(text: string, width: number): string {
  if (w(text) <= width) return text;
  let out = '';
  for (const ch of text) {
    if (w(out + ch) > width - 1) break;
    out += ch;
  }
  return out + '…';
}

/** Keeps the tail of a path visible. */
function truncateLeft(text: string, width: number): string {
  if (w(text) <= width) return text;
  let out = '';
  for (const ch of [...text].reverse()) {
    if (w(ch + out) > width - 1) break;
    out = ch + out;
  }
  return '…' + out;
}

function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(width - w(text), 0));
}

/** True when the pointer is over the w-wide span starting at (x, y). */
function over(c: Ctx, x: number, y: number, width: number): boolean {
  const h = c.s.hover;
  return !!h && h.y === y && h.x >= x && h.x < x + width;
}

const key = (name: string): KeyEvent => ({ type: 'key', name, ctrl: false, alt: false, shift: false, super: false });

/** Draws the whole UI into a fresh Screen and refreshes the session's hit map / row map. */
export function renderFrame(s: Session): Screen {
  const theme = THEMES[s.config.theme];
  const L = s.layout();
  const screen = new Screen(L.cols, L.rows, theme.editor);
  const hits: Hit[] = [];
  const ctx: Ctx = { s, screen, theme, L, hits, tips: [], statusLeftMax: 0 };

  if (L.tooSmall) {
    screen.put(0, 0, truncate(t('st.tooSmall'), L.cols), theme.status);
    s.hits = [];
    s.rowMap = [];
    return screen;
  }

  s.rowMap = drawEditor(ctx);
  drawFind(ctx);
  drawToolbar(ctx);
  drawStatus(ctx);
  const menuXs = drawMenuBar(ctx);
  drawTip(ctx);
  if (s.menu.open) drawDropdown(ctx, menuXs);
  if (s.dialog) drawDialog(ctx, s.dialog);
  s.hits = hits;
  return screen;
}

// ---- menu bar ----

function drawMenuBar(c: Ctx): number[] {
  const { s, screen, theme, L, hits } = c;
  screen.fill(0, L.menuY, L.cols, 1, theme.menu);
  const xs: number[] = [];
  let x = 0;
  MENUS.forEach((m, i) => {
    const text = ` ${m.label} `;
    xs.push(x);
    const active = (s.menu.open && s.menu.index === i) || (!s.dialog && over(c, x, L.menuY, w(text)));
    const base = active ? theme.menuActive : theme.menu;
    screen.put(x, L.menuY, text, base);
    // Underline the mnemonic letter: " File(F) " -> the F before the closing parenthesis.
    screen.put(x + w(text) - 3, L.menuY, m.mnemonic.toUpperCase(), style({ ...base, underline: true, bold: true }));
    c.tips.push({ x, y: L.menuY, w: w(text), text: `${m.label}   Alt+${m.mnemonic.toUpperCase()}   F10` });
    hits.push({
      x,
      y: L.menuY,
      w: w(text),
      h: 1,
      onMouse: () => (s.menu.open && s.menu.index === i ? s.closeMenu() : s.openMenu(i)),
      onHover: () => s.menu.open && s.menu.index !== i && s.openMenu(i),
    });
    x += w(text);
  });
  return xs;
}

function drawDropdown(c: Ctx, xs: number[]): void {
  const { s, screen, theme, L, hits } = c;
  const menu = MENUS[s.menu.index]!;
  // Clicking anywhere else closes the menu.
  hits.push({ x: 0, y: 0, w: L.cols, h: L.rows, onMouse: () => s.closeMenu() });
  const labelW = Math.max(...menu.items.map((it) => w(it.label)));
  const keyW = Math.max(...menu.items.map((it) => (it.cmd ? w(s.shortcutFor(it.cmd, it.arg)) : 0)));
  const inner = 2 + labelW + (keyW ? 3 + keyW : 0) + 1;
  const boxW = inner + 2;
  const x = Math.min(xs[s.menu.index] ?? 0, Math.max(L.cols - boxW, 0));
  const y = L.menuY + 1;
  const boxH = menu.items.length + 2;
  screen.fill(x, y, boxW, boxH, theme.dropdown);
  screen.put(x, y, '┌' + '─'.repeat(inner) + '┐', theme.dropdown);
  screen.put(x, y + boxH - 1, '└' + '─'.repeat(inner) + '┘', theme.dropdown);
  // Registered before the items so the items (added later) win; clicks on borders/separators are swallowed.
  hits.push({ x, y, w: boxW, h: boxH, onMouse: () => {} });
  menu.items.forEach((it, i) => {
    const row = y + 1 + i;
    screen.put(x, row, '│', theme.dropdown);
    screen.put(x + boxW - 1, row, '│', theme.dropdown);
    if (it.sep) {
      screen.put(x, row, '├' + '─'.repeat(inner) + '┤', theme.dropdown);
      return;
    }
    const enabled = !it.cmd || s.isEnabled(it.cmd);
    const selected = i === s.menu.item;
    const st = selected ? theme.dropdownActive : enabled ? theme.dropdown : theme.dropdownDisabled;
    const check = it.checked?.(s) ? '✓ ' : '  ';
    const shortcut = it.cmd ? s.shortcutFor(it.cmd, it.arg) : '';
    screen.fill(x + 1, row, inner, 1, st);
    screen.put(x + 1, row, check + it.label, st);
    if (shortcut) screen.put(x + boxW - 2 - w(shortcut), row, shortcut, st);
    if (enabled) {
      hits.push({ x: x + 1, y: row, w: inner, h: 1, onMouse: () => s.activateMenuItem(s.menu.index, i), onHover: () => void (s.menu.item = i) });
    }
  });
  // Keep the menu bar clickable above the backdrop.
  MENUS.forEach((m, i) => {
    const ww = w(` ${m.label} `);
    hits.push({
      x: xs[i]!,
      y: L.menuY,
      w: ww,
      h: 1,
      onMouse: () => (s.menu.index === i ? s.closeMenu() : s.openMenu(i)),
      onHover: () => s.menu.index !== i && s.openMenu(i),
    });
  });
}

// ---- toolbar ----

/** Plain labels separated by single spaces; groups are separated by " | ". */
const TOOLBAR: { key: MsgKey; cmd: string }[][] = [
  [
    { key: 'tb.new', cmd: 'file.new' },
    { key: 'tb.open', cmd: 'file.open' },
    { key: 'tb.save', cmd: 'file.save' },
    { key: 'tb.close', cmd: 'file.close' },
  ],
  [
    { key: 'tb.cut', cmd: 'edit.cut' },
    { key: 'tb.copy', cmd: 'edit.copy' },
    { key: 'tb.paste', cmd: 'edit.paste' },
  ],
  [
    { key: 'tb.undo', cmd: 'edit.undo' },
    { key: 'tb.redo', cmd: 'edit.redo' },
  ],
  [
    { key: 'tb.search', cmd: 'find.open' },
    { key: 'tb.replace', cmd: 'find.replace' },
  ],
];

function drawToolbar(c: Ctx): void {
  const { s, screen, theme, L, hits } = c;
  screen.fill(0, L.toolbarY, L.cols, 1, theme.toolbar);
  let x = 1;
  for (let g = 0; g < TOOLBAR.length; g++) {
    if (g > 0) {
      if (x + 3 > L.cols - 1) break;
      screen.put(x, L.toolbarY, ' | ', theme.toolbarDisabled);
      x += 3;
    }
    const group = TOOLBAR[g]!;
    for (let i = 0; i < group.length; i++) {
      const item = group[i]!;
      const text = t(item.key);
      if (x + w(text) > L.cols - 1) {
        screen.put(x, L.toolbarY, '…', theme.toolbar);
        return;
      }
      const enabled = s.isEnabled(item.cmd);
      const hot = enabled && !s.dialog && !s.menu.open && over(c, x, L.toolbarY, w(text));
      screen.put(x, L.toolbarY, text, hot ? theme.buttonActive : enabled ? theme.toolbar : theme.toolbarDisabled);
      hits.push({ x, y: L.toolbarY, w: w(text), h: 1, onMouse: () => s.run(item.cmd) });
      const shortcut = s.shortcutFor(item.cmd);
      c.tips.push({ x, y: L.toolbarY, w: w(text), text: shortcut ? `${text}   ${shortcut}` : text });
      x += w(text) + 1;
    }
    x -= 1; // no trailing space after the last label of a group
  }
}

// ---- status bar ----

function drawStatus(c: Ctx): void {
  const { s, screen, theme, L, hits } = c;
  const y = L.statusY;
  screen.fill(0, y, L.cols, 1, theme.status);
  const buf = s.doc.buffer;
  const { line, col } = s.doc.cursor;
  const colNo = [...buf.line(line).slice(0, col)].length + 1;
  const sel = s.doc.selection();
  const selLen = sel ? buf.posToOffset(sel.end) - buf.posToOffset(sel.start) : 0;

  type Seg = { text: string; onClick?: () => void; optional?: number };
  let segs: Seg[] = [
    { text: `Length:${buf.length}  Lines:${buf.lineCount}`, optional: 2 },
    { text: `Ln:${line + 1}  Col:${colNo}${selLen ? `  Sel:${selLen}` : ''}`, onClick: () => void s.run('goto') },
    { text: EOL_LABELS[s.eol].match(/\((.*)\)/)![1]!, onClick: () => s.openMenu(4) },
    { text: encodingLabel(s.encoding), onClick: () => s.openMenu(4) },
    ...(s.mode === null ? [] : [{ text: formatMode(s.mode), optional: 3, onClick: () => void s.run('file.permissions') }]),
    { text: s.lang.name, optional: 1, onClick: () => void s.run('view.syntaxLanguage') },
    { text: s.overwrite ? 'OVR' : 'INS', onClick: () => void s.run('edit.toggleOverwrite') },
  ];
  const sepText = ' | ';
  const widthOf = (list: Seg[]) => list.reduce((n, g) => n + w(g.text), 0) + sepText.length * list.length + 1;
  // Narrow terminals drop the least important segments first (language, then length/lines, then permissions).
  for (const level of [1, 2, 3]) if (widthOf(segs) > L.cols - 16) segs = segs.filter((g) => g.optional !== level);
  const total = widthOf(segs);
  const rightX = Math.max(L.cols - total, 0);
  let x = rightX;
  const leftMax = Math.max(rightX - 1, 0);

  if (rightX >= 8) {
    for (const g of segs) {
      screen.put(x, y, sepText, theme.status);
      x += sepText.length;
      screen.put(x, y, g.text, theme.status);
      if (g.onClick) hits.push({ x, y, w: w(g.text), h: 1, onMouse: g.onClick });
      x += w(g.text);
    }
  }

  let left: string;
  let st = theme.status;
  if (s.message) {
    left = s.message.text;
    st = s.message.level === 'error' ? theme.statusError : s.message.level === 'warn' ? theme.statusWarn : theme.status;
  } else {
    left = `${s.path ?? s.title}${s.dirty ? ' *' : ''}${s.readOnly ? ` ${t('st.readOnly')}` : ''}`;
  }
  c.statusLeftMax = leftMax;
  screen.put(1, y, s.message ? truncate(left, leftMax - 1) : truncateLeft(left, leftMax - 1), st, Math.max(leftMax, 1));
}

/** While the pointer rests on a menu title or toolbar button, the status bar shows its shortcut. */
function drawTip(c: Ctx): void {
  const { s, screen, theme, L } = c;
  if (s.dialog || !s.hover || c.statusLeftMax < 8) return;
  const tip = c.tips.find((t) => t.y === s.hover!.y && s.hover!.x >= t.x && s.hover!.x < t.x + t.w);
  if (!tip || (tip.y === L.toolbarY && s.menu.open)) return;
  screen.fill(0, L.statusY, c.statusLeftMax, 1, theme.status);
  screen.put(1, L.statusY, truncate(tip.text, c.statusLeftMax - 2), theme.status, c.statusLeftMax);
}

// ---- find panel ----

function drawField(c: Ctx, f: TextField, x: number, y: number, width: number, active: boolean): void {
  const { screen, theme } = c;
  screen.fill(x, y, width, 1, theme.input);
  const before = displayWidth(f.value, f.caret);
  let skipW = Math.max(before - (width - 2), 0);
  let shown = '';
  let sw = 0;
  for (const ch of f.value) {
    const cw = w(ch);
    if (sw < skipW) {
      sw += cw;
      continue;
    }
    shown += ch;
  }
  skipW = Math.max(skipW, 0);
  screen.put(x, y, shown, theme.input, x + width);
  if (active) {
    const cx = x + before - skipW;
    if (cx < x + width) screen.put(cx, y, [...f.value.slice(f.caret)][0] ?? ' ', theme.cursor, x + width);
  }
}

function drawFind(c: Ctx): void {
  const { s, screen, theme, L, hits } = c;
  const f = s.find;
  if (!f) return;
  const rows = f.replace ? 2 : 1;
  screen.fill(0, L.find.y, L.cols, rows, theme.panel);
  const y = L.find.y;
  const findLabel = t('find.find');
  const replaceLabel = t('find.replace');
  const labelW = Math.max(w(findLabel), w(replaceLabel)) + 3;
  screen.put(0, y, padEnd(` ${findLabel}:`, labelW), theme.panel);

  const toggle = (label: string, on: boolean, action: () => void, x: number, yy: number): number => {
    const text = `[${label}]`;
    screen.put(x, yy, text, on ? theme.buttonActive : theme.button);
    hits.push({ x, y: yy, w: w(text), h: 1, onMouse: action });
    return x + w(text) + 1;
  };

  const count = f.error ? t('find.error', { err: truncate(f.error, 20) }) : f.query.value ? (f.total === 0 ? t('find.noResults') : `${f.index || '-'}/${f.total}`) : '';
  const firstRowW = 5 + 4 + 5 + 1 + Math.max(w(count), 6) + 1 + 3 * 4;
  const replaceBtnW = w(`[${t('find.btnReplace')}]`) + 1 + w(`[${t('find.btnReplaceAll')}]`);
  const rightW = Math.max(firstRowW, replaceBtnW + 1);
  const inputW = Math.max(L.cols - labelW - rightW - 1, 8);
  drawField(c, f.query, labelW, y, inputW, f.focus && f.field === 'find');
  hits.push({ x: labelW, y, w: inputW, h: 1, onMouse: () => { f.field = 'find'; f.focus = true; } });

  let x = labelW + inputW + 1;
  x = toggle('Aa', f.caseSensitive, () => ((f.caseSensitive = !f.caseSensitive), s.refreshFind(true)), x, y);
  x = toggle('W', f.wholeWord, () => ((f.wholeWord = !f.wholeWord), s.refreshFind(true)), x, y);
  x = toggle('.*', f.regex, () => ((f.regex = !f.regex), s.refreshFind(true)), x, y);
  if (count) screen.put(x, y, count, f.error ? style({ fg: '#c00000', bg: theme.panel.bg }) : theme.panel);
  x += Math.max(w(count), 6) + 1;
  x = toggle('▲', false, () => s.findNext(true), x, y);
  x = toggle('▼', false, () => s.findNext(false), x, y);
  toggle('x', false, () => s.closeFind(), x, y);

  if (f.replace) {
    const y2 = y + 1;
    screen.put(0, y2, padEnd(` ${replaceLabel}:`, labelW), theme.panel);
    drawField(c, f.replacement, labelW, y2, inputW, f.focus && f.field === 'replace');
    hits.push({ x: labelW, y: y2, w: inputW, h: 1, onMouse: () => { f.field = 'replace'; f.focus = true; } });
    let bx = labelW + inputW + 1;
    bx = toggle(t('find.btnReplace'), false, () => s.replaceCurrent(), bx, y2);
    toggle(t('find.btnReplaceAll'), false, () => s.replaceAll(), bx, y2);
  }
}

// ---- editor ----

function drawEditor(c: Ctx): RowInfo[] {
  const { s, screen, theme, L, hits } = c;
  const { editor, gutterW, textX, textW } = L;
  const buf = s.doc.buffer;
  const wrap = s.config.wordWrap;
  const wrapW = Math.max(textW - 1, 1);
  const rows: RowInfo[] = [];

  let line = s.scroll.top;
  while (rows.length < editor.h && line < buf.lineCount) {
    const text = buf.line(line);
    const starts = wrap ? wrapStarts(text, wrapW) : [0];
    let k = rows.length === 0 ? Math.min(s.scroll.sub, starts.length - 1) : 0;
    for (; k < starts.length && rows.length < editor.h; k++) {
      const start = starts[k]!;
      rows.push({ line, start, end: starts[k + 1] ?? text.length, baseCol: start === 0 ? 0 : displayWidth(text, start) });
    }
    line++;
  }

  const spansOf = rows.length ? s.spansFor(rows[0]!.line, rows[rows.length - 1]!.line) : () => undefined;
  const sel = s.doc.selection();
  const cursor = s.doc.cursor;
  const showCursor = !s.dialog && !s.menu.open && !(s.find?.focus ?? false);
  const cursorStyle = s.overwrite ? style({ ...theme.cursor, underline: true }) : theme.cursor;
  const ws = s.config.showWhitespace;

  rows.forEach((row, i) => {
    const y = editor.y + i;
    const text = buf.line(row.line);
    const isCursorLine = row.line === cursor.line;
    const base = isCursorLine && !sel && s.config.highlightCurrentLine ? merge(theme.editor, theme.currentLine) : theme.editor;
    screen.fill(textX, y, textW, 1, base);

    if (gutterW > 0) {
      const gst = isCursorLine ? theme.lineNumberCurrent : theme.lineNumber;
      screen.fill(0, y, gutterW, 1, theme.lineNumber);
      if (row.start === 0) screen.put(0, y, String(row.line + 1).padStart(gutterW - 2) + ' ', gst);
      screen.put(gutterW - 1, y, '│', theme.lineNumber);
    }

    const selLo = sel && row.line >= sel.start.line && row.line <= sel.end.line ? (row.line === sel.start.line ? sel.start.col : 0) : -1;
    const selHi = sel && selLo >= 0 ? (row.line === sel.end.line ? sel.end.col : Infinity) : -1;
    const selContinues = !!sel && row.line < sel.end.line;
    const matches = s.matchesForLine(row.line, text);
    const spans = spansOf(row.line);
    let si = 0;
    const left = wrap ? 0 : s.scroll.left;
    let lastX = textX;

    for (const cell of lineCells(text)) {
      if (cell.index < row.start) continue;
      if (cell.index >= row.end) break;
      const x = textX + cell.col - row.baseCol - left;
      if (x >= L.cols) break;
      if (x + cell.width <= textX) continue;

      let st = base;
      if (spans) {
        while (si < spans.length && spans[si]!.end <= cell.index) si++;
        const sp = spans[si];
        if (sp && sp.start <= cell.index) st = merge(base, theme.syntax[sp.kind]);
      }
      const m = matches.find((q) => cell.index >= q.start && cell.index < q.end);
      if (m) {
        const current = m.current ?? (sel && sel.start.line === row.line && sel.start.col === m.start && sel.end.col === m.end && sel.end.line === row.line);
        st = current ? theme.matchCurrent : theme.match;
      }
      if (selLo >= 0 && cell.index >= selLo && cell.index < selHi) st = theme.selection;

      let ch = cell.text;
      if (cell.text === '\t') {
        ch = ws ? '→' + ' '.repeat(cell.width - 1) : ' '.repeat(cell.width);
        if (ws && st === base) st = merge(base, theme.whitespace);
      } else if (cell.text === ' ' && ws) {
        ch = '·';
        if (st === base || st === merge(base, theme.syntax.comment)) st = merge(st, theme.whitespace);
      } else if (cell.width === 0) {
        ch = '·';
      }
      if (x < textX) {
        screen.put(textX, y, ' '.repeat(x + cell.width - textX), st, textX + textW);
      } else {
        screen.put(x, y, ch, st, textX + textW);
      }
      lastX = Math.max(lastX, x + cell.width);
    }

    // End-of-line marker / selected line break.
    if (row.end >= text.length && lastX < textX + textW) {
      if (selContinues) screen.put(lastX, y, ws ? '↵' : ' ', theme.selection, textX + textW);
      else if (ws) screen.put(lastX, y, '↵', merge(base, theme.whitespace), textX + textW);
    }

    if (showCursor && isCursorLine && cursor.col >= row.start && (cursor.col < row.end || (row.end >= text.length && cursor.col <= text.length))) {
      const cx = textX + displayWidth(text, cursor.col) - row.baseCol - left;
      if (cx >= textX && cx < textX + textW) {
        const glyph = lineCells(text).find((cell) => cell.index === cursor.col);
        const cw = Math.min(glyph && glyph.text !== '\t' ? Math.max(glyph.width, 1) : 1, textX + textW - cx);
        screen.restyle(cx, y, cw, cursorStyle);
      }
    }
  });

  const gutterClick = (ev: { x: number; y: number }) => {
    const p = s.editorPos(ev.x, ev.y);
    s.doc.moveTo({ line: p.line, col: 0 });
    if (p.line < buf.lineCount - 1) s.doc.moveTo({ line: p.line + 1, col: 0 }, true);
    else s.doc.moveTo({ line: p.line, col: buf.line(p.line).length }, true);
  };
  hits.push({
    x: 0,
    y: editor.y,
    w: L.cols,
    h: editor.h,
    onMouse: (ev) => {
      if (ev.button !== 'left') return;
      s.rowMap = rows;
      if (ev.x < textX && gutterW > 0) gutterClick(ev);
      else s.editorMouseDown(ev);
      if (s.find) s.find.focus = false;
    },
  });
  return rows;
}

// ---- dialogs ----

function box(c: Ctx, x: number, y: number, bw: number, bh: number, title: string): void {
  const { screen, theme } = c;
  screen.fill(x, y, bw, bh, theme.dialog);
  const top = '┌─ ' + title + ' ';
  screen.put(x, y, top + '─'.repeat(Math.max(bw - w(top) - 1, 0)) + '┐', theme.dialogTitle);
  for (let i = 1; i < bh - 1; i++) {
    screen.put(x, y + i, '│', theme.dialog);
    screen.put(x + bw - 1, y + i, '│', theme.dialog);
  }
  screen.put(x, y + bh - 1, '└' + '─'.repeat(bw - 2) + '┘', theme.dialog);
}

function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (w(cur + ch) > width) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function drawDialog(c: Ctx, d: Dialog): void {
  const { s, screen, theme, L, hits } = c;
  hits.push({ x: 0, y: 0, w: L.cols, h: L.rows, onMouse: () => {} });
  const maxW = Math.max(L.cols - 4, 20);

  if (d.kind === 'confirm') {
    const btnW = d.buttons.reduce((n, b) => n + w(b.label) + 4, 0);
    const bw = Math.min(Math.max(w(d.message) + 6, btnW + 4, 34), maxW);
    const lines = wrapText(d.message, bw - 6);
    const bh = lines.length + 6;
    const x = Math.floor((L.cols - bw) / 2);
    const y = Math.max(Math.floor((L.rows - bh) / 2), 0);
    box(c, x, y, bw, bh, d.title);
    lines.forEach((ln, i) => screen.put(x + 3, y + 2 + i, ln, theme.dialog));
    let bx = x + Math.floor((bw - btnW) / 2);
    d.buttons.forEach((b, i) => {
      const text = ` ${b.label} `;
      screen.put(bx, y + bh - 2, text, i === d.index ? theme.buttonActive : theme.button);
      const idx = i;
      hits.push({ x: bx, y: y + bh - 2, w: w(text), h: 1, onMouse: () => s.pickButton(s, d, idx), onHover: () => void (d.index = idx) });
      bx += w(text) + 2;
    });
    return;
  }

  if (d.kind === 'prompt') {
    const bw = Math.min(Math.max(w(d.label) + 8, 40), maxW);
    const bh = 7;
    const x = Math.floor((L.cols - bw) / 2);
    const y = Math.max(Math.floor((L.rows - bh) / 2), 0);
    box(c, x, y, bw, bh, d.title);
    screen.put(x + 2, y + 1, truncate(d.label, bw - 4), theme.dialog);
    drawField(c, d.field, x + 2, y + 2, bw - 4, true);
    if (d.error) screen.put(x + 2, y + 4, truncate(d.error, bw - 4), style({ fg: '#d03030', bg: theme.dialog.bg }));
    screen.put(x + 2, y + bh - 2, truncate(t('dlg.hintPrompt'), bw - 4), style({ fg: theme.dropdownDisabled.fg, bg: theme.dialog.bg }));
    return;
  }

  if (d.kind === 'list') {
    const listH = Math.min(d.items.length, Math.max(L.rows - 8, 3));
    const bw = Math.min(Math.max(...d.items.map((it) => w(it.label)), w(d.title)) + 10, maxW);
    const bh = listH + 4;
    const x = Math.floor((L.cols - bw) / 2);
    const y = Math.max(Math.floor((L.rows - bh) / 2), 0);
    box(c, x, y, bw, bh, d.title);
    const top = Math.max(0, Math.min(d.index - Math.floor(listH / 2), d.items.length - listH));
    for (let i = 0; i < listH; i++) {
      const it = d.items[top + i]!;
      const sel = top + i === d.index;
      const st = sel ? theme.dropdownActive : theme.dialog;
      screen.fill(x + 1, y + 1 + i, bw - 2, 1, st);
      screen.put(x + 2, y + 1 + i, truncate(`${it.checked ? '● ' : '  '}${it.label}`, bw - 4), st);
      const idx = top + i;
      hits.push({
        x: x + 1,
        y: y + 1 + i,
        w: bw - 2,
        h: 1,
        onMouse: () => {
          if (d.index === idx) return s.pickListItem(s, d, idx);
          d.index = idx;
        },
        onHover: () => void (d.index = idx),
      });
    }
    screen.put(x + 2, y + bh - 2, truncate(t('dlg.hintList'), bw - 4), style({ fg: theme.dropdownDisabled.fg, bg: theme.dialog.bg }));
    return;
  }

  if (d.kind === 'info') {
    const bw = Math.min(Math.max(...d.lines.map((ln) => w(ln)), w(d.title)) + 6, maxW);
    const listH = Math.min(d.lines.length, Math.max(L.rows - 8, 3));
    const bh = listH + 4;
    const x = Math.floor((L.cols - bw) / 2);
    const y = Math.max(Math.floor((L.rows - bh) / 2), 0);
    box(c, x, y, bw, bh, d.title);
    const top = Math.min(d.scroll, Math.max(d.lines.length - listH, 0));
    for (let i = 0; i < listH; i++) screen.put(x + 2, y + 1 + i, truncate(d.lines[top + i] ?? '', bw - 4), theme.dialog);
    screen.put(x + 2, y + bh - 2, truncate(t(d.lines.length > listH ? 'dlg.hintScroll' : 'dlg.hintClose'), bw - 4), style({ fg: theme.dropdownDisabled.fg, bg: theme.dialog.bg }));
    return;
  }

  // file dialog
  const bw = Math.min(Math.max(L.cols - 8, 40), 90);
  const bh = Math.min(Math.max(L.rows - 4, 10), 28);
  const x = Math.floor((L.cols - bw) / 2);
  const y = Math.max(Math.floor((L.rows - bh) / 2), 0);
  box(c, x, y, bw, bh, t(d.mode === 'open' ? 'dlg.openTitle' : 'dlg.saveTitle'));
  screen.put(x + 2, y + 1, truncateLeft(d.dir || t('dlg.drives'), bw - 4), style({ ...theme.dialogTitle }));
  const listH = bh - 7;
  const entries = visibleEntries(d);
  const top = Math.max(0, Math.min(d.index - Math.floor(listH / 2), entries.length - listH));
  for (let i = 0; i < listH; i++) {
    const e = entries[top + i];
    if (!e) break;
    const sel = top + i === d.index;
    const st = sel ? (d.focus === 'list' ? theme.dropdownActive : style({ ...theme.dialog, inverse: true })) : theme.dialog;
    screen.fill(x + 1, y + 2 + i, bw - 2, 1, st);
    screen.put(x + 2, y + 2 + i, truncate(`${e.dir ? '▸ ' : '  '}${e.name}${e.dir && e.name !== '..' && !e.name.endsWith('\\') ? '/' : ''}`, bw - 4), st);
    const idx = top + i;
    hits.push({
      x: x + 1,
      y: y + 2 + i,
      w: bw - 2,
      h: 1,
      onMouse: () => {
        if (d.index === idx && d.focus === 'list') return handleDialogKey(s, d, key('return'));
        d.index = idx;
        d.focus = 'list';
      },
      onHover: () => void (d.index = idx),
    });
  }
  const labelY = y + bh - 4;
  const nameLabel = t(d.mode === 'open' ? 'dlg.filterName' : 'dlg.fileName');
  screen.put(x + 2, labelY, nameLabel, theme.dialog);
  const lw = w(nameLabel);
  drawField(c, d.name, x + 2 + lw, labelY, bw - 4 - lw, d.focus === 'name');
  if (d.error) screen.put(x + 2, y + bh - 3, truncate(d.error, bw - 4), style({ fg: '#d03030', bg: theme.dialog.bg }));
  screen.put(x + 2, y + bh - 2, truncate(t('dlg.hintFile'), bw - 4), style({ fg: theme.dropdownDisabled.fg, bg: theme.dialog.bg }));
}
