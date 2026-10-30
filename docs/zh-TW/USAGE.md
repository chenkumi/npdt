# 使用說明

## 使用

| 指令 | 說明 |
|---|---|
| `npdt` | 開啟空白文件 |
| `npdt <name>` | 開啟檔案；檔案不存在時建立空白文件，**第一次存檔才會真的建立** |
| `npdt <name>:<行>[:<欄>]` | 開啟並跳到指定位置 |
| `npdt --encoding big5 <name>` | 強制以指定編碼開啟 |
| `npdt --no-mouse` | 停用滑鼠 |

套件提供 `npdt` 指令。一次編輯一個檔案（不做分頁）。

## 快捷鍵

沿用 Windows 記事本與常見編輯器的習慣；終端機收不到的組合鍵都有備用鍵。完整清單可按 `F1`。

| 功能 | 按鍵 | 備用 |
|---|---|---|
| 新增 / 開啟 / 儲存 / 關閉 / 結束 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+W` / `Ctrl+Q` | |
| 另存新檔 | `Ctrl+Alt+S` | `F12`、選單 |
| 復原 / 重做 | `Ctrl+Z` / `Ctrl+Y` | `Ctrl+Shift+Z` |
| 剪下 / 複製 / 貼上 / 全選 | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A` | 未選取時剪下/複製整行 |
| 刪除行 / 複製行 | `Ctrl+L` / `Ctrl+D` | |
| 上移 / 下移行 | `Ctrl+Shift+↑/↓` | `Alt+↑/↓` |
| 縮排 / 取消縮排 | `Tab` / `Shift+Tab` | |
| 單行註解 / 區塊註解 | `Ctrl+K` / `Ctrl+Shift+K` | 區塊註解備用 `Alt+K` |
| 大寫 / 小寫 | `Ctrl+Shift+U` / `Ctrl+U` | |
| 尋找 / 取代 | `Ctrl+F` / `Ctrl+H` | 取代備用 `Ctrl+R` |
| 找下一個 / 上一個 | `F3` / `Shift+F3` | |
| 跳至行 | `Ctrl+G` | |
| 選單 | `F10`、`Alt+F/E/S/V/N/?` | 滑鼠點擊；選單字母固定為 F E S V N ?，不隨語言改變 |
| 深色 / 淺色模式 | `F9` | 也可由「檢視」選單切換 |

說明：
- 一般終端機分不出 `Ctrl+Shift+字母` 與 `Ctrl+字母`，也分不出 `Ctrl+H` 與 Backspace。支援 [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) 的終端機（如 kitty、WezTerm、foot、iTerm2）會自動啟用完整組合鍵；其他終端機請用備用鍵。
- macOS Terminal.app 預設 `Option` 不送 Meta，請在「描述檔 → 鍵盤」勾選「將 Option 鍵作為 Meta 鍵」，或改用 `F10` 開選單。
- 尋找面板內：`Enter` 找下一個、`Shift+Enter` 找上一個、`Tab` 切換尋找/取代欄、`Alt+C` 大小寫、`Alt+W` 全字、`Alt+R` 正規表示式、`Alt+A` 全部取代、`Esc` 關閉。搜尋預設以「單行」為單位；開啟正規表示式後，若語法含 `\n` 或 `\r`（如 `foo\nbar`），會改為跨行比對（`^`、`$` 仍代表行首、行尾），取代亦同。

## 滑鼠

點選選單 / 快捷列 / 狀態列（點編碼或行尾格式會開編碼選單）、拖曳選取、雙擊選字、三擊或點行號選行、滾輪捲動（`Shift+滾輪` 水平捲動）。

## 檔案與編碼

- 自動偵測 BOM、UTF-8、UTF-16、Big5、GBK、Shift-JIS、EUC-KR、Windows-1252；狀態列顯示結果，可由「編碼」選單重新載入或改變儲存編碼。
- 保留原檔的行尾格式（CRLF / LF / CR）與 BOM。
- 存檔使用「寫入暫存檔 → fsync → rename」，不會因當機損毀原檔；會保留權限並追隨符號連結。
- 儲存前若發現檔案已被外部修改會詢問；內容無法以目前編碼儲存時會拒絕，不會默默替換字元。
- 檔案權限：狀態列顯示目前權限（POSIX 為 `rwxr-xr-x`，Windows 為 `RW` / `RO`），點擊或用「檔案 → 檔案權限…」變更。POSIX 輸入 3 位八進位（如 `644`）；Windows 只能切換唯讀屬性。尚未儲存的文件無法設定。
- 每 5 秒（有未存修改時）寫入復原檔到設定資料夾，下次開啟同一檔案會詢問是否還原。
- 超過 10 MB 會警告，超過 100 MB 拒絕開啟。

## 設定

設定檔位置：Windows `%APPDATA%\npdt\config.json`；macOS / Linux `$XDG_CONFIG_HOME/npdt/config.json`（預設 `~/.config/npdt/config.json`）。

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

- 主題：`dark`（預設）、`light`（舊名 `classic` 仍可使用）、`contrast`。`F9` 在深色與淺色間切換，也可由「檢視 → 主題」選擇；選單中的變更會自動寫回設定檔。
- 語言：預設 `en`。支援 `en`、`zh-TW`（繁體中文）、`zh-CN`（简体中文）、`ja`、`ko`、`es`、`fr`、`de`、`pt-BR`、`ru` 共 10 種，另有 `auto`（依 `LC_ALL` / `LANG` 等系統語系自動選擇）。由「檢視 → 語言…」切換，立即生效。狀態列的技術標籤（Length / Lines / Ln / Col）不翻譯。
- 新增語言：複製 `src/core/locales/en.ts`、翻譯後在 `src/core/i18n.ts` 註冊；請確保所有語言的鍵與 `{參數}` 一致。
- `autoReload`：檔案在磁碟上被外部程式修改時，若目前沒有未存修改就自動重新載入並保留游標位置；有未存修改則只提示，不會覆蓋。重新載入後復原（Undo）歷史會清空。
- 關閉檔案時會記住游標與捲動位置（存於設定資料夾的 `state.json`，最多 200 個檔案），下次開啟同一檔案自動回到原位。
- 無效的設定值只會回退到預設並在狀態列提示，不影響啟動。
- `keymap` 的值為命令 id（見 `src/core/commands.ts`），`"none"` 表示取消綁定。

## 開發

```sh
npm install
npm run dev        # tsup watch
npm start          # 執行 dist（先 npm run build）
npm run typecheck
```

架構摘要：`src/core` 不依賴 UI（緩衝區、Undo、搜尋、檔案 I/O、命令、`Session` 狀態機）；`src/ui/frame.ts` 把整個畫面畫到自製的 cell 網格再交給 Ink 輸出，因此下拉選單與對話框可以直接覆蓋在編輯區上；`src/input` 自行解析鍵盤 / 滑鼠 / 貼上序列（含 kitty protocol），Ink 只負責輸出。設計細節見 [PLAN.md](../PLAN.md)。

## 授權

MIT
