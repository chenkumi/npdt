import type { SpecialCategory } from './buffer/specials.js';
import { THEME_IDS } from './config/config.js';
import { ENCODINGS } from './fs/encoding.js';
import { EOL_LABELS, type Eol } from './fs/eol.js';
import { t, LOCALES, type MsgKey } from './i18n.js';
import { LANGUAGES } from './lang.js';
import { isSupported } from './syntax.js';
import type { Session } from './session.js';

export interface MenuItem {
  /** Localized at read time, so switching language needs no rebuild. */
  readonly label: string;
  cmd?: string;
  arg?: unknown;
  sep?: true;
  checked?: (s: Session) => boolean;
  /** Lets commands open this item's submenu (status bar clicks). */
  id?: string;
  /** Start the submenu on its checked item instead of the first one. */
  selectChecked?: true;
  /** Cascading items; activating this item opens them instead of running a command. */
  submenu?: MenuItem[];
  /** Keep the menu open after running (toggles inside a submenu). */
  keepOpen?: true;
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

/** A pick-one entry: runs `cmd` with `arg` and shows a check while `checked` holds. */
function choice(label: string | (() => string), cmd: string, arg: unknown, checked: (s: Session) => boolean): MenuItem {
  return {
    get label() {
      return typeof label === 'function' ? label() : label;
    },
    cmd,
    arg,
    checked,
  };
}

function submenuItem(key: MsgKey, id: string, build: () => MenuItem[]): MenuItem {
  return {
    id,
    selectChecked: true,
    get label() {
      return t(key);
    },
    get submenu() {
      return build();
    },
  };
}

const TAB_WIDTHS = [2, 3, 4, 6, 8];
let syntaxNames: string[] | undefined;

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
    {
      get label() {
        return t('mi.special');
      },
      submenu: [
        ...(['whitespace', 'eol', 'nonPrinting', 'control'] as SpecialCategory[]).map((c) =>
          item(`mi.special.${c}`, 'view.special', { arg: c, keepOpen: true, checked: (s: Session) => s.config.specialChars[c] }),
        ),
        sep,
        item('mi.special.showAll', 'view.special.all', { keepOpen: true }),
        item('mi.special.hideAll', 'view.special.none', { keepOpen: true }),
      ],
    },
    item('mi.currentLine', 'view.currentLine', { checked: (s) => s.config.highlightCurrentLine }),
    item('mi.syntax', 'view.syntax', { checked: (s) => s.config.syntaxHighlight }),
    sep,
    submenuItem('mi.syntaxMode', 'syntaxLanguage', () => {
      syntaxNames ??= ['Plain Text', ...LANGUAGES.filter((l) => isSupported(l.hljs)).map((l) => l.name)];
      return [
        choice(() => t('lang.autoSyntax'), 'view.syntaxLanguage.set', '', (s) => s.langOverride === null),
        ...syntaxNames.map((n) => choice(n, 'view.syntaxLanguage.set', n, (s) => s.langOverride === n)),
      ];
    }),
    submenuItem('mi.tabSettings', 'tabSettings', () => [
      ...TAB_WIDTHS.map((n) => choice(() => t('tab.spaces', { n }), 'view.tab.set', `spaces:${n}`, (s) => s.config.insertSpaces && s.config.tabSize === n)),
      sep,
      ...TAB_WIDTHS.map((n) => choice(() => t('tab.tabs', { n }), 'view.tab.set', `tabs:${n}`, (s) => !s.config.insertSpaces && s.config.tabSize === n)),
    ]),
    submenuItem('mi.theme', 'theme', () => THEME_IDS.map((id) => choice(() => t(`theme.${id}`), 'view.theme.set', id, (s) => s.config.theme === id))),
    item('mi.toggleDark', 'view.toggleDark'),
    submenuItem('mi.language', 'language', () => [
      choice(() => t('lang.auto'), 'view.language.set', 'auto', (s) => s.config.language === 'auto'),
      ...LOCALES.map((l) => choice(l.name, 'view.language.set', l.id, (s) => s.config.language === l.id)),
    ]),
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
