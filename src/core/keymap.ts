export interface KeyBinding {
  cmd: string;
  arg?: unknown;
}

type Entry = [key: string, cmd: string, arg?: unknown];

const MOTIONS: [string, string][] = [
  ['left', 'left'],
  ['right', 'right'],
  ['up', 'up'],
  ['down', 'down'],
  ['home', 'lineStart'],
  ['end', 'lineEnd'],
  ['ctrl+home', 'docStart'],
  ['ctrl+end', 'docEnd'],
  ['ctrl+left', 'wordLeft'],
  ['ctrl+right', 'wordRight'],
  ['pageup', 'pageUp'],
  ['pagedown', 'pageDown'],
];

function motionEntries(): Entry[] {
  const out: Entry[] = [];
  for (const [key, motion] of MOTIONS) {
    out.push([key, 'cursor.move', { motion, extend: false }]);
    // shift goes after ctrl/alt in canonical ids: ctrl+shift+left
    const parts = key.split('+');
    const name = parts.pop()!;
    out.push([[...parts, 'shift', name].join('+'), 'cursor.move', { motion, extend: true }]);
  }
  return out;
}

const MENU_KEYS = ['f', 'e', 's', 'v', 'n', '?'];

/** Notepad-style defaults. Terminal-hostile combos have alternates (see docs/PLAN.md §11.1). */
const DEFAULTS: Entry[] = [
  ['ctrl+n', 'file.new'],
  ['ctrl+o', 'file.open'],
  ['ctrl+s', 'file.save'],
  ['ctrl+alt+s', 'file.saveAs'],
  ['f12', 'file.saveAs'],
  ['ctrl+w', 'file.close'],
  ['ctrl+q', 'app.quit'],

  ['ctrl+z', 'edit.undo'],
  ['ctrl+y', 'edit.redo'],
  ['ctrl+shift+z', 'edit.redo'],
  ['ctrl+x', 'edit.cut'],
  ['shift+delete', 'edit.cut'],
  ['ctrl+c', 'edit.copy'],
  ['ctrl+insert', 'edit.copy'],
  ['ctrl+v', 'edit.paste'],
  ['shift+insert', 'edit.paste'],
  ['ctrl+a', 'edit.selectAll'],
  ['ctrl+l', 'edit.deleteLine'],
  ['ctrl+d', 'edit.duplicateLine'],
  ['ctrl+shift+up', 'edit.moveLineUp'],
  ['alt+up', 'edit.moveLineUp'],
  ['ctrl+shift+down', 'edit.moveLineDown'],
  ['alt+down', 'edit.moveLineDown'],
  ['tab', 'edit.indent'],
  ['shift+tab', 'edit.unindent'],
  ['ctrl+u', 'edit.lower'],
  ['ctrl+shift+u', 'edit.upper'],
  ['ctrl+k', 'edit.toggleComment'],
  ['ctrl+shift+k', 'edit.blockComment'],
  ['alt+k', 'edit.blockComment'],
  ['insert', 'edit.toggleOverwrite'],
  ['return', 'edit.newline'],
  ['shift+return', 'edit.newline'],
  ['backspace', 'edit.backspace'],
  ['shift+backspace', 'edit.backspace'],
  ['delete', 'edit.delete'],
  ['ctrl+backspace', 'edit.deleteWordLeft'],
  ['alt+backspace', 'edit.deleteWordLeft'],
  ['ctrl+delete', 'edit.deleteWordRight'],
  ['escape', 'edit.escape'],

  ['ctrl+f', 'find.open'],
  ['ctrl+h', 'find.replace'],
  ['ctrl+r', 'find.replace'],
  ['f3', 'find.next'],
  ['shift+f3', 'find.prev'],
  ['ctrl+g', 'goto'],

  ['f1', 'help.keys'],
  ['f10', 'menu.open', 0],
  ['f9', 'view.toggleDark'],
  ...MENU_KEYS.map((k, i): Entry => [`alt+${k}`, 'menu.open', i]),
  ...motionEntries(),
];

export function defaultBindings(): Entry[] {
  return DEFAULTS;
}

/** Defaults plus user overrides ("none" unbinds; "cmd:arg" passes a string argument). */
export function buildKeymap(overrides: Record<string, string> = {}): Map<string, KeyBinding> {
  const map = new Map<string, KeyBinding>();
  for (const [key, cmd, arg] of DEFAULTS) map.set(key, { cmd, arg });
  for (const [rawKey, target] of Object.entries(overrides)) {
    const key = rawKey.toLowerCase().replace(/\s+/g, '');
    if (target === 'none') {
      map.delete(key);
      continue;
    }
    const [cmd, arg] = target.split(':');
    map.set(key, arg === undefined ? { cmd: cmd! } : { cmd: cmd!, arg });
  }
  return map;
}
