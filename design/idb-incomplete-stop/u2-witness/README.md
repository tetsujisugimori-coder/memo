# Stage U-2：内部正常未終端の観測証拠取得設計（静的・実験0）

**Issue [#407](https://github.com/tetsujisugimori-coder/memo/issues/407)／総合PARTIAL／資料・取得可能性の設計のみ／U NOT_RUN／実行 NOT_GRANTED／開始 BLOCKED／本番Worker HOLD。マージ推奨NO、独立レビュー前。**
作成日：2026-11-03 JST。

## 目指す解決
Stage U-1で`sourceMs`と実CLIの数値検証は局所閉鎖した。次の問題は**正しいCollectorが処理できる入力を、実在の観測経路から完全性と因果性を保って取得できるか**である。
`request success`、`complete`のWorker配送、`terminate()`戻り、upgrade成功のどれからも「停止境界時点で正常未終端」を推定しない。
実際に見えるもの・その計測版・見えない区間を分離し、必要な観測手段の実装可否を**証拠が取れる前に**検討する。新しい1ms実験の繰り返しはしない。

## 既存成果を守る
- 観測契約：[#401](https://github.com/tetsujisugimori-coder/memo/pull/401) / `a72e0657d07632926d2ace9bcd7836cfbc41ac13` の `../contract.md`、`../finite-plan.md`。
- 固定WebKitの版／内部経路の静的調査：Issue [#402](https://github.com/tetsujisugimori-coder/memo/issues/402) / Draft PR [#403](https://github.com/tetsujisugimori-coder/memo/pull/403)。対象PRは未マージであり、その研究成果を事実上マージ済みとは扱わない。
- U-1オフラインCollector：Issue [#404](https://github.com/tetsujisugimori-coder/memo/issues/404) / Draft PR [#405](https://github.com/tetsujisugimori-coder/memo/pull/405)、独立実CLI確認は試験用Draft [#406](https://github.com/tetsujisugimori-coder/memo/pull/406)。数値修正の局所閉鎖は内部状態証明ではない。
- 親研究：[#396](https://github.com/tetsujisugimori-coder/memo/issues/396)。H1（接続）〜H3（終了後停滞）はUNKNOWN、H4（その他・観測不足）はPARTIALを維持。

## 文書構成
1. [観測witness契約](witness-contract.md)：何を観測したと言えるか、ID・区間・停止境界・欠測の不変条件。
2. [取得・独立性マトリクス](acquisition-matrix.md)：BUILD-ID、ID-BIND、TX-STOP、RECORDERごとの必要証拠と現在の不足、最小選択肢。
3. [反例と静的受入](negative-controls.md)：同一順序の違う並べ替え、別tx結合、記録欠落、停止後終端などの誤PASS拒否。
4. [レビュー／工程切替ゲート](review-gates.md)：静的に確認できることと、将来レビューや実験の許可とを分離。

## 対象外
このブランチは**新規Markdownだけ**。WebKit・Worker・IndexedDB・OS・実ブラウザを起動しない。collector/judge/schema/runner/workflow/旧証拠・依存lock・mainは変更しない。実装可能性をテスト成功やフック発見から証明しない。インストルメント化したビルドを作らず、メモ・OAuth/MCP・8791/8792・Tunnel・実ユーザーデータに触れない。

## 保守的な成果判定
文書上の必要条件と反例が整合した場合も結果は**設計受入候補PARTIAL／証拠取得UNKNOWN／条件U実験NOT_RUN／HOLD**。新たな実行実験の承認、実際の内部witness、配布バイナリの真正性、停止境界の一致、recorder完全性を獲得したことにはしない。

## 参照仕様
[Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/)はtransactionのactive/inactive/committing/finishedを区別し、requestのsuccessとtransaction completeを区別する。接続の通常closeは未終了transactionを待ち、closeイベントは原則異常閉鎖の観測である。これは仕様上の要請であり、特定WebKit配布バイナリがそのどの点でどう動いたかの証拠ではない。
