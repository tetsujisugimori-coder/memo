# 未完了transaction停止：静的設計 IDS-STATIC-20261102-v1

2026-11-02 JST。**静的成果物：PASS（レビュー可能）、実ブラウザ成立見込み：PARTIAL／停止時の内部未完了はUNKNOWN。本番Worker HOLD、マージ推奨NO。** 新規ブラウザ実験0、旧実験再実行0、製品変更0。今回の完了は実行許可ではない。

設計上の推奨候補は、**readonly要求を有限個追加したsuccess callback内の有限同期ゲート**。これは人工的なcallback保持条件を検討する案で、元T7と同一ではない。通常commitに至るJS側の区間を狭める候補として選ぶが、「mainの停止時点でバックエンドtransactionが未完了」を公開APIだけで保証できる方式としては採用しない。実行可否はBLOCKED_PENDING_REVIEW。欠けている実装版対応・内部abort/終了境界の観測契約が解消されない限り、未完了停止実験の成立PASSを出せない。

成果物：

- [根拠と参照版](sources.md)：D/E/F/G、PR本文・レビュー、仕様、WebKit参考実装の区別。
- [候補比較](candidates.md)：自然区間、有限要求、非同期通知、同期共有ゲートの競合と制約。
- [観測・判定契約](contract.md)：観測時／停止時／内部処理／通知配送を別判定。
- [将来の有限計画案](finite-plan.md)：独立計画、実行許可なし、上限と中止条件。
- [レビュー項目](review.md)、[検証記録](validation.md)。
- `judge.cjs` / `judge.test.cjs`：純粋な疑似イベント判定のみ。ブラウザ・Worker・IndexedDB・Atomicsを起動しない。実行コマンドは `node --test design/idb-incomplete-stop/judge.test.cjs`。
- `records/inspection.json` とgzip記録：確認時点のGitHub記録と旧証拠hash検査。旧証拠は上書きしない。

管理Issue: [#400](https://github.com/tetsujisugimori-coder/memo/issues/400)。設計Draft PR: [#401](https://github.com/tetsujisugimori-coder/memo/pull/401)。親研究: [#396](https://github.com/tetsujisugimori-coder/memo/issues/396)。今回は静的設計だけを提出する。

## 成果の範囲

要求成功とtransaction完了は別。要求を追加できるactive状態と、未完了（inactive/committingを含み得る）も別。Worker送信からmain停止までに状態が変わる。共有メモリのゲートはアプリケーションのcallback退出を追跡できても、ブラウザ内部状態との原子的連動を提供しない。JS配送を止めたことを内部処理停止の証明にしない。

判定は `workerObservation`、`callbackHold`、`stopCondition`、`upgrade`、`cleanup`、`connectionClosed`、`physicalRelease` を分離する。疑似的な信頼済み境界証拠を与えたモデルでstopCondition PASS／upgrade FAILを同時表現できるが、実測値としては使用できない。公開イベントだけの通常入力でstopConditionをPASSに昇格しない。

## ブランチとbase

main確認HEAD `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba` / tree `9109b893ce208155c2d7a12e1ab55ecc810ab06d`。設計ブランチ `design/idb-incomplete-stop` は固定G証拠HEAD `9872ee7aee773b017915364669bc31b98cc22e83` / tree `fc77cecb5c5b51add1eb062eedc9aff49979a55c` から分岐。PR baseは#399の `investigate/idb-time-delay-only`。既存証拠を参照でき、main向け累積実験差分と大規模CIを避け、追加差分を本ディレクトリだけにするため。実行コードへの新規依存はない。系譜は#399→#398→#397→#393、研究課題はIssue #396。mainの更新・旧PR本文変更・旧Draft解除・マージ・auto-mergeなし。
