# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`npdt` (Notepad Terminal) is a Windows-Notepad-style terminal editor built on Ink 8 / React 19. Single document only (tabs were deliberately dropped). User-facing docs are in `README.md`; the original plan and the list of deviations from it are in `docs/PLAN.md`.

## Commands

```sh
npm run typecheck                 # tsc --noEmit (TypeScript 7)
npm test                          # all of vitest, including pty e2e (~20 s)
npx vitest run test/session.test.ts            # one file
npx vitest run test/session.test.ts -t "find"  # one test by name
npm run build                     # tsup -> dist/cli.js (bin/npdt.js imports it)
npm start                         # node bin/npdt.js [file]; needs a real TTY
npm run build:sea                 # standalone exe in dist-sea/ (needs Node >= 25.5)
NPDT_BIN=dist-sea/npdt.exe npx vitest run test/e2e   # run e2e against the exe
```

- There is no linter configured.
- Requires Node >= 22 (Ink 8). `tsconfig.json` sets `"types": ["node"]` explicitly — TypeScript 7 no longer auto-includes `@types/*`.
- `test/e2e` spawns the built app in a pty (`node-pty` + `@xterm/headless`) and rebuilds `dist` in `beforeAll`. A harmless `AttachConsole failed` trace from node-pty is printed on Windows when the child has already exited.
- `NPDT_HOME` overrides the config/recovery directory; tests and e2e set it to a temp dir.

## Architecture

The key idea: **Ink only prints; everything else is ours.** Understanding it needs several files:

1. **Input** (`src/input/`): `InputSource` owns raw mode, bracketed paste, SGR mouse and kitty keyboard protocol, and parses stdin itself with `InputParser` (pure, unit-tested). Ink is handed an inert fake stdin (`inkStdin`), so never use Ink's `useInput`/`usePaste` — they will not fire. Events are `key | text | mouse | paste`; `keyId()` turns a key into a canonical string (`ctrl+shift+k`; modifier order is ctrl, alt, shift, super).
2. **State** (`src/core/session.ts`): `Session` is the single source of truth and is UI-framework-free. It owns the `Document`, file metadata (path, encoding, EOL), scroll, menu/dialog/find-panel state, and the dispatch path `handleInput -> dialog | menu | find panel | keymap -> command`. React subscribes through `subscribe/getVersion` (`useSyncExternalStore`); every input ends in `emit()`.
3. **Commands** (`core/commands.ts` registry, `core/keymap.ts` default key bindings, `core/menus.ts` menu data): menu items, toolbar buttons, keys and mouse all run the same command ids via `session.run(id, arg)`. To add a feature, register a command, then bind it in keymap and/or menus. Users override bindings via `config.keymap`.
4. **Rendering** (`src/ui/frame.ts`): `renderFrame(session)` draws the whole UI into a cell grid (`ui/screen.ts`). Overlays (dropdowns, dialogs) simply overwrite cells; there is no Ink layout. The same pass fills `session.hits` (mouse hit regions; **later entries win**, so register backdrops/containers before their children) and `session.rowMap` (visible rows, used to map clicks to positions). `App.tsx` just turns `Screen.rows()` into `<Text>` runs. Tests assert on `renderFrame(s).toText()` instead of mounting Ink.
5. **Text model** (`src/core/buffer/`): `TextBuffer` is a line array of `\n`-only text (CRLF etc. is a file-IO concern). Positions are `{line, col}` with `col` a UTF-16 index; cursor movement and display width go through grapheme segmentation (`graphemes.ts`, tab-aware via `setTabSize`). All mutations are `Edit {start, removed, inserted}`; `Document.applyEdits` applies several as one undo step (order them bottom-to-top). Dirty state is `History.isClean` (undo depth vs. save point), not a revision counter.
6. **Files** (`src/core/fs/`): encoding detection/conversion, EOL preservation, atomic save (temp file + rename), crash-recovery snapshots. A non-existent path opens an empty document and is created only on first save.

7. **i18n** (`core/i18n.ts`, `core/locales/<id>.ts`): every user-visible string goes through `t(key, {params})`. `locales/en.ts` defines the keys (`MsgKey`); the other 9 locales are typed `Messages`, and `test/i18n.test.ts` enforces identical key sets and `{placeholder}`s. The locale is module-global, set by `Session` from `config.language` (`en` default, `auto` = system). Menu/`MenuItem` labels are getters, so they re-localize without rebuilding. Menu mnemonics (f e s v n ?), dialog hotkeys (s/n/c/y) and status-bar labels (Length/Lines/Ln/Col) intentionally stay English. Config-parse warnings are English (they occur before the locale is known). Tests run in English unless they call `setConfig({ language })`.

Other pieces: `core/search/search.ts` (per-line regex matching only), `core/syntax.ts` + `core/lang.ts` (lowlight highlighting of the visible window plus lookback, cached per revision; also the per-language comment syntax), `platform/clipboard.ts` (native tools, OSC 52 fallback), `core/dialogs.ts` (confirm/prompt/list/info/file dialogs as data plus key handling).

## Gotchas

- Terminal key limits shape the keymap: plain terminals cannot distinguish `Ctrl+Shift+<letter>` from `Ctrl+<letter>`, and `0x08` is parsed as `ctrl+backspace` (so `Ctrl+H` only works under kitty protocol; replace is also on `Ctrl+R`). Keys that can't be detected need an alternate binding (see `docs/PLAN.md` §11.1).
- A bare `ESC` followed by another key in the same read chunk is ambiguous (`Alt+key`); the parser special-cases `ESC ESC [`/`ESC ESC O`. In pty tests, wait between sending `Esc` and the next key.
- Don't spread large arrays into `splice`/call arguments (stack overflow on big pastes); `TextBuffer.apply` switches to `concat` for large inserts.
- The Bash tool used in this environment can mangle backslashes in heredocs/`sed`; use the Write/Edit tools for source containing `\n`, `\d`, etc.
