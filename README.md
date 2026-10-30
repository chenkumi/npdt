# npdt — Notepad Terminal（終端機記事本）

[English](#english) | [繁體中文](#繁體中文)

## English

A Notepad-style terminal editor with menus, a toolbar, line numbers, Ctrl shortcuts, find and replace, multiple encodings, syntax highlighting, and mouse support. Built with [Ink](https://github.com/vadimdemedes/ink) for Windows, macOS, and Linux.

```text
 File(F)  Edit(E)  Search(S)  View(V)  Encoding(N)  Help(?)
 New Open Save Close | Cut Copy Paste | Undo Redo | Search Replace
  1 │import { x } from "y";
  2 │
  3 │// demo file
  4 │export function add(a: number, b: number) {
 ...
 Opened demo.ts         | Length:106  Lines:7 | Ln:1  Col:1 | LF | UTF-8 | TypeScript | INS
```

### Installation and usage

Requires Node.js 22 or later.

```sh
npm install -g @chenkumi/npdt
npdt notes.txt

# Or run without installing globally:
npx @chenkumi/npdt notes.txt
```

Run `npdt --help` for command-line options. See the [user guide](https://github.com/chenkumi/npdt/blob/master/docs/en/USAGE.md) for detailed instructions.

## 繁體中文

在終端機裡使用熟悉的記事本式操作：選單列、工具列、行號、Ctrl 系列快捷鍵、搜尋取代、多種編碼、語法高亮，並支援滑鼠。以 [Ink](https://github.com/vadimdemedes/ink) 打造，支援 Windows、macOS 和 Linux。

### 安裝與使用

需要 Node.js 22 以上版本。

```sh
npm install -g @chenkumi/npdt
npdt notes.txt

# 或不全域安裝直接執行：
npx @chenkumi/npdt notes.txt
```

執行 `npdt --help` 可查看命令列選項；詳細說明請參閱[操作說明](https://github.com/chenkumi/npdt/blob/master/docs/zh-TW/USAGE.md)。
