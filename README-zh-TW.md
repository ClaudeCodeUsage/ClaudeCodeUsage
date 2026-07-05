# Claude Code 使用量監控

🌐 **語言**: [🏠 Main](README.md) | [English](README-en.md) | **繁體中文** | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | [한국어](README-ko.md)

---

**看清你的 Claude Code 用量，讓 AI 幫你用得更好。** 不是帳單工具，不是多 provider 監控面板。一個專注於 token 精確歸因、並以 AI 幫你優化使用習慣的輕量 VS Code 插件。

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

## 安裝

在擴充功能檢視（`Ctrl+Shift+X`）搜尋 **`Claude Code Usage`**，或：

```
ext install GrowthJack.claude-code-usage
```

也發佈於 [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage)，供 Cursor / Windsurf 使用。

## 設定

開啟設定（`Ctrl+,`）並搜尋 **`Claude Code Usage`**。所有設定皆為選用，最常用的：

- `language` — 介面語言（`auto` / `en` / `zh-TW` / `zh-CN` / `ja` / `ko`）。
- `timezone` — 日期顯示用的 IANA 時區（如 `Asia/Hong_Kong`）。
- `usageLimitTracking` — 顯示真實的 5 小時 / 每週配額指示器。
- `showCost` / `showContext` — 切換狀態列的成本項目與上下文視窗佔用指示器（類似 `/context`）。
- 上述狀態列項目皆可個別隱藏：將 `usageLimitTracking` / `showCost` / `showContext` 設為 `false` 即可只隱藏該項。
- `advice.apiKey` — AI 建議功能的 API key（OpenAI 相容）。
- `pauseDashboardRefresh` — 暫停儀表板自動刷新（也可在儀表板標題列切換）。

完整設定表請見[主 README](README.md#configuration)。

## 疑難排解

**「無 Claude Code 資料」** — 確認 Claude Code 已安裝並至少使用過一次；檢查 `dataDirectory` 設定（自動偵測會查 `~/.claude/projects`）。

**配額顯示 `5h:--% wk:--%`** — 登入 Claude Code 一次即可；插件以唯讀方式讀取 `~/.claude/.credentials.json`。

**缺少較早月份的歷史** — Claude Code 會刪除超過 `cleanupPeriodDays`（預設 30 天）的日誌。若要保留更多，在 `~/.claude/settings.json` 設定 `{ "cleanupPeriodDays": 365 }`。已刪除的日誌無法復原。

**Token 數低於供應商後台** — 部分代理 / 動態工作流會將各 agent 記錄寫入子目錄，可能不完整。實際消費請以供應商帳單為準。原生工作流歸因功能規劃中。

## 致謝

Fork 自 [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)。MIT 授權。社群貢獻致謝見 [CHANGELOG.md](CHANGELOG.md)。許多程式碼改動由 [Claude Code](https://claude.com/claude-code) 協助起草。

**歡迎提出 Issue、PR 與想法** —— 這正是專案成長的方式。

## 授權

[MIT](LICENSE)
