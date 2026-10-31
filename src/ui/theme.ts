import type { ThemeId } from '../core/config/config.js';
import type { TokenKind } from '../core/syntax.js';
import type { MarkKind } from '../core/buffer/specials.js';
import { style, type Style } from './screen.js';

export interface Theme {
  id: ThemeId;
  menu: Style;
  menuActive: Style;
  dropdown: Style;
  dropdownActive: Style;
  dropdownDisabled: Style;
  toolbar: Style;
  toolbarDisabled: Style;
  editor: Style;
  currentLine: Style;
  lineNumber: Style;
  lineNumberCurrent: Style;
  selection: Style;
  match: Style;
  matchCurrent: Style;
  whitespace: Style;
  mark: Record<MarkKind, Style>;
  cursor: Style;
  status: Style;
  statusWarn: Style;
  statusError: Style;
  panel: Style;
  input: Style;
  button: Style;
  buttonActive: Style;
  dialog: Style;
  dialogTitle: Style;
  syntax: Record<TokenKind, Style>;
}

interface Palette {
  menu: [string, string];
  menuActive: [string, string];
  dropdown: [string, string];
  dropdownActive: [string, string];
  disabled: string;
  toolbar: [string, string];
  editor: [string, string];
  currentLine: string;
  lineNumber: [string, string];
  lineNumberCurrent: [string, string];
  selection: [string, string];
  match: [string, string];
  matchCurrent: [string, string];
  whitespace: string;
  mark: Record<MarkKind, [string, string]>;
  cursor: [string, string];
  status: [string, string];
  warn: [string, string];
  error: [string, string];
  panel: [string, string];
  input: [string, string];
  button: [string, string];
  buttonActive: [string, string];
  dialog: [string, string];
  syntax: Record<TokenKind, string>;
}

function build(id: ThemeId, p: Palette): Theme {
  const s = (c: [string, string], extra: Style = {}) => style({ fg: c[0], bg: c[1], ...extra });
  const syntax = {} as Record<TokenKind, Style>;
  for (const k of Object.keys(p.syntax) as TokenKind[]) {
    syntax[k] = style({ fg: p.syntax[k], bg: undefined, italic: k === 'comment' });
  }
  return {
    id,
    menu: s(p.menu),
    menuActive: s(p.menuActive),
    dropdown: s(p.dropdown),
    dropdownActive: s(p.dropdownActive),
    dropdownDisabled: style({ fg: p.disabled, bg: p.dropdown[1] }),
    toolbar: s(p.toolbar),
    toolbarDisabled: style({ fg: p.disabled, bg: p.toolbar[1] }),
    editor: s(p.editor),
    currentLine: style({ bg: p.currentLine }),
    lineNumber: s(p.lineNumber),
    lineNumberCurrent: s(p.lineNumberCurrent, { bold: true }),
    selection: s(p.selection),
    match: s(p.match),
    matchCurrent: s(p.matchCurrent, { bold: true }),
    whitespace: style({ fg: p.whitespace }),
    mark: Object.fromEntries((Object.keys(p.mark) as MarkKind[]).map((k) => [k, s(p.mark[k])])) as Record<MarkKind, Style>,
    cursor: s(p.cursor),
    status: s(p.status),
    statusWarn: s(p.warn),
    statusError: s(p.error),
    panel: s(p.panel),
    input: s(p.input),
    button: s(p.button),
    buttonActive: s(p.buttonActive, { bold: true }),
    dialog: s(p.dialog),
    dialogTitle: s(p.dialog, { bold: true }),
    syntax,
  };
}

const light = build('light', {
  menu: ['#000000', '#ffffff'],
  menuActive: ['#ffffff', '#0078d7'],
  dropdown: ['#000000', '#f2f2f2'],
  dropdownActive: ['#ffffff', '#0078d7'],
  disabled: '#9a9a9a',
  toolbar: ['#ffffff', '#404040'],
  editor: ['#000000', '#ffffff'],
  currentLine: '#e8f2ff',
  lineNumber: ['#000000', '#c8c8c8'],
  lineNumberCurrent: ['#000000', '#e4e4e4'],
  selection: ['#ffffff', '#3399ff'],
  match: ['#000000', '#ffee66'],
  matchCurrent: ['#000000', '#ff9632'],
  whitespace: '#b0b0b0',
  mark: { whitespace: ['#808080', '#ececec'], eol: ['#ffffff', '#3b78c4'], nonPrinting: ['#000000', '#f0c24a'], control: ['#ffffff', '#c0392b'], eof: ['#ffffff', '#8e5cb8'] },
  cursor: ['#ffffff', '#000000'],
  status: ['#a8a8a8', '#404040'],
  warn: ['#ffd479', '#404040'],
  error: ['#ff8080', '#404040'],
  panel: ['#000000', '#e6e6e6'],
  input: ['#000000', '#ffffff'],
  button: ['#ffffff', '#606060'],
  buttonActive: ['#ffffff', '#0078d7'],
  dialog: ['#000000', '#f2f2f2'],
  syntax: {
    keyword: '#0000ff',
    string: '#a31515',
    comment: '#008000',
    number: '#ff6a00',
    type: '#267f99',
    function: '#795e26',
    attr: '#e50000',
    tag: '#800000',
    meta: '#af00db',
    variable: '#001080',
    symbol: '#6f42c1',
  },
});

const dark = build('dark', {
  menu: ['#dddddd', '#2d2d2d'],
  menuActive: ['#ffffff', '#094771'],
  dropdown: ['#dddddd', '#252526'],
  dropdownActive: ['#ffffff', '#094771'],
  disabled: '#6a6a6a',
  toolbar: ['#ffffff', '#3c3c3c'],
  editor: ['#d4d4d4', '#1e1e1e'],
  currentLine: '#282828',
  lineNumber: ['#858585', '#252526'],
  lineNumberCurrent: ['#c6c6c6', '#2a2a2a'],
  selection: ['#ffffff', '#264f78'],
  match: ['#000000', '#d7ba7d'],
  matchCurrent: ['#000000', '#f0a050'],
  whitespace: '#4a4a4a',
  mark: { whitespace: ['#6a6a6a', '#2a2a2a'], eol: ['#ffffff', '#2f5f9e'], nonPrinting: ['#000000', '#d7a43a'], control: ['#ffffff', '#a94442'], eof: ['#ffffff', '#7a4fa0'] },
  cursor: ['#1e1e1e', '#d4d4d4'],
  status: ['#9d9d9d', '#3c3c3c'],
  warn: ['#ffd479', '#3c3c3c'],
  error: ['#ff8080', '#3c3c3c'],
  panel: ['#d4d4d4', '#2d2d2d'],
  input: ['#d4d4d4', '#3c3c3c'],
  button: ['#ffffff', '#4d4d4d'],
  buttonActive: ['#ffffff', '#0e639c'],
  dialog: ['#d4d4d4', '#252526'],
  syntax: {
    keyword: '#569cd6',
    string: '#ce9178',
    comment: '#6a9955',
    number: '#b5cea8',
    type: '#4ec9b0',
    function: '#dcdcaa',
    attr: '#9cdcfe',
    tag: '#569cd6',
    meta: '#c586c0',
    variable: '#9cdcfe',
    symbol: '#d7ba7d',
  },
});

const contrast = build('contrast', {
  menu: ['#000000', '#ffffff'],
  menuActive: ['#000000', '#ffff00'],
  dropdown: ['#ffffff', '#000000'],
  dropdownActive: ['#000000', '#ffff00'],
  disabled: '#808080',
  toolbar: ['#ffffff', '#000000'],
  editor: ['#ffffff', '#000000'],
  currentLine: '#202020',
  lineNumber: ['#000000', '#c0c0c0'],
  lineNumberCurrent: ['#000000', '#ffff00'],
  selection: ['#000000', '#00ffff'],
  match: ['#000000', '#ffff00'],
  matchCurrent: ['#000000', '#ff8000'],
  whitespace: '#808080',
  mark: { whitespace: ['#ffffff', '#404040'], eol: ['#000000', '#00ffff'], nonPrinting: ['#000000', '#ffff00'], control: ['#ffffff', '#ff0000'], eof: ['#000000', '#ff00ff'] },
  cursor: ['#000000', '#ffffff'],
  status: ['#ffffff', '#000000'],
  warn: ['#ffff00', '#000000'],
  error: ['#ff5050', '#000000'],
  panel: ['#ffffff', '#000000'],
  input: ['#000000', '#ffffff'],
  button: ['#000000', '#c0c0c0'],
  buttonActive: ['#000000', '#ffff00'],
  dialog: ['#ffffff', '#000000'],
  syntax: {
    keyword: '#00ffff',
    string: '#ffa0a0',
    comment: '#00ff00',
    number: '#ffff00',
    type: '#00ffcc',
    function: '#ffff80',
    attr: '#80c0ff',
    tag: '#ff80ff',
    meta: '#ff80ff',
    variable: '#c0e0ff',
    symbol: '#ffc080',
  },
});

export const THEMES: Record<ThemeId, Theme> = { light, dark, contrast };
