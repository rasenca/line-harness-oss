# ADR-0009: 認証・認可・APIキー・セッション・CORS・公開エンドポイント（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0008, ADR-0014
- source: docs/ADMIN-AUTH.md, docs/wiki/25-Staff-Management.md, docs/wiki/20-API-Reference.md, docs/wiki/Architecture.md, docs/wiki/Configuration.md, docs/wiki/22-Operations.md, SECURITY.md
- scope: 認証・認可・秘密の取り扱いのセキュリティモデル全体

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針）。**認可・秘密の取り扱いはセキュリティ境界そのものなので、正典化にあたり要所はコードで裏取りすべき**（現時点は doc-sourced・留保つき）。

## Context

管理画面・SDK/MCP・LINE Webhook・LIFF という**呼び出し元ごとに異なる信頼機構**を持つ。認証情報の露出を最小化する設計判断が複数箇所に散在するため集約する。

## Decision（記録する設計意図）

**呼び出し元ごとに 3 つの認証機構**
- API Key（`Authorization: Bearer`）= 管理画面/SDK/curl。LINE Signature（HMAC-SHA256）= `/webhook`。LIFF ID Token = `/api/liff/*`（source: Architecture.md:229-236）。
- **認証バイパスの公開エンドポイントは明示的な固定リスト**で、各々が独自の信頼機構で守られる（`/webhook`=LINE 署名、`/docs`・`/openapi.json`=公開、`/api/affiliates/click`・`/t/*`=公開トラッキング、`/api/liff/*`=ID Token、`/auth/*`=LINE Login、Stripe webhook=署名、受信 webhook=個別 secret、`/api/forms/*/submit`+フォーム定義 GET=LIFF 用公開）（source: Architecture.md:241-252, 20-API-Reference.md:17-32）。

**管理画面の認証（cookie 化）**
- **API キーを localStorage に置かず、HttpOnly セッション cookie で認証**。`POST /api/auth/login {apiKey}` → Worker が `lh_admin_session`（HttpOnly, Secure, Max-Age=7 日）を発行。JS から資格情報を読めなくする。**理由: localStorage 保存の XSS 露出を排除**（OSS issue #102 に紐づく）（source: ADMIN-AUTH.md:1-15）。
- **CSRF は状態変更リクエストのみ double-submit token**。変更系は `X-CSRF-Token` が `lh_csrf` cookie と一致しないと 403。`GET /api/auth/session` がトークンを再発行/返却しリロード後も再ログイン不要に。**クロスサイト構成では cookie を admin 側 JS が読めないため body でも配布**（source: ADMIN-AUTH.md:16-33）。
- **Bearer 呼び出し元（SDK/MCP）は cookie/CSRF/CORS の対象外**。cookie 駆動でなく `Origin` を持たないため。cookie 移行はプログラム的アクセスに影響しないよう限定した（source: ADMIN-AUTH.md:35-39）。
- **2 つのトポロジー、同一サイトが推奨**。(a) クロスサイト Pages↔Workers（既定, `ADMIN_ALLOW_CROSS_SITE=true`, cookie `SameSite=None; Secure`, CORS を `ADMIN_ORIGIN` 許可リストに限定） vs (b) 同一登録可能ドメイン下の同一サイト（推奨, `SameSite=Lax`, サードパーティ cookie 非依存）。**理由: ブラウザのサードパーティ cookie 廃止（Safari ITP）**。挙動は `ADMIN_ORIGIN`/`ADMIN_ALLOW_CROSS_SITE`/`ADMIN_COOKIE_SAMESITE` で調整。Pages のプレビュー URL は同一 admin プロジェクト扱いにしてログイン時 CORS 失敗を回避（source: ADMIN-AUTH.md:41-73）。
- **設定不整合時はログインを fail-loud** にする。クロスサイトなのに `SameSite` が `None` でない場合、`POST /api/auth/login` は cookie を無言で発行せず 500 + 実行可能なエラーを返す（source: ADMIN-AUTH.md:76-81）。
- **CORS は admin origin に限定**（cookie 認証のため）。旧 MVP の `*` 設定を置換。`credentials:true`, `X-CSRF-Token` 許可（source: Configuration.md:181-203）。

**RBAC・API キーのライフサイクル**
- **固定 3 ロール（owner/admin/staff）を API キーに紐づける**。owner=全権（staff 管理・LINE アカウント設定含む）、admin=staff 管理以外全て、staff=日常 CRM のみ。権限マトリクスで強制。拒否は 403、認証失敗は 401（source: 25-Staff-Management.md:8-49）。
- **認可解決順 + env キー後方互換**。キーを `staff_members` で検索→あればそのロール、無ければ env `API_KEY` と比較し一致なら **owner** 扱い、それ以外 401。**理由: env `API_KEY` は常に owner として機能し（レガシー維持）、`staff_members` が空でも動くので staff 管理の導入が非破壊**（source: 25-Staff-Management.md:37-54）。
- **API キーは一度だけ全体表示、以後は下 4 桁マスク、再生成で旧キー即無効**。破壊的操作ガード: 自分自身は削除不可、最後の active owner は削除不可（DB の CHECK/UNIQUE でも担保）（source: 25-Staff-Management.md:67-89,153-166）。
- **秘密の露出最小化**: `line_accounts` の channel secret/token は一覧 API で省略し詳細 API のみ返す。**API キーは絶対に `NEXT_PUBLIC_*` に置かない**（クライアントバンドルから抽出可能になるため）。公開 env は `NEXT_PUBLIC_API_URL` のみ（source: 20-API-Reference.md:281-285, Configuration.md:94, 22-Operations.md:201-206）。

**脆弱性報告ポリシー**（ADR-0003 で Rasenca 向けに整理済みだが設計思想として併記）
- private-first。security-sensitive の定義（認証/CORS バイパス、LINE secret/token、クロスアカウントデータアクセス、意図しない送信・ブロードキャスト、secret 露出、CF/D1 侵害）と public-OK の線引き（source: SECURITY.md:47-92）。

## Alternatives

- localStorage API キー保存（旧方式）→ XSS 露出のため cookie 化で却下（ADMIN-AUTH.md:1-15）。
- CORS `*`（MVP）→ cookie 認証移行で admin origin 限定に置換（Configuration.md:181-203）。

## Consequences

- 認証は「値を返す or 早期リターン」で統一され、公開エンドポイントは各自の信頼機構に依存する。SDK/MCP は Bearer のまま（ADR-0014）。
- **留保（要コード裏取り・重要）:** (1) doc 内に CORS の食い違い（Configuration.md=限定 vs 22-Operations.md:199=`*` MVP、Operations が stale）と `NEXT_PUBLIC_API_KEY` を書けと読める箇所（Getting-Started.md:226）がある → 実装で「限定・NEXT_PUBLIC_API_KEY 不使用」が正か確認（[Q-008](../open-questions.md)）。(2) 認可解決順・トポロジーガード・公開エンドポイントの各信頼機構は `apps/worker/src/middleware/` とルートで**コード裏取りしてから「現行の正」と断ずる**。
