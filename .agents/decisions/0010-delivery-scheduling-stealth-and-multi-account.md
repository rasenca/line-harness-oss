# ADR-0010: メッセージ配信・スケジューリング・ステルス/BAN対策・マルチアカウント（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0011
- source: docs/wiki/Broadcasts.md, docs/wiki/Scenarios.md, docs/wiki/12-Reminders.md, docs/wiki/18-Multi-Account-and-BAN.md, docs/wiki/Architecture.md, docs/wiki/22-Operations.md, README.md
- scope: 配信系（ブロードキャスト/シナリオ/リマインダー）と BAN 対策・マルチアカウント

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針・出典 docs・未検証は留保）。

## Context

配信は LINE の規約・スパム検知・BAN リスクと隣り合わせのため、タイミング制御と「自然な送信パターン」の作り込みが設計の中心にある。配信系 3 機能と、それを支える BAN 対策・マルチアカウント設計を集約する。

## Decision（記録する設計意図）

**スケジューリング**
- **全配信は Workers Cron 5 分間隔に統一**（`processScheduledBroadcasts`/`processStepDeliveries`/`processReminderDeliveries`）。結果として予約時刻から最大 5 分の遅延を許容。cadence `*/5 * * * *` は既定で、変えると `next_delivery_at` 精度が落ちる（source: Broadcasts.md:379-386, Scenarios.md:73-94, 12-Reminders.md:116-127, Configuration.md:167-178）。
- **例外: `delay_minutes=0` の初回ステップだけ Cron を待たず即時 push**。友だち追加直後の無反応時間を避けるため（source: Scenarios.md:60-71）。
- **時間ゲートを全廃し、配信タイミングは運用側ハンドルに寄せた（v0.13.2）**。`delay_minutes` と `scheduled_at` で完全制御（source: README.md:102）。

**ブロードキャスト**
- **対象タイプで LINE API と件数把握を使い分け**: `all`=LINE `broadcast` API（最速・最シンプルだが正確な送信数取得不可で `total_count=0`）、`tag`=`multicast` を 500 件バッチ（`MULTICAST_BATCH_SIZE=500`, LINE 上限準拠）（source: Broadcasts.md:76-111）。
- **部分失敗許容 + 再試行**: multicast バッチ失敗はスキップして次バッチ継続、全体失敗は `draft` にリセットして再試行可、`is_following=0` はタグ配信時に自動除外（source: Broadcasts.md:70-72,453-461）。
- **配信中/完了の不変性**: `sending`/`sent` は編集・削除不可（400）、`draft`/`scheduled` のみ変更可（二重送信・改ざん防止）（source: Broadcasts.md:63-72,307-323）。

**シナリオ / リマインダー**
- **シナリオは「登録時点からの経過時間」、リマインダーは「ターゲット日時からのオフセット（`offset_minutes`）」という別モデル**として実装。リマインダー判定式 `target_date + offset_minutes <= now`（source: 12-Reminders.md:5-9,82-87）。
- **リマインダー各ステップのべき等性を DB 制約で担保**（`UNIQUE(friend_reminder_id, reminder_step_id)`）（source: 12-Reminders.md:60-67）。
- **シナリオ条件分岐のフォールスルー規則**: 不一致時 `next_step_on_false` があればそこへ、null なら次順、無ければ完了（source: Scenarios.md:108-113）。

**ステルス配信（BAN 回避ポリシー）**
- LINE 規約内に留まるための意図的な 5 対策: (1) ステップ配信 `next_delivery_at` に **±5 分ジッター** + 友だち間ランダム遅延、(2) ブロードキャストを **500 件バッチ + バッチ間スタッガー遅延**（~100 件=100〜600ms、~1,000 件=約2分分散+2sジッター、1,000 件超=約5分+5sジッター）、(3) テキストのみ配信で **ゼロ幅文字（U+200B/200C/200D/FEFF）** を挿入し各バッチを微差化、(4) **自主レート制限 1,000 通/分**（LINE 上限 100,000/分に対する安全マージン, `StealthRateLimiter`）、(5) **1 デプロイ=1 アカウント**分離（source: Architecture.md:343-352, 18-Multi-Account-and-BAN.md:304-357, Broadcasts.md:99-132, Scenarios.md:128-149）。

**マルチアカウント / BAN 検知**
- **BAN 検知は 5 分 Cron で `/v2/bot/info` を叩き HTTP ステータスでリスク判定**（200=normal / 403=danger / 429=warning / 直近1h 5000通超=warning / エラー=error）。`account_health_logs` に保存、danger はコンソールエラー出力（source: 18-Multi-Account-and-BAN.md:176-238）。
- **アカウント移行は「受動的 UUID 再マッチ」設計**。BAN 検出時 `account_migrations` に起票するが、実際の移行はユーザーが新アカウントを友だち追加した時に `users.id` で自動マッチされる方式（能動的な送信元ローテではない）（source: 18-Multi-Account-and-BAN.md:242-300）。
- **認証情報の露出制御**: 追加アカウントは DB 格納・動的読込、メインのみ env（`wrangler secret`）。一覧 API は secret 省略・詳細 API のみ含む（source: 18-Multi-Account-and-BAN.md:47,71-78,373-381）。

## Alternatives

- Cron 間隔の変更 → `next_delivery_at` 精度低下のため 5 分固定を推奨（Configuration.md:167-178）。

## Consequences

- ステルス/BAN 対策はキャンペーン運用思想（ADR-0015）と表裏（配信速度 vs 安全のトレードオフを数値で規定）。
- **留保（要コード裏取り・重要）:**
  - `README.md` は「BAN 検知 & **自動アカウント切替**」「トラフィックプールで自動振り分け」を謳い、MCP に `manage_traffic_pools` があるが、**doc（18章）に記述される移行は「受動 UUID 再マッチ」のみで、能動的なプールローテの設計は docs に見当たらない** → 実装の有無・方式をコード確認（→ [Q-007](../open-questions.md)）。
  - danger 検出時の**自動アクション（自動移行/通知）**は doc 上ベストプラクティス止まりで自動実行の有無が不明（同 Q-007）。
  - リマインダー `offset_minutes` の符号（負=前 か）に doc 内齟齬（マイグレコメント vs 本文）→ コード確認（[Q-008](../open-questions.md)）。

## Update (2026-07-23) — Q-007 / Q-008(reminder) のコード裏取り

P7 で `apps/worker` / `packages/db` を grep 確認。

**Q-007 解消: 能動的トラフィックプールは実在する（ただし「アカウント移行」は受動 UUID 再マッチのまま。両者は別物）。**
- `traffic_pools` は `packages/db/migrations/016_traffic_pools.sql` と `packages/db/bootstrap.sql` に定義。`pool_accounts`（`019_pool_accounts.sql`）、`entry_routes.pool_id`（`038_entry_routes_pool_and_push.sql`）、既定 `main` プール自動投入（`039_default_main_pool.sql`）。CRUD は `packages/db/src/traffic-pools.ts`、MCP は `manage_traffic_pools`。
  - ⚠ 対立レビューで発見したドリフト: 統合スキーマ `packages/db/schema.sql` は `pool_accounts`（:723）が `traffic_pools(id)` を FK 参照（:725）するのに、**`CREATE TABLE ... traffic_pools` が schema.sql に無い**（migration/bootstrap にはある）。schema.sql 単体からの新規構築で問題になり得る upstream 側スキーマ欠落 → [Q-009](../open-questions.md)。フォーク安全のため本 PR では修正せず記録のみ。
- **能動振り分けの実体 = 流入（友だち追加）時のアカウント選択**。`getRandomPoolAccount`（`traffic-pools.ts:186`）は `... WHERE pa.pool_id = ? AND pa.is_active = 1 ORDER BY RANDOM() LIMIT 1` で**プール内アクティブアカウントをランダム選択**。`apps/worker/src/routes/liff.ts:433-445` が `entry_route → pool_id → getRandomPoolAccount` で友だち追加先を振り分ける。
- → README の「トラフィックプールで自動振り分け」は**実装済み（流入分散）**。一方、本 ADR 37 行目の「アカウント移行 = 受動 UUID 再マッチ」は BAN 後の**移行**の話で、こちらは受動のまま（別機構）。両立するので本文 37 行目は維持。**能動プールは「流入分散」、移行は「受動再マッチ」**と用途を分けて理解する。
- danger 検出時の自動アクション（自動移行/通知）は引き続きコード上の自動実行を確認できず（doc のベストプラクティス止まり）。この点は未解消として残す。

**Q-008(reminder) 解消: `offset_minutes` は文脈で意味が異なる（符号の doc 齟齬は「別モデルの混同」が原因）。**
- リマインダー: `reminder_steps.offset_minutes INTEGER NOT NULL`（`packages/db/schema.sql:426`）。判定式は本 ADR 28 行目どおり `target_date + offset_minutes <= now`（本文が正）＝**負値でターゲット日時より前に発火**。
- シナリオ: ステップの `offset_minutes` は登録起点からの**正の経過**（`apps/worker/src/routes/webhook.ts:262`「offset_days=0 + offset_minutes=0 → 即時」）。
- → 「負=前」はリマインダーに限った話で、シナリオ側は正の経過。doc 内齟齬は 2 モデルの取り違えによるもので、本 ADR 28 行目の分離記述（別モデル）が正。

→ [Q-007](../open-questions.md) は ANSWERED、[Q-008](../open-questions.md) の reminder 符号は解消。関連: ADR-0012（流入計測）。
