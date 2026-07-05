# Claude Code 使用量モニター

🌐 **言語**: [🏠 Main](README.md) | [English](README-en.md) | [繁體中文](README-zh-TW.md) | [简体中文](README-zh-CN.md) | **日本語** | [한국어](README-ko.md)

---

**Claude Code をより賢く使うための、ステータスバーコーチ。** 請求ツールでも、マルチプロバイダー監視でもありません。AI を活用してトークン消費を分析し、使い方を改善する軽量 VS Code 拡張機能です。

> **これは何か**：ローカルの Claude Code 会話ログを読み取り、**トークンから算出した**使用量とコストの見積もりを表示する VS Code ステータスバーモニター。さらに、プロンプトの改善と無駄削減を提案する任意の AI アドバイザー付き。
>
> **これは何ではないか**：請求ツールではありません。表示される金額はすべて公開のトークン単価に基づく見積もりです。実際の請求は Anthropic アカウントをご確認ください。

> スクリーンショットは英語 UI のものです。全機能の詳細は[メイン README](README.md) を参照してください。

## スクリーンショット

### ステータスバー

![ステータスバー](images/v2-status-bar-en.png)

クォータ表示にカーソルを合わせると内訳が出ます：

![クォータツールチップ](images/v2-quota-en.png)

### ダッシュボード

![ダッシュボード](images/v2-dashboard-en.png)

## 主な機能

- **ステータスバー** — 本日のコスト、現在のセッションのコスト、そして Claude Code 自身の OAuth セッションから読み取る実際の 5 時間 / 週間クォータ（`5h:N% wk:N%`）。設定不要。
- **ダッシュボードタブ** — 今日 / 今月 / 全期間 に加え、**Sessions / Projects / Content / Branches**。すべて並べ替え可能。
- **積み上げコスト構成チャート**（Y 軸と参照線付き）— 各日 / 各月のコストが入力・出力・キャッシュ書き込み・キャッシュ読み取りにどれだけ使われたか一目で分かります。
- **Content タブ** — どの内容がトークンを消費しているか（あなたのプロンプト vs ツール結果 vs アシスタント出力 / 思考）を推定。
- **AI アドバイス**（任意）— 使用量サマリーと最近のプロンプトのサンプルを OpenAI 互換 API（デフォルト DeepSeek V4 Pro）に送り、具体的な書き換えを提案。キーは自分で用意、または静的デモを先にプレビュー可能。
- **マルチベンダー価格** — Opus 4.x / Sonnet 4.x / Haiku 4.5 は Anthropic 公式価格で検証済み。OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen の参考価格（ファミリー認識フォールバック付き）。`Refresh Token Pricing` で LiteLLM の最新価格を取得。
- **パーソナライズ** — 言語、タイムゾーン、小数点桁数、コンパクト数値、プロジェクトのグループ化、ダッシュボード自動更新の切り替え。

## インストール

拡張機能ビュー（`Ctrl+Shift+X`）で **`Claude Code Usage`** を検索するか：

```
ext install GrowthJack.claude-code-usage
```

Cursor / Windsurf 向けに [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage) でも公開しています。

## 設定

設定（`Ctrl+,`）を開き **`Claude Code Usage`** を検索。すべて任意です。よく使うもの：

- `language` — UI 言語（`auto` / `en` / `zh-TW` / `zh-CN` / `ja` / `ko`）。
- `timezone` — 日付表示用の IANA タイムゾーン（例 `Asia/Tokyo`）。
- `usageLimitTracking` — 実際の 5 時間 / 週間クォータ表示。
- `showCost` / `showContext` — ステータスバーのコスト表示と、コンテキストウィンドウ使用率（`/context` 風）の切り替え。
- これらのステータスバー項目は個別に非表示にできます。`usageLimitTracking` / `showCost` / `showContext` を `false` にすると、その項目だけ消えます。
- `advice.apiKey` — AI アドバイス機能の API キー（OpenAI 互換）。
- `pauseDashboardRefresh` — ダッシュボードの自動更新を一時停止（ダッシュボードのヘッダーでも切り替え可能）。

設定の全一覧は[メイン README](README.md#configuration) を参照。

## トラブルシューティング

**「No Claude Code Data」** — Claude Code がインストールされ、少なくとも一度使用されていることを確認。`dataDirectory` 設定を確認（自動検出は `~/.claude/projects` を参照）。

**クォータが `5h:--% wk:--%`** — Claude Code に一度ログインしてください。拡張機能は `~/.claude/.credentials.json` を読み取り専用で参照します。

**古い月の履歴がない** — Claude Code は `cleanupPeriodDays`（デフォルト 30 日）より古いログを削除します。保持期間を延ばすには `~/.claude/settings.json` に `{ "cleanupPeriodDays": 365 }` を設定。削除済みのログは復元できません。

**トークン数がプロバイダーのダッシュボードより少ない** — 一部のプロキシ / 動的ワークフローはエージェントごとの記録をサブディレクトリに書き込み、不完全な場合があります。実際の消費はプロバイダーの請求ページをご確認ください。ネイティブのワークフロー帰属は計画中です。

## クレジット

[`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage) からフォーク。MIT ライセンス。コミュニティの貢献は [CHANGELOG.md](CHANGELOG.md) に記載。多くのコード変更は [Claude Code](https://claude.com/claude-code) の支援で作成されました。

**Issue・PR・アイデアを歓迎します** —— それがプロジェクトの成長につながります。

## ライセンス

[MIT](LICENSE)
