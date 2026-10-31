# 特殊字元顯示 (View → Special Characters) 規格

讓使用者看出文件中肉眼看不到的字元（空白、Tab、行尾、零寬字元、控制字元、EOF），並且能對它們移動游標、選取、刪除。純顯示功能：不修改內容、不影響儲存、複製與搜尋。取代舊的 `showWhitespace`（「顯示空白與行尾」）。

## 1. 選單

```
View(V)
  ...
  Special Characters        ►   ┌ ✓ Spaces and Tabs
  ...                           │ ✓ Line Endings
                                │   Non-Printing Characters
                                │   Control Characters / EOF
                                │ ─────
                                │   Show All
                                └   Hide All
```

- 四個勾選項為各類別開關；「Show All / Hide All」是動作。全開時 Show All 為 disabled，全關時 Hide All 為 disabled。
- 子選單切換後保持開啟（`keepOpen`），可連續切換。

| 操作 | 行為 |
|---|---|
| `→` / `Enter` 於父項目 | 開啟子選單 |
| `↑` `↓` | 子選單內移動 |
| `Enter` / `Space` | 切換，不關閉 |
| `←` / `Esc` | 回到父層 |
| 滑鼠 hover 父項目 | 展開子選單 |
| 滑鼠點擊子項目 | 切換，不關閉 |
| 右側空間不足 | 子選單改靠左側 |

## 2. 設定

```jsonc
"specialChars": { "whitespace": false, "eol": false, "nonPrinting": false, "control": false }
```

舊 `showWhitespace: true` 遷移為 `whitespace: true, eol: true`；舊 key 之後不再寫出。

## 3. 指令

| id | 說明 |
|---|---|
| `view.special` (arg: 類別) | 切換單一類別 |
| `view.special.all` / `view.special.none` | 全開 / 全關 |
| `view.whitespace` | 相容別名：有任一類開啟則全關，否則全開 |

## 4. 字元分類與標示

標籤為固定英文技術縮寫，不做 i18n。標籤兩側各留一格空白（` CR `）。

### whitespace
| 字元 | 顯示 |
|---|---|
| U+0020 | `·`（僅前景色） |
| Tab | `→` + 空白補到 tab stop，整段淡底色 |
| NBSP U+00A0、U+1680、U+2000–200A、U+202F、U+205F、U+3000 | 標籤 `NBSP` / `U+3000` 等，加底色 |

### eol
依檔案 EOL 設定在每行尾端顯示 `CRLF` / `LF` / `CR`。標籤為虛擬：不屬於行寬，不可作為游標落點。選取跨行時改用 selection 樣式。最後一行不畫行尾標籤。

### nonPrinting
`ZWSP ZWNJ ZWJ`(U+200B–D)、`BOM`(檔案中段 U+FEFF)、`SHY`(U+00AD)、`WJ FA IT IS IP`(U+2060–2064)、`LRM RLM ALM`、雙向控制 `LRE RLE PDF LRO RLO LRI RLI FSI PDI`、`CGJ`、`MVS`、`TAG`(U+E0000–E007F)、`VS1`–`VS16`、孤立 surrogate / noncharacter 以 `U+XXXX`。
例外：合法 emoji 序列內的 ZWJ、VS16 不標示。

### control
C0（除 Tab、LF、CR）以名稱標示（`NUL SOH … ESC … US`、`DEL`）；C1 用 `NEL` 或 `x80` 形式；U+001A 標 `SUB`；文件最後一行尾端畫 `EOF`。

## 5. 配色（theme 新增 `mark`）

各類別 `[fg, bg]`：

| 類別 | dark | light | contrast |
|---|---|---|---|
| whitespace（Tab 底色/NBSP） | `#6a6a6a / #2a2a2a` | `#808080 / #ececec` | `#ffffff / #404040` |
| eol | `#ffffff / #2f5f9e` | `#ffffff / #3b78c4` | `#000000 / #00ffff` |
| nonPrinting | `#000000 / #d7a43a` | `#000000 / #f0c24a` | `#000000 / #ffff00` |
| control | `#ffffff / #a94442` | `#ffffff / #c0392b` | `#ffffff / #ff0000` |
| EOF | `#ffffff / #7a4fa0` | `#ffffff / #8e5cb8` | `#000000 / #ff00ff` |

疊加優先序（高→低）：游標 > 選取 > 搜尋命中 > 特殊字元底色 > 語法高亮。被選取或命中時只換底色，文字保留。

## 6. 寬度模型

新增 `core/buffer/specials.ts`（仿 `setTabSize` 的 module-global）：`setSpecialChars(cfg)`、`markFor(segment)`、`splitCluster`。

- `graphemeWidth()` 對有標示的字元回傳標籤寬度；`lineCells`、`displayWidth`、`colForWidth`、`wrapStarts`、點擊定位自動一致。
- 全關時走快速路徑，零成本。
- 邊界細分：`nonPrinting` 開啟時，黏在前一字元 cluster 內的 ZWNJ/ZWJ/VS 等拆成獨立邊界，使游標可停在其間，Backspace/Delete 只刪隱形字元。
- 標籤是原子的，換行不切斷。
- 切換類別後換行快取與捲動需重新計算（同變更 `tabSize`）。

## 7. 不變的行為

儲存、複製、剪下、搜尋、取代、undo 皆以真實字元為準；標示僅限內容區。

## 8. 已知限制

1. 混合 EOL 檔案載入時正規化為主要 EOL（`detectEol`），原檔少數不同的行尾無法顯示。
2. 孤立 `\r` 載入時已轉為換行，不會以 `CR` 標籤出現。
3. 「控制字元或 Unicode EOF」解讀為：控制字元 + 文件結尾 `EOF` 標籤 + U+001A。
4. CRLF 以單一標籤 `CRLF` 顯示。
5. 尾端空白警告強調列為後續選配。
