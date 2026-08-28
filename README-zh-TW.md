# Claude Code 使用量監控

🌐 **語言**: [🏠 Main](README.md) | [English](README-en.md) | **繁體中文** | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Bahasa Indonesia](README-id.md)

---

**看清 Claude Code 與 Codex 的本地用量，讓 AI 幫你用得更好。** 不是帳單工具。Claude 保留成本與配額檢視；Codex Beta 依自己的 token 與行為語意提供分析。

> **它是什麼**：一個 VS Code 狀態列小工具，讀取本地 Claude Code 對話日誌，按 token × 公開單價估算用量與成本；並提供可選的 AI 建議功能，幫你優化提示詞、減少不必要的 token 消耗。
>
> **它不是什麼**：帳單工具。顯示金額均為估算值，實際費用請以官方帳單為準。

> 截圖取自英文介面。完整功能說明請見[主 README](README.md)。

## 截圖

### 狀態列

![狀態列](images/v2-status-bar-en.png)

將滑鼠移到配額指示器上可看到明細：

![配額提示](images/v2-quota-en.png)

### 儀表板

![儀表板](images/v2-dashboard-en.png)

## 功能特色

- **狀態列** — 今日成本、當前 session 成本，以及真實的 5 小時 / 每週配額（`5h:N% wk:N%`），透過 Claude Code 自身的 OAuth 工作階段讀取，無需設定。
- **儀表板分頁** — 今日 / 本月 / 全部時間，外加 **Sessions / Projects / Content / Branches**，皆可排序。
- **堆疊式成本構成圖**，含 Y 軸與參考線 —— 一眼看出每日 / 每月的成本中，輸入、輸出、快取寫入、快取讀取各佔多少。
- **Content 分頁** — 估算哪些內容消耗你的 token（你的提示 vs 工具結果 vs 助理輸出 / 思考）。
- **AI 建議**（選用）— 將用量摘要加上你近期提示的樣本送往 OpenAI 相容 API（預設 DeepSeek V4 Pro），給出具體改寫建議。需自備 key，或先預覽靜態示範。
- **多廠商定價** — Opus 4.x / Sonnet 4.x / Haiku 4.5 對照 Anthropic 官方定價；OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen 參考價，含家族感知回退。`Refresh Token Pricing` 可拉取 LiteLLM 即時價格。
- **個人化** — 語言、時區、小數位數、精簡數字、專案分組、儀表板自動刷新開關。

## v2.3 Codex Beta

- Codex 用量記錄只會從 `sessions/**/*.jsonl` 與 `archived_sessions/**/*.jsonl` 中發現；憑證、資料庫與未知檔案仍明確排除。此外，擴充功能會精確串流讀取 `$CODEX_HOME/session_index.jsonl`，僅將 `id` 對應到 `thread_name`，用於真實執行緒標題。標題中的絕對路徑會先去識別化，標題只保留在記憶體。用量 JSONL 會逐行串流並暫時解析，以擷取白名單內的用量與結構中繼資料；提示、回覆、命令和工具參數欄位不會被檢查或用於分析，也不會被保留或持久化。
- **已處理** = 輸入 + 輸出；**未快取用量** = 未快取輸入 + 輸出；**快取輸入**仍是輸入的子集，reasoning 仍是輸出的子集。概覽也會依「快取輸入 / 輸入」顯示輸入快取命中率。Codex 不顯示帳單成本；首張摘要卡會針對目前範圍顯示明確標示的 API 等效成本估算，「全部時間」則依同一定價口徑顯示每週趨勢。Claude / Codex / Compare 仍維持各供應商口徑獨立。
- Codex 的**今天**指設定時區中的目前自然日。頁面會顯示精確的每小時 API 等效成本，並將 Token 構成保留為獨立檢視；每日與每月主圖也預設顯示 API 等效成本，Token 構成仍分開呈現。只有精確符合的已知模型才參與計價，未知模型維持未定價，定價涵蓋率始終可見。這個相容 schema 3 的增量小時 sidecar 只處理已知包含今天用量的 canonical 檔案，支援檢查點與續傳，且不會觸發完整歷史重建。
- 單次請求 Token 歸因優先採用有效的 `last_token_usage` component；其中 `total_tokens` 表示目前上下文大小，不是該次請求的用量。只有完整的 total-plus-last 數字簽名能證明同一假名化 rate-limit 來源或相鄰記錄發生重播時才去重；缺少 last snapshot 時回退為 cumulative lineage high-water。升級後會自動重建一次索引，期間持續顯示已索引小計。
- Claude 與 Codex 的「全部時間」/「比較」會直接依本機 Token 日誌計算歷史已用等價值。最新且有效的官方重設觀測只會錨定一組唯一、互不重疊的每週週期，每筆用量只計入一個週期；沒有可用觀測時，僅已用歷史才回退到 UTC 週一至週一的自然週。任何重疊但未對齊的未來重設都會視為衝突，即使 series 名稱不同，也不能再建立第二個「目前週期」；週期範圍與重設時刻會分開呈現。Codex 用量按日切片保存：若某個切片跨過官方日內重設，其 Token 仍只計一次，受影響週期會標為「邊界近似」，並且只顯示已用等價值，不反推總額度或未用額度。此顯示規則不改變索引 schema，也不會觸發重建。Codex 歷史週期一律只顯示已用值；只有最新目前週期在重設無衝突，且已索引用量可可靠歸屬到單一觀測來源時，才允許反推總額度，目前未用值仍不作為結論。無法歸屬的多登入用量同樣只顯示已用值，不會虛構帳號拆分。歷史統一套用目前官方 API 單價；這是代理估算，不是帳單或官方訂閱價格。此面板預設開啟，可在設定中透過 `showWeeklyEquivalentValue` 關閉。Claude 從此版本開始依本機 profile 記錄額度觀測。
- 切換到 Codex 後仍沿用既有的今天 / 本月 / 全部時間 / 工作階段 / 專案 / 內容 / 設定結構，並依 Codex 語義調整標籤。兩個供應商共用同一組 render function、HTML class、圖表、表格、間距與響應式規則；時間序列圖維持寬度對齊，密集內容只在各自區域內捲動。Codex 建議使用已索引的 30 天結構化證據。
- 根任務使用經過路徑去識別化的最新真實執行緒標題；子任務優先使用自己的真實執行緒標題，缺少時使用其回報的暱稱並顯示父級 / 根任務標題；這些資訊仍缺少時採用本地化的中性回退名稱。專案名稱使用 Git 儲存庫名稱，非 Git 目錄則使用資料夾的末級名稱。擴充功能不會虛構無法可靠統計的 Branches 或 Workflows。
- 最近 7 天與 30 天依設定時區中的事件發生日精確切片。遷移或重建未完成時，Codex 的卡片、表格、專案、工作階段、建議與狀態列都會明確標為**已索引小計**，並排除未驗證的舊版總量。偵測到 Codex home 後會立即顯示供應商分頁；首次建立索引期間會在頁面內即時顯示精確的已索引檔案數、百分比與容量進度，「比較」則等到兩個供應商都有真實資料後才出現。產生第一個原子檢查點後，完整的小計儀表盤會在索引繼續期間保持可用；進度提示不會取代卡片和表格。所選 Codex home 不區分帳戶，因此同一目錄中多個登入帳戶留下的記錄會合併統計；本機記錄沒有可靠的帳戶身分欄位，額度卡只能保留**最後觀測**，不會相加。
- 每則建議只在已索引的 30 天結構聚合有證據時顯示觀測、易讀證據和條件式行動；沒有證據就不會產生泛化建議。
- 持久索引保存使用本機鹽值產生的假名化鍵、數值與結構聚合，以及經過去識別化的專案、目錄、agent、模型、effort、角色、時間和品質中繼資料；絕不保存原始 ID、完整路徑或儲存庫 URL、執行緒標題或對話正文。
- 共用設定分頁在 Codex 下只顯示通用與對 Codex 有效的選項。Codex 資料收集和本地 Codex 建議可分別關閉；背景監聽延遲可設定（預設 30 秒，也可關閉或選更長間隔）。首次建立索引或舊索引遷移尚未收斂時，會取得一次受限的 64 GiB / 16,384 檔案輪次串流上限；這不會預先占用等量記憶體，且仍可取消、可續傳。收斂後，背景工作恢復為 128 MiB / 64 檔案輪次，永遠可見的「重新整理」使用 2 GiB / 512 檔案輪次。未變更的常規重新整理仍不會讀取用量 JSONL 內文。

## 安裝

在擴充功能檢視（`Ctrl+Shift+X`）搜尋 **`Claude Code Usage`**，或：

```
ext install GrowthJack.claude-code-usage
```

也發佈於 [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage)，供 Cursor / Windsurf 使用。

## 設定

開啟設定（`Ctrl+,`）並搜尋 **`Claude Code Usage`**。所有設定皆為選用，最常用的：

- `language` — 介面語言（`auto` / `en` / `de-DE` / `zh-TW` / `zh-CN` / `ja` / `ko` / `pt-BR` / `id`）。
- `timezone` — 日期顯示用的 IANA 時區（如 `Asia/Hong_Kong`）。
- `usageLimitTracking` — 顯示真實的 5 小時 / 每週配額指示器。
- `showCost` / `showContext` — 切換狀態列的成本項目與上下文視窗佔用指示器（類似 `/context`）。
- 上述狀態列項目皆可個別隱藏：將 `usageLimitTracking` / `showCost` / `showContext` 設為 `false` 即可只隱藏該項。
- `advice.apiKey` — AI 建議功能的 API key（OpenAI 相容）。
- `pauseDashboardRefresh` — 暫停儀表板自動刷新（也可在儀表板標題列切換）。

完整設定表請見[主 README](README.md#configuration)。

## 疑難排解

**「無 Claude Code 資料」** — 確認 Claude Code 已安裝並至少使用過一次；檢查 `dataDirectory` 設定（自動偵測會查 `~/.claude/projects`）。

**配額顯示 `5h:--% wk:--%`** — 請登入目前的 Claude profile。憑證依序跟隨
明確設定的 `dataDirectory`、第一個有效的 `CLAUDE_CONFIG_DIR`、最後
`~/.claude`；全域 macOS 鑰匙圈項目只用於預設 profile。

**缺少較早月份的歷史** — Claude Code 會刪除超過 `cleanupPeriodDays`（預設 30 天）的日誌。若要保留更多，在 `~/.claude/settings.json` 設定 `{ "cleanupPeriodDays": 365 }`。已刪除的日誌無法復原。

**Token 總數低於 Claude Code 的 `stats-cache`** — 一次回應可在轉錄中產生
分開的 `thinking` 與 `text` 記錄，兩者帶有相同的 `messageId`、`requestId`
和完整 `usage` 向量。擴充功能按回應身分只計一次並保留最大向量；Claude
Code 的 `stats-cache` 則逐行累加。本擴充功能不會用倍率去貼合快取讀數。

**Token 數低於供應商後台** — 部分代理 / 動態工作流會將各 agent 記錄寫入子目錄，可能不完整。實際消費請以供應商帳單為準。原生工作流歸因功能規劃中。

**大量歷史資料下 CPU 佔用高或重新整理緩慢（包括 Linux）**
- V2.2.1 移除了 active 狀態下隱藏的 8 秒輪詢覆蓋，並限制首時間戳掃描。
  安裝 V2.2.1 前，可先把**即時重新整理延遲**設為**關閉**，把**重新整理間隔**
  設為 **300–900 秒**，並視需要關閉**內容分析**。只關閉儀表板自動重新整理
  並不會停止狀態列所需的日誌解析。
- 若 V2.2.1 仍持續高佔用，請執行 **Show Diagnostic Logs**，只把匿名的
  `refresh:` 行附到 issue #70；其中只有計數與耗時，不含提示詞、路徑、
  session ID、憑證或原始日誌行。

## 致謝

Fork 自 [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)。MIT 授權。社群貢獻致謝見 [CHANGELOG.md](CHANGELOG.md)。許多程式碼改動由 [Claude Code](https://claude.com/claude-code) 協助起草。

開發工具致謝：repository 維護同時使用 [Claude Code](https://claude.com/claude-code) 與 [OpenAI Codex](https://developers.openai.com/codex/)。這只記錄開發工具，與人類貢獻者身分分開；Codex 不會列入 Release Drafter 的人類 contributor 名單，也不會使用虛構的 `Co-Authored-By` 身分。

**歡迎提出 Issue、PR 與想法** —— 這正是專案成長的方式。

## 授權

[MIT](LICENSE)
