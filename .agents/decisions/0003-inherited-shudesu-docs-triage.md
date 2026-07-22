# ADR-0003: 本家由来ドキュメントの棚卸し方針 — 社内運用フォークとして扱う

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0001, ADR-0002
- tracks: Q-001

## Context

このフォークには、本家 `Shudesu/line-harness-oss`（さらにその上流の Shudesu Private リポ）由来のドキュメントが
そのまま継承されている。ADR-0001 では初手 PR で「現状維持＋ index.md での注記」に留め、扱いの確定を Q-001 に預けていた。
P1 として全ドキュメントを棚卸しし、Shudesu 参照の性質で 4 分類した:

| 種別 | 該当（代表） | 誤誘導リスク |
|---|---|---|
| 1. フォーク的に正しい（Shudesu=upstream は真実） | `docs/FORK_CLOUDFLARE_WORKFLOW.md`・`docs/wiki/26-Manual-Update.md`・`.github/workflows/update-from-upstream.yml` | なし |
| 2. Shudesu 内部運用（Rasenca は実行しない） | `docs/OSS-SYNC-CHARTER.md`・`docs/OSS-SANDBOX-MERGE-GATE.md` | 中 |
| 3. コミュニティ/連絡先が Shudesu に向く | `README.md`(+翻訳4)・`CONTRIBUTING.md`・`SECURITY.md`・`.github/ISSUE_TEMPLATE/config.yml` | 高 |
| 4. プロダクト/ドメイン docs（中立） | `docs/manual/`・`docs/wiki/` 大半・`docs/ad-conversion-spec.md`・`docs/ADMIN-AUTH.md` | なし |

特に Cat 3 に高リスクな誤記があった:
- `README.md` L162「OSS リポへの PR は `Shudesu/line-harness-oss`（**このリポ**）に投げてください」→ 現在このリポは `rasenca/...` なので**記述が偽**。
- `SECURITY.md`「脆弱性は `Shudesu` の GitHub プロフィールへ」→ Rasenca への報告経路が無い。
- `.github/ISSUE_TEMPLATE/config.yml` のセキュリティ/ドキュメントリンクが `Shudesu` の URL。

## Decision

**このフォークの位置づけ = 「社内運用フォーク」**（外部コントリビュートは受け付けない。upstream 追従＋ Rasenca 自社運用が目的）と確定する。これを主軸に、分類ごとに以下で扱う（**最小変更**・削除はしない）。

1. **Cat 1（フォーク的に正しい）: 変更しない。** Shudesu を upstream として参照する記述は事実として正しい。
2. **Cat 2（Shudesu 内部運用）: ヘッダに注記を追加し、内容は残す。** 各ファイル冒頭に「本家 Shudesu の内部運用ドキュメント。Rasenca フォークではこの手順を実行しない」旨を明記（情報としては保持）。対象は `docs/OSS-SYNC-CHARTER.md`・`docs/OSS-SANDBOX-MERGE-GATE.md`。`docs/CREATE_LINE_HARNESS_SANDBOX.md` は低リスクな開発ツール解説のため据え置き。
3. **Cat 3（コミュニティ/連絡先）: fork バナー追加＋誤誘導の中立化。ブランドは大改変しない。**
   - `README.md`（+翻訳 en/zh-CN/ko/es）: 冒頭に「Rasenca 社内運用フォーク」バナーを追加。偽になった PR 提出先（L162）を「本フォークは内部 PR フロー／プロダクトへの Issue・PR は upstream 本家へ」に修正。デモリンク（upstream 提供の実デモ）と `by @Shudesu`（MIT 原作者クレジット）は正当なため維持。
   - `SECURITY.md`: 「Rasenca 社内フォーク」である旨を明記し、**upstream コードの脆弱性は upstream 本家へ／本フォーク固有・Rasenca デプロイ固有の問題は `rasenca/line-harness-oss` の GitHub private vulnerability reporting へ**と経路を整理（メールアドレスは創作しない）。
   - `.github/ISSUE_TEMPLATE/config.yml`: セキュリティ/ドキュメントリンクを `rasenca/line-harness-oss` の URL に修正。
   - `CONTRIBUTING.md`: 冒頭に「本リポは Rasenca 社内運用フォーク。以下は upstream 本家メンテナ向けルール（原文）。本フォークは外部コントリビュートを受けず、変更は内部 PR フローに従う」旨のヘッダ注記を追加（本文は原文保持）。
4. **Cat 4（中立 docs）: 変更しない。**

## Alternatives

- **Rasenca 独自の公開 OSS として全面リブランド。** → 却下（現時点）。外部コントリビュート運営の意思が無く、README/CONTRIBUTING/SECURITY の全面置換は過剰。将来公開運営するなら別 ADR で判断。
- **今は決めず最小注記だけ（Q-001 継続 OPEN）。** → 却下。位置づけが決まれば Cat 3 の扱いは一意に決まるため、ここで確定した方が迷いが減る（原則 1・9）。
- **本家由来ドキュメントを削除。** → 却下。情報価値があり、削除は不可逆。注記で誤誘導を消せば足りる（削除は不変ルール上もユーザー確認が要る）。

## Consequences

- Q-001 は ANSWERED（本 ADR が反映先）。
- Cat 3/2 の該当ファイルに注記・修正を加える PR を出す（本 ADR と同じ PR）。コード・アプリ挙動への影響なし。
- 翻訳 README も同じ修正を適用（言語間で誤記を残さない）。
- 将来「公開 OSS 運営」に方針転換する場合は、本 ADR に `## Update (日付)` を追記し Cat 3 の扱いを見直す。
- `SECURITY.md` の Rasenca 側報告経路は当面 GitHub private vulnerability reporting を正とする。専用の連絡先（メール等）を設けるかは別途 open-question 化しうる。
