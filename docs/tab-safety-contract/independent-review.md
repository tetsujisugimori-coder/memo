# 独立レビュー

担当: 実装担当とは別のCodex子エージェント `/root/tab_contract_review`。
固定コードHEAD: `58e3cb8e09a5c0e8d24071f173054209de72b6b6`。
base: `4651a506245f19086e34125cc1eed00512eb71ab`。
日時: 2026-11-07 00:07 JST。

## 最終判定

- テスト契約改善: PASS
- 現行製品の複数タブ保存安全性: FAIL
- CI: このレビュー時点はNOT_TESTED。最終HEADの実行結果をPR/Issueへ追補する。
- マージ推奨: NO、Draft維持
- 今回の変更に未解決P1/P2/P3なし。既存製品P2 #429は未解消。

方式A/Bの合成正常例、警告だけ・偽保存済み・回復不能・観測欠落・実行失敗の拒否を確認。初回レビューのP2二件（回復操作後の偽saved、FAIL/NOT_TESTED reportの製品偽PASS）と有限待機P3は、回帰試験を含め解消を確認した。

## 独立実行

| 試験 | 結果 |
|---|---|
| 純粋判定・観測単体 | 40/40 PASS |
| 既存ガイド試験 | 初回20/20 PASS |
| 負対照 | 2/2検出 PASS |
| Chromium複数タブ | 10条件完走、5/6/7/8 FAIL |
| WebKit複数タブ | 10条件完走、5/7/8 FAIL |

両ブラウザとも再読込・全タブ終了後の再開でA編集が回復せず、B編集だけが残った。Chromiumは終了候補観測時にDBと画面の不整合も確認。JavaScript例外・console・HTTP失敗・requestfailedはすべて0。実製品REDと合成PASSは分離されている。

製品保存・研究領域・既存20条件・負対照・workflowの非変更、10条件維持、Node側明示await・raw DB読取り・有限deadline、終了候補と安全PASSの分離を確認。旧HEADのtimeoutや同HEADの実装担当初回アンカーFAILは、今回の独立成功結果と区別して保存する。

## 証拠照合

元の独立実行先: `%TEMP%/memo-tab-contract/independent-58e3cb8`。
複製先: `evidence/independent-windows`。以下は元JSONのSHA256であり、改行変換前のバイトを対象とする。

| JSON | SHA256 |
|---|---|
| results.json | e3a1b7a261d269d6c36096ff69f7b9805713e0c99f75c443ab420c8a5acd7b6d |
| negative-controls/results.json | de65c800d654335663b5700edebed71212c05e7428414716daa4e6b040704035 |
| multiple-tabs/results.json | 8a745ba8c8bd26e800afca27e6abfdc0dfb0294ebd9c061983571bc1bd70f865 |

manifest.jsonの`sha256`/`bytes`は元working-copyのバイト、`repositoryLfSha256`はGitがテキストをLFへ正規化した後のバイト。画像は双方同一。Windows checkoutによるCRLF変換を内容変更と混同しないため区別する。

この文書は子エージェントの最終報告を実装担当が転記したもの。GitHubでの自己approveではない。
