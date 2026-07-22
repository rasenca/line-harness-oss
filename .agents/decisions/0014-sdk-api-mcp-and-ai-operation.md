# ADR-0014: SDK・API・MCP・AIネイティブ運用と安全委譲（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0009
- source: docs/wiki/23-Claude-Code-Integration.md, docs/wiki/24-MCP-Server.md, docs/wiki/19-SDK-Reference.md, docs/wiki/20-API-Reference.md, docs/manual/06-mcp-claude-code.md, README.md
- scope: プログラム的アクセス層（API/SDK/MCP）と AI 運用

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針）。

## Context

「AI が LINE を安全に操作する基盤」（ADR-0007）を実現する具体層が API/SDK/MCP。層構造と AI 委譲時の安全設計を記録する。

## Decision（記録する設計意図）

- **AI-first: API が主インターフェース、管理 UI は確認専用**。全ミューテーションを Claude Code/自然言語から API 経由で実行し、管理画面は状態確認に使う。**理由: 操作の再現性・バッチ処理・操作ログ**（source: 23-Claude-Code-Integration.md:8-9,283-290）。
- **層構造は MCP → SDK → Worker API の一方向**（Claude Code →stdio→ MCP →HTTP→ SDK →HTTP+APIキー→ Worker → D1/LINE）。**MCP は SDK の薄いラッパーで並行実装を持たない**（SDK がビジネスロジックアクセスの単一の源）（source: 24-MCP-Server.md:3,137-149）。
- **Bearer トークン認証、秘密は `wrangler secret put API_KEY`**。SDK config は `apiKey`+`apiUrl`+`timeout`(既定 30000ms)（source: 20-API-Reference.md:7-15, 19-SDK-Reference.md:39-45）。
- **SDK は dual-format（ESM+CJS+`.d.ts`, MIT）、全 HTTP 失敗を単一 `LineHarnessError`（message/status/endpoint）に正規化**。多段呼び出しを 1 回に畳む「ワークフローヘルパー」を意図的に提供（source: 19-SDK-Reference.md:22-23,422-423,500-523）。
- **送信系 URL は自動トラッキングリンク化（v0.4.0）**: `send_message`/`broadcast` が URL を検知しトラッキングリンク生成 + テキスト→ボタン付き Flex 変換。in-app クリックは LIFF で友だちに帰属、PC は直リダイレクト+クリック計数のみ。スキップ規則: 既存 `/t/{uuid}`・`liff.line.me`・`line.me/R/`・Worker 内部 URL（source: 24-MCP-Server.md:93-111）。
- **AI 安全委譲を「ツール設計レベル」で担保**: MCP ツールを read/write/send の 3 層に分け、**send 層は要ユーザー確認をツール仕様に組み込む**（運用ルールでなくツール設計で「事前確認なし送信禁止」を強制）。AI 委譲は「配信案生成 → 人間レビュー → 送信」の半自動フローに限定（source: docs/manual/06-mcp-claude-code.md:16-17,28,31, README.md:114）。

## Alternatives

- MCP に独自ビジネスロジックを持たせる → 採らず（SDK を単一の源とする薄いラッパーに徹する。24-MCP-Server.md:137-149）。

## Consequences

- 送信系（send_message/broadcast）のユーザー確認は Rasenca の運用でも不変ルールとして踏襲する（グローバル CLAUDE.md / ADR-0003 の Shudesu 由来ルールとも整合）。
- **留保（要コード裏取り）:** doc に本家作者環境のパス（`/Users/axpr/...`）や `github:your-org/line-harness` 等のプレースホルダが残る（23-Claude-Code-Integration.md, 19-SDK-Reference.md:17）＝ shudesu-only の残骸。Rasenca のセットアップ値としては流用しない。SDK/MCP のバージョン記載（0.2.0 等）は時点情報。
