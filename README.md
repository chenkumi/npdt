# npdt — Notepad Terminal（終端機記事本）

在終端機裡使用熟悉的記事本式操作：選單列、快捷列、行號、Ctrl 系列快捷鍵、搜尋取代、多種編碼、語法高亮，並支援滑鼠。
跨平台（Windows / macOS / Linux），以 [Ink](https://github.com/vadimdemedes/ink) 打造。

```
 File(F)  Edit(E)  Search(S)  View(V)  Encoding(N)  Help(?)
 New Open Save Close | Cut Copy Paste | Undo Redo | Search Replace
  1 │import { x } from "y";
  2 │
  3 │// demo file
  4 │export function add(a: number, b: number) {
 ...
 Opened demo.ts         | Length:106  Lines:7 | Ln:1  Col:1 | LF | UTF-8 | TypeScript | INS
```

## 安裝

```sh
npm i -g npdt        # 需要 Node.js 22 以上
npx npdt notes.txt   # 或免安裝直接執行
```

[操作說明](https://github.com/chenkumi/npdt/blob/master/docs/USAGE.md)
