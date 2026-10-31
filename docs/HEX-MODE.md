# Hex 編輯模式 (View → Hex Mode) 規格

> **狀態：封存（未排入實作）。** 與目前以文字為核心的架構差距過大（需要獨立的位元組模型、繪製與存檔路徑）。保留此規格供日後重啟參考。

直接檢視與編輯檔案的原始位元組：左側偏移、中間十六進位、右側 ASCII 對照。用途是除錯、修復檔案、檢視文字模式看不到的真相（混合 EOL、非法 UTF-8 序列、BOM、二進位內容）。

## 0. 為什麼不能只是另一種「渲染」

文字模式的資料模型是 **已解碼的文字**（`TextBuffer`，只有 `\n`；EOL 與編碼是檔案 I/O 的事）。載入時會做有損轉換：

- 混合 EOL 被正規化成主要 EOL、孤立 `\r` 變成換行（見 `loadFile`）。
- 非法位元組被 `decode` 取代成 U+FFFD，存檔時再也還原不了。
- 二進位檔以文字開啟後存檔，內容會被破壞。

因此 Hex 模式必須有**自己的位元組模型**（`HexDocument`），不能疊在 `TextBuffer` 上。兩種模式共用 Session、選單、狀態列、對話框、尋找面板，但各有資料、游標、undo 與繪製。

## 1. 範圍

**納入（v1）**
- 檢視 / 編輯 / 插入 / 刪除位元組；十六進位窗格與 ASCII 窗格雙向編輯。
- 選取、複製 / 貼上（hex 字串與文字）、undo / redo。
- 跳到偏移、十六進位 / 文字 / 萬用字元搜尋與取代。
- 與文字模式雙向切換；原樣位元組存檔。
- 偵測二進位檔並建議以 Hex 開啟。

**不納入**
- 超過 100 MB 的檔案（沿用 `MAX_SIZE`）。
- 資料檢查器（Data Inspector：int/float/時間解讀）、書籤、結構樣板、檔案比對、校驗碼、位元檢視、區塊裝置。列為後續。
- 右側窗格以 ASCII 顯示；依編碼解碼（UTF-8 / Big5 多位元組）列為後續。

## 2. 進入與離開

| 項目 | 規格 |
|---|---|
| 選單 | View → **Hex Mode**（勾選項，置於 View 選單中 `Special Characters` 之前） |
| 指令 | `view.hex`（切換）、`hex.togglePane`、`hex.toggleInsert` |
| 預設快速鍵 | `F8` 切換 Hex 模式；`Tab` / `Shift+Tab` 切換窗格；`Insert` 切換 OVR/INS |
| 持久化 | 模式本身不寫入 `config.json`（每個開啟的檔案各自決定） |
| 二進位自動偵測 | 開檔時前 8 KB 含 `0x00` 且非 UTF-16（無 BOM、非 UTF-16 啟發式）→ 對話框「此檔案看起來是二進位檔，要以 Hex 模式開啟嗎？ [Hex(Y)] [文字(N)]」。`hex.autoDetectBinary` 可關閉 |

## 3. 畫面配置

```
 Offset(h)  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F   Decoded text     ← 標題列（固定）
00000000h:  55 6C 00 00 00 45 64 69 74 20 69 73 20 61 20 70  ; Ul...Edit is a p
00000010h:  6F 77 65 72 66 75 6C 20 74 65 78 74 20 61 6E 64  ; owerful text and
00000020h:  20 68 65 78 20 65 64 69 74 6F 72 2E 0D 0A 54 68  ;  hex editor...Th
```

- 取代行號 gutter：最左為偏移欄 `XXXXXXXXh:`（8 位十六進位，檔案 ≥ 4 GB 不可能，因上限 100 MB）。
- 標題列（`editor` 區第一列）顯示欄位 `00`–`0F`；游標所在欄加底色強調。
- 中間：每位元組 2 位十六進位，間隔 1 格；可選 `groupSize`（0 無，4 或 8）在群組間多插 1 格。
- 右側：` ; ` 分隔，接著 `bytesPerRow` 個字元（可印出 ASCII `0x20–0x7E` 原樣顯示，其餘 `.`）。
- 每列位元組數 `bytesPerRow`：`4 | 8 | 16 | 32 | auto`，預設 `16`。`auto` 或寬度不足時取「放得下的最大值」（最少 4）；仍不足則右側裁切。
- 檔案尾端（偏移 == 長度）是合法游標位置，以空位表示，供附加位元組。
- 不使用自動換行、水平捲動；`wordWrap` 設定在 Hex 模式下不影響。

### 3.1 著色（`hex.colorize`，預設開）
僅前景色，避免整片色塊。沿用 theme 既有色：

| 位元組 | 十六進位 / ASCII 樣式 |
|---|---|
| `00` | 暗色（`theme.whitespace`） |
| `0x09 0x0A 0x0D 0x20` | `theme.mark.whitespace` 前景 |
| 其他控制 `<0x20`、`0x7F` | `theme.mark.control` 前景 |
| `≥ 0x80` | `theme.mark.nonPrinting` 前景 |
| 可印出 ASCII | 一般前景 |

### 3.2 游標與選取
- 作用中窗格的游標：反白一個位元組（hex 窗格內再以底線標示目前 nibble）。
- 另一窗格對應位置：以 `theme.selection` 的淡化版（或底線）標示，使兩邊位置一眼對應。
- 選取範圍：兩個窗格同步以 `theme.selection` 顯示。
- 搜尋命中：`theme.match` / `theme.matchCurrent`，兩個窗格同步。

## 4. 狀態列

Hex 模式的區段（依 `optional` 優先序，窄時由右而左省略）：

`HEX | Offset: 0x0000001A (26) | Len: 12,345 | Sel: 4 | OVR | UTF-8 | RW`

- `Offset`：游標位元組偏移，十六進位與十進位。
- `Len`：位元組總數（取代 `Length/Lines`）。
- `Sel`：選取位元組數（無選取時省略）。
- `OVR` / `INS`：Hex 自己的插入狀態（見 §5.4），不使用文字模式的 `overwrite`。
- EOL 區段在 Hex 模式隱藏（位元組無「檔案 EOL」概念）；編碼、唯讀區段保留。

## 5. 編輯語意

### 5.1 資料模型
`HexDocument`（`core/hex/hex-document.ts`）：
- `bytes: Uint8Array`（整檔載入記憶體；上限 100 MB，超過 `WARN_SIZE`=10 MB 沿用警告）。
- `cursor: { offset: number; nibble: 0 | 1 }`、`anchor`（選取起點）、`pane: 'hex' | 'text'`。
- 所有修改為 `HexEdit { offset, removed: Uint8Array, inserted: Uint8Array }`；`applyEdits` 一次套用多個為一個 undo 步驟（由大偏移到小偏移排序，同 `Document.applyEdits`）。
- 髒狀態：沿用 `History.isClean`（undo 深度 vs 存檔點）。

### 5.2 十六進位窗格輸入
- 接受 `0-9 a-f A-F`；其他字元忽略。
- OVR：輸入高 nibble 立即改該位元組高半、游標移到低 nibble；輸入低 nibble 後游標移到下一個位元組。
- INS：輸入高 nibble 時在游標處**插入**新位元組（值 `n0`），游標移到其低 nibble；輸入低 nibble 完成。
- 相鄰的 nibble 輸入合併為一個 undo 步驟（高+低 = 一步）。
- 游標在尾端（偏移 == 長度）輸入：兩種模式皆附加新位元組。

### 5.3 ASCII 窗格輸入
- 可印出字元依**目前檔案編碼**轉成位元組後寫入（UTF-8 的 `é` = 2 位元組）；無法編碼則提示並忽略。
- OVR：覆寫等長的位元組數（游標到尾端時延伸）；INS：插入。
- Enter 寫入檔案 EOL 對應的位元組（`0D 0A` / `0A` / `0D`）。

### 5.4 OVR / INS
- 預設 **OVR**（Hex 編輯器慣例，避免誤改檔案長度）。`Insert` 切換；狀態列顯示。
- 切換為 INS 才能於中段插入；兩種模式皆可 `Delete` / `Backspace` 刪除（見下）。

### 5.5 刪除
- 有選取：`Delete` / `Backspace` 刪除選取位元組（檔案縮短）。
- 無選取：`Delete` 刪除游標處一個位元組；`Backspace` 刪除前一個位元組（兩種模式皆然）。
- 刪除後游標位於刪除處；undo 還原。

### 5.6 選取與導覽
| 操作 | 行為 |
|---|---|
| `←` `→` | 移動一個 nibble（hex 窗格）/ 一個位元組（ASCII 窗格） |
| `↑` `↓` | 上下一列（保持欄） |
| `Home` `End` | 該列開頭 / 結尾 |
| `PgUp` `PgDn` | 一頁 |
| `Ctrl+Home` `Ctrl+End` | 檔頭 / 檔尾 |
| `Shift` + 以上 | 擴張選取 |
| `Ctrl+A` | 全選 |
| `Ctrl+G` | 跳到偏移（見 §6） |
| `Tab` / `Shift+Tab` | 切換 hex / ASCII 窗格（取代文字模式的縮排） |
| 滑鼠左鍵 | 點選位元組並設定作用窗格；拖曳選取；滾輪捲動列 |

### 5.7 複製 / 剪下 / 貼上
- 於 hex 窗格複製：`6C 00 FF` 形式（大小寫依 `hex.uppercase`，預設大寫）；於 ASCII 窗格複製：以檔案編碼解碼為文字（非法位元組 → U+FFFD）。
- 貼上：hex 窗格解析十六進位（忽略空白、逗號、`0x`、`\x`），含非法字元則拒絕並提示；ASCII 窗格視為文字，以檔案編碼編碼。OVR 覆寫、INS 插入；選取範圍先被取代。
- 剪下等於複製後刪除選取。

### 5.8 唯讀
`readOnly` 檔案：所有修改指令不可用；嘗試輸入時提示 `msg.readOnly`（與文字模式相同）。

## 6. 跳到偏移（`goto`）
Hex 模式下 `Ctrl+G`（`goto` 指令）開啟輸入框，接受：

| 格式 | 例 | 意義 |
|---|---|---|
| `0x…` / `…h` | `0x1F`、`1Fh` | 十六進位絕對偏移 |
| 純數字 | `255` | 十進位絕對偏移 |
| `+N` / `-N` | `+0x10`、`-4` | 相對目前游標 |

超出範圍夾到 `[0, 長度]`。

## 7. 尋找 / 取代
沿用尋找面板，在 Hex 模式新增「搜尋類型」切換（`Alt+X`）：

| 類型 | 輸入 | 說明 |
|---|---|---|
| Hex | `DE AD ?? EF` | 十六進位位元組；`??` 為單位元組萬用字元；空白可省略 |
| Text | `Edit` | 以檔案編碼轉成位元組搜尋；大小寫選項沿用 |

- Regex 與全字比對在 Hex 模式停用（灰顯）。
- 搜尋範圍為整個位元組陣列；命中結果以 `theme.match` 顯示於兩個窗格；`F3` / `Shift+F3` 找下一個 / 上一個。
- 取代：Hex 類型的取代欄為十六進位位元組（可與搜尋長度不同）；Text 類型為文字。取代全部為一個 undo 步驟。
- 搜尋以 `Buffer.indexOf`（無萬用字元時）或逐位元組比對；100 MB 內為即時等級。

## 8. 模式切換與資料同步（核心風險）

### 8.1 文字 → Hex
| 情境 | 行為 |
|---|---|
| 檔案存在且文字**未修改** | 重新從磁碟讀取原始位元組（保留混合 EOL、非法序列、BOM 等文字模式已丟失的資訊）。若磁碟檔 mtime 與記錄不符，先提示 |
| 文字**已修改**（含未命名新文件） | 對話框：`[轉換(Y)]`以目前編碼 + EOL 把文字轉成位元組後進入；`[先存檔(S)]`；`[取消(N)]`。若 `canEncode` 失敗則顯示 `err.encode` 並留在文字模式 |

### 8.2 Hex → 文字
| 情境 | 行為 |
|---|---|
| Hex **未修改** | 直接切回，還原文字模式的游標與捲動；文字文件完整保留（含其 undo 歷史） |
| Hex **已修改**（無論是否已存檔） | 以檔案編碼（使用者曾強制選擇就沿用，否則重新偵測）解碼位元組，**重建**文字文件；undo 歷史清空。對話框先確認：`[套用(Y)]` / `[取消(N)]` |
| 往返有損（解碼後再編碼 ≠ 原位元組：非法序列、混合 EOL、孤立 `\r`） | 套用前的對話框加警告：「部分位元組無法在文字模式表示，存檔後會被改變」 |

### 8.3 兩模式的存檔
- 文字模式存檔不變（`saveFile`：編碼 + EOL 轉換）。
- Hex 模式存檔寫入**原樣位元組**，不做任何編碼 / EOL 轉換。實作上把 `saveFile` 的暫存檔 + rename 部分抽成 `writeAtomic(file, data: Uint8Array)`，兩者共用；新增 `saveBytes()`。
- 存檔後 mtime、權限、`addRecent`、`clearRecovery` 與文字模式一致。
- 「另存新檔」在 Hex 模式同樣可用（對話框預設副檔名保持原樣）。

## 9. 與既有功能的互動

| 功能 | Hex 模式行為 |
|---|---|
| Edit 選單的行操作、縮排、註解、大小寫、移除尾端空白 | `enabled` 守衛：Hex 模式停用（灰顯） |
| View：自動換行、行號、目前行底色、語法高亮、語法模式、特殊字元 | 停用（設定值保留，回文字模式後仍生效） |
| Encoding 選單 | 編碼項可選（只影響 ASCII 窗格輸入 / 搜尋文字 / 切回文字模式的解碼）；EOL 項與「以此編碼重新載入」停用 |
| Undo / Redo | 作用於 `HexDocument`；切換模式後各自獨立 |
| 外部檔案變更偵測 | 同文字模式：未修改 + `autoReload` → 重讀位元組並保留游標偏移；已修改 → 提示 |
| 當機復原快照 | Hex 已修改且 ≤ `WARN_SIZE` 時，快照以位元組形式寫入（`recovery` 新增位元組版本）；超過則不快照並於首次編輯時提示 |
| 最近檔案 / 檢視狀態（`state.json`） | 記住是否為 Hex 模式與游標偏移；下次開啟同檔案時還原 |
| 剪貼簿 | 見 §5.7 |
| 關閉 / 離開 | 髒狀態沿用既有「儲存變更？」對話框 |

## 10. 指令與鍵位

| id | 說明 | 預設鍵 |
|---|---|---|
| `view.hex` | 切換 Hex 模式 | `F8` |
| `hex.togglePane` | 切換 hex / ASCII 窗格 | `Tab`（Hex 模式內） |
| `hex.toggleInsert` | 切換 OVR / INS | `Insert` |
| `goto` | Hex 模式下為偏移跳轉 | `Ctrl+G`（既有） |

- keymap 條目增加選用的 **context**（`'text' | 'hex'`）：同一個鍵在兩模式可綁不同指令（如 `Tab`）。未標 context 的條目兩模式皆有效。
- 分派順序：`dialog | menu | find panel | (Hex 模式：hex 輸入處理) | keymap → command`。hex 輸入處理負責 nibble / ASCII 輸入與 hex 專屬導覽；其餘鍵（`Ctrl+S`、`Ctrl+Z` 等）走既有 keymap。

## 11. 設定

```jsonc
"hex": {
  "bytesPerRow": 16,        // 4 | 8 | 16 | 32 | "auto"
  "groupSize": 0,           // 0 | 4 | 8：群組間多一格空白
  "uppercase": true,        // 十六進位大小寫
  "colorize": true,         // 位元組類別著色
  "autoDetectBinary": true  // 開檔偵測二進位並建議 Hex
}
```
驗證沿用 `parseConfig` 的逐欄位 fallback。

## 12. 程式結構

| 檔案 | 內容 |
|---|---|
| `core/hex/hex-document.ts` | 位元組、游標、選取、編輯、history（純邏輯，無 UI） |
| `core/hex/hex-layout.ts` | 純幾何：`bytesPerRow` 計算、偏移 ↔ 儲存格 / 儲存格 ↔ 偏移 |
| `core/hex/hex-find.ts` | hex / 文字 pattern 解析與搜尋（含 `??`） |
| `core/hex/hex-input.ts` | 按鍵 → nibble / ASCII / 導覽 / 刪除 |
| `core/fs/file-io.ts` | 新增 `loadBytes`、`saveBytes`、`writeAtomic` |
| `core/fs/recovery.ts` | 位元組快照 |
| `core/session.ts` | `hex: HexState \| null`、模式切換、分派、存檔分流 |
| `ui/hex-frame.ts` | `drawHex(ctx)`；登記 `hits`（兩窗格各列一個區域）與 hex 版 `rowMap` |
| `core/menus.ts` `commands.ts` `keymap.ts` | 選單項、指令、keymap context |
| `core/locales/*.ts` | 10 個語系新增鍵（見 §13） |

## 13. i18n 鍵
`mi.hex`、`mi.hexInsert`（可選）、`dlg.hexSwitchTitle/Msg`、`dlg.hexApplyTitle/Msg/LossyMsg`、`dlg.binaryDetectedTitle/Msg`、`btn.convert`、`btn.hexOpen`、`btn.textOpen`、`msg.hexInvalidPaste`、`msg.hexNoEncode`、`prompt.gotoOffset`、`find.hexType`、`find.textType`、`status.hexOffset`（狀態列技術標籤 `HEX`/`Offset`/`Len`/`Sel`/`OVR`/`INS` 維持英文）。

## 14. 測試案例
- `HexDocument`：覆寫 / 插入 / 刪除 / undo 合併 / 尾端附加 / 選取刪除。
- `hex-layout`：各 `bytesPerRow`、`auto` 在各寬度、偏移 ↔ 儲存格互逆。
- `hex-find`：`??` 萬用字元、重疊命中、邊界、文字模式編碼（UTF-8 / Big5）。
- 切換：乾淨文字 → Hex 讀回磁碟位元組（含混合 EOL）；髒文字 → 轉換；Hex 髒 → 文字重建；有損往返警告。
- 存檔：Hex 存檔位元組與記憶體一致、權限保留；唯讀檔阻擋編輯。
- 貼上：合法 / 非法 hex、文字編碼失敗。
- 二進位偵測：含 NUL、UTF-16 有 BOM（不誤判）、空檔。

## 15. 實作階段
1. `HexDocument` + `hex-layout`（純邏輯與測試）。
2. 繪製 + 導覽 + 滑鼠（唯讀檢視）。
3. 編輯（nibble / ASCII / 刪除 / undo / 剪貼簿）+ 位元組存檔。
4. 模式切換與資料同步對話框。
5. 尋找 / 取代 / 跳轉。
6. 二進位偵測、復原快照、檢視狀態記憶、i18n、文件。

## 16. 待確認的決策（括號為建議預設）
1. 預設 OVR 還是 INS？（**OVR**）
2. `Delete`/`Backspace` 在 OVR 模式也刪除位元組？（**是**；替代方案：OVR 下無選取時禁用）
3. 切換鍵 `F8`？（**F8**；部分終端機攔截 F8 時可由 `config.keymap` 改綁）
4. 偏移欄與分隔符號是否照示意圖用 `h:` 與 `;`？（**照圖**；分隔符可改為 `│`）
5. 二進位自動偵測預設開？（**開**，且只詢問、不強制）
6. 默認 `groupSize`？（**0**，與示意圖一致）
