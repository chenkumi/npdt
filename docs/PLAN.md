# npdt（Notepad Terminal）專案計劃書

> 指令名稱：`npdt`（原稱 npt / nppt）　｜　發佈方式：npm　｜　平台：Windows / macOS / Linux　｜　TUI：Ink + Ink UI

---

## v1.1 變更

- 快捷列改為無括號的純文字標籤，順序為 `Undo Redo`（原為 Redo、Undo），空間不足時以 `…` 截斷。
- 主題：`classic` 更名為 `light`（設定檔中的 `classic` 自動轉換）；新增 `F9`／「檢視 → 切換深色/淺色模式」。
- 多語系：`src/core/i18n.ts` + `src/core/locales/*.ts`，共 10 種語言，預設英文；設定 `language`（含 `auto`）與「檢視 → 語言…」。選單助記字母、對話框快速鍵（S/N/C/Y）與狀態列技術標籤維持英文。

## 實作狀態（v1.0.0）

M0–M12 已全部完成並通過測試（單元、元件、pty 端到端、單一執行檔端到端）。與原計劃的差異：

| 項目 | 原計劃 | 實際 |
|---|---|---|
| UI 元件 | Ink + Ink UI | 只用 Ink 做輸出；整個畫面先畫進自製的 cell 網格（`src/ui/screen.ts`）再輸出。下拉選單、對話框直接覆蓋編輯區，滑鼠命中區由同一份繪圖產生。未使用 `@inkjs/ui`（沒有編輯器/選單元件可用） |
| 輸入 | Ink `useInput` | 自行解析 stdin（`src/input`）：F 鍵、Alt、kitty protocol、modifyOtherKeys、SGR 滑鼠、括號貼上。Ink 只拿到一個不產生資料的 stdin |
| Node 版本 | ≥ 20 | ≥ 22（Ink 8 要求） |
| 分頁 | 有 | 不做（單一文件）；保留 Close，刪除 SaveAll/CloseAll |
| `Ctrl+Q` | 待決 | 結束；`Ctrl+K` 單行註解、`Ctrl+Shift+K` 區塊註解（備用 `Alt+K`） |
| `Ctrl+H` | 取代 | 一般終端 `0x08` 視為 `Ctrl+Backspace`（刪除前一個字）；`Ctrl+H` 僅在 kitty protocol 下可用，取代另綁 `Ctrl+R` |
| 剪貼簿 | clipboardy | 自行呼叫平台工具（Windows `clip.exe`/PowerShell、`pbcopy`、`wl-copy`/`xclip`/`xsel`），失敗時用 OSC 52。理由：單一執行檔無法帶 clipboardy 的內建二進位 |
| 語法高亮 | highlight.js | `lowlight`（`common` 語言組），只計算可視範圍 ± 緩衝並依版本快取 |
| 單一執行檔 | Node SEA / bun | Node SEA（`npm run build:sea`，需 Node ≥ 25.5 以支援 ESM 入口） |
| 搜尋 | — | 以「單行」為單位（不支援跨行 pattern） |
| 髒狀態 | — | 以 Undo 堆疊深度判斷，Undo 回到存檔狀態即視為未修改 |

效能實測（20 萬行、120×40 視窗）：整頁渲染約 16 ms、輸入一字＋渲染約 24 ms、移動游標 < 1 ms。

---

## 1. 專案目標與定位

### 1.1 目標
提供「開箱即用、不需要學 vim/emacs」的終端機文字編輯器。使用者熟悉的 Notepad++ 操作（選單列、快捷列、Ctrl 系列快捷鍵、搜尋取代）原樣搬到 terminal。

### 1.2 目標使用者
- 在 SSH / 容器 / 精簡環境中需要改設定檔的 Windows 背景開發者
- 不想學 vim 的新手、維運人員
- 想要有選單可點的輕量編輯器的人

### 1.3 非目標（v1 不做）
- 不做 LSP、自動補全、Plugin 系統、Git 整合
- 不做二進位檔 / hex 編輯
- 不支援舊版 Windows `conhost`（僅 Windows Terminal / 現代終端）
- 不做巨型檔（> 100 MB）的流暢編輯（v1 以「唯讀提示 + 拒絕開啟」處理）
- 不追求取代 vim/neovim，只追求「記事本等級＋語法高亮」（語法高亮已列入 v1）

### 1.4 成功指標
| 指標 | 目標 |
|---|---|
| 啟動時間（開 1 MB 檔案） | < 500 ms |
| 按鍵到畫面更新延遲 | < 50 ms（10 萬行以內） |
| 三平台主流終端可用 | Windows Terminal、PowerShell、iTerm2、Terminal.app、GNOME Terminal、tmux |
| 資料安全 | 存檔採原子寫入，不因當機損毀原檔 |

---

## 2. 指令介面（CLI）

| 指令 | 行為 |
|---|---|
| `npt` | 開啟空白未命名文件 |
| `npt <name>` | 檔案存在 → 開啟；不存在 → 建立空緩衝區，第一次存檔時才寫入磁碟（避免留下空檔） |
| `npt <name>:<line>[:<col>]` | 開啟並跳至指定位置（延伸） |
| `npt -` 或 stdin pipe | 讀取 stdin 為未命名文件（延伸） |
| `npt --help / --version` | 說明 / 版本 |
| `npt --encoding <enc>` | 強制指定開啟編碼 |

> 註：`<name>` 為「create/read」語意。建議**延遲建立**（存檔時才落地），並在狀態列顯示 `New file`。

---

## 3. 畫面設計

### 3.1 版面（由上而下）
```
┌ 選單列 ─ 檔案(F) 編輯(E) 搜尋(S) 檢視(V) 編碼(N) 關於(?)        白底黑字
├ 快捷列 ─ New Open Save Close | Cut Copy Paste | Undo Redo | Search Replace   深灰底白字（v1.1 起無括號、隨語言本地化）
├ 編輯區 ─ 行號(淺灰底黑字) │ 內容
├ （搜尋/取代面板：視需要顯示於編輯區上方或下方，1–2 行）
└ 狀態列 ─ <status> │ Length:… Lines:… │ Ln:… Col:… │ CRLF │ UTF-8        深灰底灰字
```

### 3.2 對原設計的補強建議
1. **單一文件模式（不做分頁）**：`New`/`Open` 取代目前文件，有未儲存修改時先確認；`Close` 關閉後回到空白未命名文件；移除 SaveAll/CloseAll。標題或狀態列以 `*` 標示未儲存。文件狀態仍封裝為 `Document` 物件，保留日後加分頁的空間。
2. **快捷列需可響應寬度**：窄終端（< 100 欄）時自動收合為圖示/縮寫，最後以 `…` 收納。
3. **狀態列補欄位**：行尾格式（CRLF/LF/CR）、插入/覆寫模式（INS/OVR）、檔案類型（語言）。
4. **原稿 `Row` 應為 `Ln`**，與 Notepad++ 一致（Ln / Col / Sel）；有選取時顯示 `Sel: n | m`。
5. **對話框**：開啟檔案、另存新檔、離開前確認需要 Modal（Ink 內自製，見 §5.4）。
6. **主題**：色彩集中於 theme 檔；偵測不支援 256/truecolor 時降級；提供 light / dark / high-contrast。

### 3.3 色彩（預設主題 `light`，v1.0 稱 `classic`）
| 區域 | 背景 | 前景 |
|---|---|---|
| 選單列 | 白 | 黑 |
| 快捷列 | 深灰 | 白 |
| 行號 | 淺灰 | 黑（目前行反白） |
| 狀態列 | 深灰 | 灰 |
| 選取範圍 | 藍 | 白 |
| 搜尋命中 | 黃 | 黑 |

---

## 4. 功能規格

### 4.1 選單內容
| 選單 | 項目 |
|---|---|
| 檔案(F) | 新增 `Ctrl+N`、開啟 `Ctrl+O`、儲存 `Ctrl+S`、另存新檔 `Ctrl+Alt+S`、關閉 `Ctrl+W`、最近檔案 ▸、結束 `Ctrl+Q` |
| 編輯(E) | 復原 `Ctrl+Z`、重做 `Ctrl+Y`、剪下/複製/貼上、全選 `Ctrl+A`、刪除行 `Ctrl+L`、複製行 `Ctrl+D`、上/下移行 `Ctrl+Shift+↑/↓`（替代 `Alt+↑/↓`）、縮排/反縮排 `Tab`/`Shift+Tab`、轉大小寫、移除行尾空白、單行註解切換 `Ctrl+K`、區塊註解 `Ctrl+Shift+K`（替代 `Alt+K`） |
| 搜尋(S) | 尋找 `Ctrl+F`、取代 `Ctrl+H`、找下一個 `F3`、找上一個 `Shift+F3`、跳至行 `Ctrl+G` |
| 檢視(V) | 自動換行、顯示空白/行尾符號、顯示行號、主題 ▸ |
| 編碼(N) | UTF-8 / UTF-8 BOM / UTF-16 LE/BE / Big5 / GBK / Shift-JIS / Latin-1…；行尾 CRLF/LF/CR 轉換；「以…編碼重新載入」 |
| 關於(?) | 版本、快捷鍵總表、授權 |

選單操作：`Alt+字母`（F/E/S/V/N/?）或 `F10` 開啟；`←→` 切換、`↑↓` 移動、`Enter` 執行、`Esc` 關閉；滑鼠點擊。

> 快捷鍵衝突備註：許多終端攔截 `Ctrl+S`（XOFF）、`Ctrl+Z`（SIGTSTP）、`Ctrl+Shift+*`。需進入 raw mode 關閉流控，並為無法偵測的組合提供替代鍵（見 §6.3）。

### 4.2 編輯核心
- 文字緩衝：v1 採「行陣列 + 變更日誌」；介面抽象成 `TextBuffer`，日後可換 piece table / rope，不影響 UI。
- 游標、選取（Shift+方向、Shift+滑鼠、雙擊選字、三擊選行）、多段落貼上
- Undo/Redo：以「操作群組」合併連續輸入（輸入停頓或游標移動則切段），深度上限可配置
- 自動縮排、Tab/空白轉換（設定 tab size、insert spaces）
- 自動換行（soft wrap）與水平捲動兩種模式；寬字元（CJK、emoji）以 `string-width` 計算顯示寬度，確保游標位置正確
- 行尾符保留：開啟時偵測，存檔時還原，不擅自改變

### 4.3 搜尋 / 取代
- 選項：區分大小寫、全字、正規表示式、循環搜尋
- 取代單筆 / 全部，全部取代為單一 Undo 步驟
- 命中即時高亮、顯示 `3/27`
- 範圍：目前檔案（v1）；所有已開檔案、選取範圍（v1.1）

### 4.4 檔案 I/O
- **讀**：偵測 BOM → `jschardet`/`chardet` 推測 → fallback UTF-8；偵測失敗在狀態列提示並可由編碼選單手動重載
- **寫**：寫入暫存檔 → `fsync` → `rename`（原子）；保留原檔權限；符號連結則寫入其目標
- **安全**：唯讀檔案提示；檔案被外部修改（mtime 變動）時，儲存前警告；崩潰復原——定期（如 5 秒無輸入）寫入 `~/.npt/recovery/`，下次啟動提示還原
- 大小限制：> 10 MB 警告、> 100 MB 拒絕（v1）

### 4.5 語法高亮（v1 必做）
採用 `highlight.js` / `lowlight` 或 `tree-sitter` WASM，依副檔名切換；僅對可視範圍計算以確保效能。

### 4.6 設定
- `~/.nptrc.json`（或 `$XDG_CONFIG_HOME/npt/config.json`；Windows 用 `%APPDATA%\npt\`）
- 項目：theme、tabSize、insertSpaces、wordWrap、showLineNumbers、defaultEncoding、defaultEol、keymap 覆寫、最近檔案數
- 以 `zod` 驗證，錯誤時用預設值並在狀態列警告，不中斷啟動

---

## 5. 技術架構

### 5.1 技術選型
| 項目 | 選擇 | 理由 |
|---|---|---|
| 語言 | TypeScript（strict） | 型別安全 |
| Runtime | Node.js ≥ 22（Ink 8 要求） | npm 發佈、跨平台 |
| TUI | Ink 5+（React）＋ Ink UI | 使用者指定 |
| 建置 | `tsup`（ESM 單檔輸出） | 啟動快、bin 簡單 |
| 狀態管理 | `zustand`（或 React reducer） | 輕量、可在 React 外存取 |
| 測試 | `vitest` + `ink-testing-library` | 單元＋元件 |
| E2E | `node-pty` + 虛擬終端（如 `@xterm/headless`） | 真實按鍵序列測試 |
| 編碼 | `iconv-lite`、`chardet` | 純 JS，無原生依賴 |
| 字寬 | `string-width`、`slice-ansi` | CJK / emoji |
| 剪貼簿 | `clipboardy` ＋ OSC 52 fallback | SSH 環境也能用 |
| Lint/格式 | ESLint + Prettier | — |
| CI | GitHub Actions（三 OS × Node 22/24） | — |

> **重要風險**：Ink UI 提供 TextInput / Select / Spinner 等通用元件，**沒有**多行程式碼編輯器、下拉選單、對話框的完整實作。編輯區、選單列、Modal、檔案選擇器需**自製元件**（可用 Ink UI 的主題與基礎元件拼接）。計劃已據此估工。

### 5.2 分層與目錄
```
npt/
├─ bin/npt.js                  # shebang，載入 dist/cli.js
├─ src/
│  ├─ cli.tsx                  # 參數解析（meow/commander）、啟動 Ink render
│  ├─ app/                     # <App/>、全域佈局、焦點管理
│  ├─ core/                    # 與 UI 無關，可純單元測試
│  │  ├─ buffer/               # TextBuffer、Cursor、Selection、UndoStack
│  │  ├─ search/               # 搜尋 / 取代引擎
│  │  ├─ fs/                   # 讀寫、編碼偵測、原子寫入、recovery
│  │  ├─ commands/             # Command registry（id → handler）
│  │  └─ config/               # schema、載入、預設
│  ├─ ui/
│  │  ├─ MenuBar/ DropdownMenu/
│  │  ├─ Toolbar/ TabBar/
│  │  ├─ Editor/ (Viewport, LineNumbers, Line, Cursor)
│  │  ├─ FindPanel/ StatusBar/
│  │  └─ dialogs/ (Open, SaveAs, Confirm, GoToLine, Encoding)
│  ├─ input/                   # 按鍵/滑鼠解析、Keymap、組合鍵正規化
│  ├─ theme/
│  └─ platform/                # 平台差異（剪貼簿、路徑、終端能力偵測）
├─ test/ (unit / component / e2e / fixtures)
└─ docs/
```

### 5.3 核心設計原則
1. **Command 模式**：所有動作（選單、快捷列、快捷鍵、命令面板）都派送同一組 `Command`，保證三種入口行為一致、易測試。
2. **core 零 UI 依賴**：Buffer、Search、FS 可在純 Node 測試。
3. **單向資料流**：`input → command → store → render`。
4. **虛擬化渲染**：只渲染可視行（Viewport），行 key 穩定，避免整頁 re-render；游標/狀態列獨立訂閱 store 片段。
5. **終端能力偵測**：色彩深度、Unicode、滑鼠、OSC 52 一次偵測，集中於 `platform/`。

### 5.4 自製元件重點
- **Editor**：Ink 預設 `useInput` 對特殊鍵/貼上/滑鼠支援有限，需自建 `input/` 層直接解析 stdin 的 CSI/SS3 序列，啟用 bracketed paste（`ESC[?2004h`）與 SGR 滑鼠（`ESC[?1006h`），離開時務必還原終端狀態（含 SIGINT/例外）。
- **DropdownMenu**：以絕對定位覆蓋；Ink 無 z-index，採「在編輯區上層重繪」策略（開啟選單時由 App 決定渲染順序，被覆蓋區不重繪下層內容）。
- **Modal / FileDialog**：自製目錄瀏覽（`readdir`、排序、過濾、鍵盤導覽）。
- **Alternate screen**：啟動進入 alt screen、結束還原，避免汙染 scrollback。

---

## 6. 跨平台考量

### 6.1 Windows
- Windows Terminal / PowerShell 7 支援良好；舊 `conhost` 可能缺 truecolor 與滑鼠 → 降級
- 路徑分隔、磁碟機代號、保留檔名（CON、NUL…）、長路徑
- CRLF 為預設行尾；`npm` 產生 `.cmd` shim，須驗證 `npt` 可被 PowerShell / cmd / Git Bash 執行

### 6.2 macOS / Linux
- `Option` 鍵在 macOS Terminal 預設不送 Meta，需文件說明或提供替代鍵
- `XDG` 路徑；權限、符號連結；剪貼簿工具（`pbcopy`、`xclip`/`wl-copy`）缺失時 fallback OSC 52

### 6.3 鍵盤差異對照策略
無法可靠偵測的組合（`Ctrl+Shift+*`、`Ctrl+Alt+*`）一律提供替代鍵：

| 動作 | 主鍵 | 替代 |
|---|---|---|
| 另存新檔 | Ctrl+Alt+S | F12 / 選單 |
| 區塊註解 | Ctrl+Shift+K | Alt+K / 選單 |
| 重做 | Ctrl+Y | Ctrl+Shift+Z |

並支援 kitty keyboard protocol / modifyOtherKeys 以在支援的終端取得完整修飾鍵。

---

## 7. 發佈與包裝

- `package.json`：`"bin": {"npt": "bin/npt.js"}`、`"type": "module"`、`"engines": {"node": ">=22"}`、`"files": ["bin","dist"]`
- 名稱：發佈前確認 npm 套件名（`npt` 可能已被佔用 → 備案 scoped `@<scope>/npt` 或 `notepadplus-terminal`，bin 仍為 `npt`）
- 安裝：`npm i -g <pkg>`，並支援 `npx <pkg>`
- 版本：SemVer；GitHub Actions 打 tag 自動 `npm publish --provenance`
- 供應鏈：鎖定依賴、`npm audit`、依賴盡量純 JS（避免 node-gyp 造成安裝失敗）；`node-pty` 僅作 devDependency
- 後續選項（v1.x）：以 Node SEA / `bun build --compile` 產出單一執行檔，供無 Node 環境使用；Homebrew / Scoop / winget

---

## 8. 測試策略

| 層級 | 內容 | 工具 |
|---|---|---|
| 單元 | Buffer 操作、Undo/Redo、搜尋取代、編碼偵測、keymap 解析 | vitest（含 property-based：`fast-check`，隨機操作序列驗證 undo 後還原） |
| 元件 | MenuBar、Editor 渲染、StatusBar 數值 | ink-testing-library |
| E2E | 以 pty 送真實按鍵：開檔→編輯→存檔→比對磁碟內容 | node-pty + xterm headless |
| 跨平台 | CI 三 OS 矩陣；CRLF/BOM/CJK fixture | GitHub Actions |
| 手動 | 各終端相容性清單（§1.4） | 檢查表 |
| 效能 | 1 萬 / 10 萬 / 100 萬行開檔、捲動、輸入基準 | benchmark 腳本 |

必測邊界：空檔、無結尾換行、混合行尾、含 BOM、非法 UTF-8、超長單行、CJK/emoji 游標、極小終端（< 40×10）、視窗縮放、唯讀檔、權限不足、外部修改。

---

## 9. 里程碑與時程（單人估算，可調整）

| 階段 | 內容 | 驗收標準 | 估時 |
|---|---|---|---|
| **M0 專案骨架** | repo、TS/tsup/vitest/CI、bin 可執行、Ink hello world 三平台通過 | `npx .` 三 OS 可啟動 | 2–3 天 |
| **M1 核心緩衝區** | TextBuffer、游標、選取、Undo/Redo、單元測試 | 隨機操作 property test 通過 | 1 週 |
| **M2 檔案 I/O** | 讀寫、編碼/BOM/EOL、原子寫入、`npt <name>` 行為 | fixtures 全綠 | 4–5 天 |
| **M3 基礎編輯 UI** | Editor 視圖、行號、捲動、狀態列、鍵盤輸入、alt screen、終端還原 | 可開檔、編輯、存檔、離開不留殘 | 1.5 週 |
| **M4 選單與快捷列** | MenuBar+Dropdown、Toolbar、Command registry、快捷鍵、離開確認 | 所有 §4.1 項目可由三種入口觸發 | 1.5 週 |
| **M5 對話框與文件生命週期** | 開啟/另存/確認對話框、New/Open/Close 流程、未儲存保護 | 切換文件不遺失資料 | 4–5 天 |
| **M6 搜尋取代** | FindPanel、regex、全部取代、命中高亮、跳至行 | 搜尋測試通過 | 1 週 |
| **M7 滑鼠與剪貼簿** | SGR 滑鼠、點選選單/游標/拖曳選取、bracketed paste、系統剪貼簿 + OSC52 | 三平台手動驗證 | 1 週 |
| **M8 設定與主題** | config、主題、鍵位覆寫、最近檔案、recovery | 設定錯誤不影響啟動 | 1 週 |
| **M9 語法高亮** | 副檔名→語言對應、僅對可視範圍計算、主題配色、快取增量更新 | 常見語言(JS/TS/JSON/MD/Py/C/Go/Rust/HTML/CSS/YAML/Shell)高亮正確且不影響 §1.4 延遲 | 1 週 |
| **M10 效能與穩定** | 大檔、虛擬化最佳化、CJK/寬字元、縮放、e2e 補齊 | §1.4 指標達成 | 1 週 |
| **M11 單一執行檔** | Node SEA / `bun build --compile` 三平台產物、GitHub Release 自動上傳 | 無 Node 環境可執行 | 4–5 天 |
| **M12 發佈 v1.0** | README、操作 GIF、授權、npm publish、版本流程 | `npm i -g nppt` 與單一執行檔三平台可用 | 3–4 天 |
| **v1.1+** | 跨檔搜尋、命令面板、Homebrew/Scoop/winget、plugin | — | 之後 |

總計約 **11–13 週**（單人兼職可再放寬 1.5 倍）。M0–M3 完成即為「可用的記事本」，可提早 dogfood。

---

## 10. 風險與對策

| 風險 | 影響 | 對策 |
|---|---|---|
| Ink 重繪造成閃爍 / 大檔卡頓 | 高 | 視口虛擬化、節流渲染、必要時對編輯區繞過 React 直接輸出 |
| Ink UI 無編輯器 / 下拉選單元件 | 高 | 已列入自製範圍；M3/M4 為最大工作量 |
| 鍵盤組合鍵跨終端不一致 | 高 | 替代鍵 + kitty protocol + 完整快捷鍵文件 |
| 滑鼠事件與 Ink 輸入處理衝突 | 中 | 自建 input 層，統一接管 stdin |
| 編碼誤判造成亂碼並被存回 | 高 | 顯示偵測結果、存檔前若編碼不可逆轉換則警告、不默默替換字元 |
| 當機 / 斷線遺失資料 | 高 | 原子寫入 + recovery 檔 |
| 終端未還原（raw mode、滑鼠殘留） | 中 | 集中 `terminal.restore()`，掛 `exit`/`SIGINT`/`uncaughtException` |
| npm 名稱被佔用 | 低 | 提早查詢，備案 scoped 名稱 |
| 寬字元 / emoji 游標錯位 | 中 | 以 grapheme（`Intl.Segmenter`）為游標單位，字寬獨立計算 |

---

## 11. 已確認決策

| # | 議題 | 決策 |
|---|---|---|
| 1 | npm 套件名稱 | **`nppt`**（發佈前仍需 `npm view nppt` 確認可用）。指令：`nppt`，同時提供 `npt` 作為短別名（見註） |
| 2 | 語法高亮 | **v1 必做**（M9，+1 週） |
| 3 | 舊版 conhost | **不支援**，僅現代終端 |
| 4 | `nppt <不存在檔名>` | **存檔時才建立** |
| 5 | 快捷鍵策略 | **先完全模仿 Notepad++**；有衝突者列於 §11.1 由你決策 |
| 6 | 單一執行檔 | **要**（M11） |
| 7 | 分頁 | **不做**（單一文件模式，保留 `Close`；刪除 SaveAll/CloseAll） |
| 8 | `Ctrl+Q` / 註解 | `Ctrl+Q` 結束；`Ctrl+K` 單行註解；`Ctrl+Shift+K` 區塊註解（替代 `Alt+K`） |

> 註：你指示「採用 nppt」，我解讀為套件名；為了不破壞前面討論的 `npt` 指令，bin 同時註冊 `nppt` 與 `npt`。若只要 `nppt`，刪掉一行即可。

### 11.1 快捷鍵衝突清單（待你決策）

以 Notepad++ 預設為準。「無法偵測」= 一般終端不會送出可區分的序列（需 kitty keyboard protocol 才可能）。「終端佔用」= 該位元組與其他按鍵相同。

| # | Notepad++ 動作 | 按鍵 | 問題 | 建議 |
|---|---|---|---|---|
| 1 | 取代 | `Ctrl+H` | 終端送 0x08，與 Backspace 相同（部分終端 Backspace 即送 0x08） | 保留 `Ctrl+H`，但僅在能區分時生效；永遠另提供 `Ctrl+R` 與選單入口 |
| 2 | 分割行 / 合併行 | `Ctrl+I` / `Ctrl+J` | 0x09=Tab、0x0A=Enter，無法區分 | 改 `Alt+I` / `Alt+J`，或僅走選單 |
| 3 | 另存新檔 | `Ctrl+Alt+S` | 多數終端無法偵測 | 加 `F12`（選單入口並存） |
| 4–6 | 全部儲存／全部關閉／切換分頁 | — | **已隨「不做分頁」移除** | — |
| 7 | 上/下移行 | `Ctrl+Shift+↑/↓` | 無法偵測 | 加 `Alt+↑/↓`（macOS 需將 Option 設為 Meta） |
| 8 | 結束 | `Alt+F4` | 由終端視窗攔截 | **已決策**：`Ctrl+Q` 結束 |
| 9 | 註解 | N++ 為 `Ctrl+Q`/`Ctrl+K` | 與結束衝突 | **已決策**：`Ctrl+K` 單行註解切換；`Ctrl+Shift+K` 區塊註解（無法偵測時以 `Alt+K` / 選單替代，支援 kitty keyboard protocol 的終端可直接用） |
| 10 | 刪除字（向前） | `Ctrl+Backspace` | 各終端序列不一致（0x08 / 0x7F / `ESC DEL`） | 偵測多種序列映射；另加 `Alt+Backspace` |
| 11 | 選單啟動 | `Alt+F/E/S/V/N/?` | macOS Option 預設不送 Meta；`Alt+N` 等在部分終端被當作字元 | 同時支援 `F10` / `F9`，文件說明 macOS 設定 |
| 12 | 暫停流控 / 中斷 | `Ctrl+S` / `Ctrl+Q` / `Ctrl+Z` / `Ctrl+C` | raw mode 可解決（XOFF、SIGTSTP、SIGINT 均不再觸發） | 無需改動，僅須在 M3 確實關閉流控並測試 tmux/ssh |
| 13 | 縮放 / 全螢幕 | `Ctrl+滾輪` / `F11` | 終端自行處理 | 不實作 |

**狀態**：#8、#9 已決策；其餘依「建議」欄執行，如有異議再提出。

---

## 12. 下一步
1. 確認 §11.1 其餘建議（無異議即採用）
2. 執行 M0：初始化 TypeScript + Ink 專案、CI、`bin/npt`
3. 先以 spike 驗證兩個最高風險點：**(a) 自製 Editor 在 10 萬行下的渲染效能、(b) 下拉選單覆蓋與滑鼠輸入**，再投入後續里程碑
