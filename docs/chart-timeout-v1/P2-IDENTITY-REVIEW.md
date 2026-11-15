# PR #458 P2 独立限定レビュー

2026-11-15 UTC。実装者とは別のレビュー担当が、未commitの3ファイル差分を確認。対象は診断器の目的待機識別のみ。GitHubへの書込み、製品変更、ブラウザ実行・導入は行っていない。

## 結論

局所修正の限定受入 PASS。blocking P1/P2 は今回の確認範囲では認めなかった。これは正式CI・保存後原artifact監査・製品原因解明の完了判定ではない。固定診断4枠 NOT_TESTED、原因 UNKNOWN、総合 PARTIAL、マージ NO を維持する。

## 実施範囲

- AGENTS.md と3ファイル差分を読取確認。固定Git blobのSHA-256 `240e906757c2514864cf1f2150cf4dfb5423abb8ba2030673ca80c49ad3a4722` を再計算。
- 単体34件、Chart utils217件を別プロセスで再実行し全件成功。これは同じ試験・監査コードの再実行であり、独立実装による完全な別検証器ではない。
- 同一反例再現スクリプトを別出力先で実行。両scenarioについて、旧版は先行待機だけでCOMPLETE、先行＋目的ではDUPLICATE_TARGET。新版は先行だけではNOT_OBTAINED、先行＋目的はCOMPLETE、timeout時はfailure終端のままCOMPLETE（観測の完備であって製品PASSではない）。
- 追加の別計算で生成文字列中の完全callを照合。legacy生成物はlegacy IDを1回だけ含み、narrow生成物はlegacy/narrowを各1回。元predicate・引数・optionsの文字列は保存されている。
- 生成前の完全call一意性検査と固定source hashにより、欠落・曖昧さは拒否される。先行待機の部分文字列を選ぶ実装ではなく、初回・最終一致を取る実装でもない。
- targetIdは意味上の目的、idはその実行の相関として別管理。真の重複、終端欠落、相関ずれ、targetId違い、snapshot欠測をINCOMPLETEへ分類するテストを確認。false条件をboolean実測として維持。
- 通常waitForFunctionを変更せず、生成した指定callだけを専用メソッドへ切替。元E2E・製品・依存lockの変更なし。
- HEAD Git blob読取りとSOURCE_HASHは維持。作業treeのCRLFを固定Git blobへ読み替えていない。

## 原記録

independent-unit.tap、independent-utils.tap、independent-reproduce.log、independent-comparison.json、independent-observations/、independent-checks.json。
`independent-checks.json`に確認時3ファイルのSHA-256を記録。旧反例・先行試験失敗資料は上書きしていない。

## 限界・残件

- 模擬pageによる非ブラウザ確認。実ブラウザ状態やChart障害を再現したものではない。
- CI・提出HEAD・GitHub読戻し・Library再取得の確認はこのレビュー後の作業。完了に読み替えない。
- 利用者指定の局所範囲外（JSONL全体の完全な敵対改ざん保証、任意source対応）へ一般化しない。
