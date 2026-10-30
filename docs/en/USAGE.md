# User Guide

## Usage

| Command | Description |
|---|---|
| `npdt` | Open an empty document |
| `npdt <name>` | Open a file; if it does not exist, open an empty document and **create the file only on the first save** |
| `npdt <name>:<line>[:<col>]` | Open at the specified position |
| `npdt --encoding big5 <name>` | Open using the specified encoding |
| `npdt --no-mouse` | Disable mouse support |

The package provides the `npdt` command. It edits one file at a time (no tabs).

## Keyboard shortcuts

Shortcuts follow Windows Notepad and other common editors; alternatives are available for key combinations that terminals cannot detect. Press `F1` for the full list.

| Action | Keys | Alternative / notes |
|---|---|---|
| New / Open / Save / Close / Quit | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+W` / `Ctrl+Q` | |
| Save As | `Ctrl+Alt+S` | `F12`, or the menu |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` | `Ctrl+Shift+Z` for redo |
| Cut / Copy / Paste / Select All | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A` | Cut/copy the whole line when nothing is selected |
| Delete line / Duplicate line | `Ctrl+L` / `Ctrl+D` | |
| Move line up / down | `Ctrl+Shift+↑/↓` | `Alt+↑/↓` |
| Indent / Unindent | `Tab` / `Shift+Tab` | |
| Line comment / Block comment | `Ctrl+K` / `Ctrl+Shift+K` | `Alt+K` for block comment |
| Uppercase / Lowercase | `Ctrl+Shift+U` / `Ctrl+U` | |
| Find / Replace | `Ctrl+F` / `Ctrl+H` | `Ctrl+R` for replace |
| Find next / previous | `F3` / `Shift+F3` | |
| Go to line | `Ctrl+G` | |
| Menu | `F10`, `Alt+F/E/S/V/N/?` | Mouse click; menu letters remain F E S V N ? in every language |
| Dark / light mode | `F9` | Also available in the View menu |

Notes:
- Most terminals cannot distinguish `Ctrl+Shift+letter` from `Ctrl+letter`, or `Ctrl+H` from Backspace. Terminals supporting the [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) (such as kitty, WezTerm, foot, and iTerm2) automatically enable the full key combinations; use the alternatives in other terminals.
- In macOS Terminal.app, Option does not send Meta by default. Enable “Use Option as Meta key” under Profiles → Keyboard, or use `F10` to open the menu.
- In the find panel: `Enter` finds the next match, `Shift+Enter` the previous match, `Tab` switches between find and replace fields, `Alt+C` toggles case sensitivity, `Alt+W` whole word, `Alt+R` regular expressions, `Alt+A` replaces all, and `Esc` closes the panel. Search normally matches one line at a time. When regular expressions are enabled and the pattern contains `\n` or `\r` (for example, `foo\nbar`), matching spans lines; `^` and `$` still mean the start and end of a line. The same applies to replacement.

## Mouse

Click the menu, toolbar, or status bar (clicking the encoding or line-ending format opens the encoding menu). Drag to select, double-click to select a word, triple-click or click a line number to select a line, and use the wheel to scroll (`Shift+wheel` scrolls horizontally).

## Files and encodings

- Automatically detects BOM, UTF-8, UTF-16, Big5, GBK, Shift-JIS, EUC-KR, and Windows-1252. The status bar shows the result; use the Encoding menu to reload or change the save encoding.
- Preserves the original line endings (CRLF / LF / CR) and BOM.
- Saves via a temporary file, `fsync`, and rename to protect the original file against crashes; preserves permissions and follows symbolic links.
- Asks before saving if the file has been modified externally. If the content cannot be represented in the current encoding, saving is rejected instead of silently replacing characters.
- File permissions appear in the status bar (`rwxr-xr-x` on POSIX, `RW` / `RO` on Windows). Click them or use File → File Permissions… to change them. Enter three octal digits on POSIX (for example, `644`); on Windows only the read-only attribute can be toggled. Permissions cannot be set on an unsaved document.
- Writes a recovery file to the configuration directory every 5 seconds when there are unsaved changes; the next time the same file is opened, npdt asks whether to restore it.
- Warns for files larger than 10 MB and refuses to open files larger than 100 MB.

## Configuration

Configuration file: `%APPDATA%\npdt\config.json` on Windows; `$XDG_CONFIG_HOME/npdt/config.json` on macOS / Linux (default: `~/.config/npdt/config.json`).

```json
{
  "theme": "dark",
  "language": "en",
  "autoReload": true,
  "tabSize": 2,
  "insertSpaces": true,
  "wordWrap": false,
  "showLineNumbers": true,
  "showWhitespace": false,
  "highlightCurrentLine": true,
  "syntaxHighlight": true,
  "autoIndent": true,
  "mouse": true,
  "kittyKeyboard": true,
  "recentFilesMax": 10,
  "keymap": { "ctrl+b": "file.save", "ctrl+d": "none" }
}
```

- Themes: `dark` (default), `light` (the old name `classic` still works), and `contrast`. `F9` switches between dark and light; View → Theme also lets you choose. Changes made through the menu are saved automatically.
- Language: defaults to `en`. The 10 supported languages are `en`, `zh-TW`, `zh-CN`, `ja`, `ko`, `es`, `fr`, `de`, `pt-BR`, and `ru`. `auto` selects from the system locale using `LC_ALL`, `LANG`, and related variables. Change it through View → Language…; the change takes effect immediately. Technical status-bar labels (Length / Lines / Ln / Col) are not translated.
- Adding a language: copy and translate `src/core/locales/en.ts`, then register it in `src/core/i18n.ts`. Ensure all languages have matching keys and `{parameters}`.
- `autoReload`: when another program modifies a file on disk, automatically reload it and preserve the cursor position if there are no unsaved changes; otherwise, show a warning without overwriting changes. Reloading clears the undo history.
- Closing a file remembers the cursor and scroll positions in `state.json` in the configuration directory (up to 200 files). Opening the same file restores its position.
- Invalid settings fall back to defaults and display a status-bar warning; they do not prevent startup.
- `keymap` values are command IDs (see `src/core/commands.ts`); `"none"` removes a binding.

## Development

```sh
npm install
npm run dev        # tsup watch
npm start          # run dist (first run npm run build)
npm run typecheck
```

Architecture: `src/core` is independent of the UI (buffer, undo, search, file I/O, commands, and the `Session` state machine). `src/ui/frame.ts` draws the entire screen to a custom cell grid for Ink to output, allowing menus and dialogs to overlay the editor. `src/input` parses keyboard, mouse, and paste sequences itself, including the kitty protocol; Ink handles output only. See [PLAN.md](../PLAN.md) for design details.

## License

MIT
