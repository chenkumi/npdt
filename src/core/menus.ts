import { ENCODINGS } from './fs/encoding.js';
import { EOL_LABELS, type Eol } from './fs/eol.js';
import { t, type MsgKey } from './i18n.js';
import type { Session } from './session.js';

export interface MenuItem {
  /** Localized at read time, so switching language needs no rebuild. */
  readonly label: string;
  cmd?: string;
  arg?: unknown;
  sep?: true;
  checked?: (s: Session) => boolean;
}

export interface Menu {
  /** Display label, e.g. "File(F)". */
  readonly label: string;
  /** Alt+<mnemonic> opens the menu. */
  mnemonic: string;
  items: MenuItem[];
}

const sep: MenuItem = { label: '', sep: true };

function item(key: MsgKey, cmd: string, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    get label() {
      return t(key);
    },
    cmd,
    ...extra,
  };
}

function menu(key: MsgKey, mnemonic: string, items: MenuItem[]): Menu {
  return {
    get label() {
      return `${t(key)}(${mnemonic.toUpperCase()})`;
    },
    mnemonic,
    items,
  };
}

export const MENUS: Menu[] = [
  menu('menu.file', 'f', [
    item('mi.new', 'file.new'),
    item('mi.open', 'file.open'),
    item('mi.recent', 'file.recent'),
    sep,
    item('mi.save', 'file.save'),
    item('mi.saveAs', 'file.saveAs'),
    item('mi.close', 'file.close'),
    sep,
    item('mi.permissions', 'file.permissions'),
    sep,
    item('mi.quit', 'app.quit'),
  ]),
  menu('menu.edit', 'e', [
    item('mi.undo', 'edit.undo'),
    item('mi.redo', 'edit.redo'),
    sep,
    item('mi.cut', 'edit.cut'),
    item('mi.copy', 'edit.copy'),
    item('mi.paste', 'edit.paste'),
    item('mi.selectAll', 'edit.selectAll'),
    sep,
    item('mi.duplicateLine', 'edit.duplicateLine'),
    item('mi.deleteLine', 'edit.deleteLine'),
    item('mi.moveLineUp', 'edit.moveLineUp'),
    item('mi.moveLineDown', 'edit.moveLineDown'),
    sep,
    item('mi.indent', 'edit.indent'),
    item('mi.unindent', 'edit.unindent'),
    item('mi.lineComment', 'edit.toggleComment'),
    item('mi.blockComment', 'edit.blockComment'),
    sep,
    item('mi.upper', 'edit.upper'),
    item('mi.lower', 'edit.lower'),
    item('mi.trim', 'edit.trimTrailing'),
    sep,
    item('mi.overwrite', 'edit.toggleOverwrite', { checked: (s) => s.overwrite }),
  ]),
  menu('menu.search', 's', [
    item('mi.find', 'find.open'),
    item('mi.replace', 'find.replace'),
    item('mi.findNext', 'find.next'),
    item('mi.findPrev', 'find.prev'),
    sep,
    item('mi.goto', 'goto'),
  ]),
  menu('menu.view', 'v', [
    item('mi.wrap', 'view.wrap', { checked: (s) => s.config.wordWrap }),
    item('mi.lineNumbers', 'view.lineNumbers', { checked: (s) => s.config.showLineNumbers }),
    item('mi.whitespace', 'view.whitespace', { checked: (s) => s.config.showWhitespace }),
    item('mi.currentLine', 'view.currentLine', { checked: (s) => s.config.highlightCurrentLine }),
    item('mi.syntax', 'view.syntax', { checked: (s) => s.config.syntaxHighlight }),
    sep,
    item('mi.syntaxMode', 'view.syntaxLanguage'),
    item('mi.theme', 'view.theme'),
    item('mi.toggleDark', 'view.toggleDark'),
    item('mi.language', 'view.language'),
  ]),
  menu('menu.encoding', 'n', [
    ...ENCODINGS.map((e): MenuItem => ({ label: e.label, cmd: 'encoding.set', arg: e.id, checked: (s) => s.encoding === e.id })),
    sep,
    ...(['crlf', 'lf', 'cr'] as Eol[]).map((e): MenuItem => ({ label: EOL_LABELS[e], cmd: 'eol.set', arg: e, checked: (s) => s.eol === e })),
    sep,
    item('mi.reloadEnc', 'encoding.reload'),
  ]),
  menu('menu.help', '?', [item('mi.keys', 'help.keys'), item('mi.about', 'help.about')]),
];
