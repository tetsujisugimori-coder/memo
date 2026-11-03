# Stage U-1 自己検証・保全記録

2026-11-02 JST。オフライン実装の自己検証PASS候補、研究を含む総合PARTIAL。
独立レビュー未実施。実WebKit計測成立、安全性、条件Uの成立を確認した報告ではない。

## 着手時状態と基準

- main `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`、root status clean。
- #399 OPEN/Draft、head `a72e0657d07632926d2ace9bcd7836cfbc41ac13`、base `investigate/idb-transaction-complete-only`。
- #401 CLOSED/merged、正式統合 `a72e0657d07632926d2ace9bcd7836cfbc41ac13`、研究base `investigate/idb-time-delay-only`。
  reviewed source `e08c065161ba147e7dbba175a2038ef27bf968a0`、レビュー記録を含むhead `852c88330c25f44b5bd9243d836262c659e60640`。
- #403 OPEN/Draft、head `b64906439094b9f2bdfcc195fe7ec50895b5d2b4`、未取り込み。修正後の独立再レビューは別工程。
- 新規Issue #404、独立branch `implement/idb-evidence-collector-u1`、worktree `work/idb-evidence-collector-u1`。
- 上記研究統合commitを固定baseにした。mainを更新せず、#403をmerge/cherry-pickしない。

GitHub connectorは利用不能応答のためCLIへ切り替えた。gh APIのmain/branch一覧、
#399/#401/#403の本文・issue comments・inline comments・formal reviews、Issue #402とコメントを
取得し、元の応答bytesを `records/*.json.gz` に保存した。PR #401の修正後正式COMMENTと
`docs/reviews/pr-401-20261102-061130-JST.md` を確認し、結合順修正後の契約を採用した。
#403のschema/CLI/41試験・補訂/feasibilityを参照し、資料チェッカーとイベントCollectorを分離した。
root AGENTS.md以外の下位AGENTS.mdは対象directory内になかった。

既存judgeは純粋なR/U分類として再利用する。既存schemaは資料版対応の形式であり、
イベント集合のschemaとして流用しない。旧IR1反例・旧固定judgeは負対照として参照だけ行う。
製品や研究runnerへの依存は追加しない。

## 検証結果

Node v24.20.0、依存installなし、明示した純粋試験だけを実行。
再現コマンドはREADME、原始実行コマンドと終了コードは `records/self-check/summary.json`。

|項目|件数/結果|実終了|
|---|---|---:|
|新規Collector試験|60成功、失敗/skip/cancelled/todo 0|0|
|#401既存試験（コード・期待値不変更）|36成功、失敗/skip/cancelled/todo 0|0|
|上記まとめて最終実行|96成功、失敗0|0|
|合成fixtureの実CLI照合|40成功、失敗0。JSONのexitCodeと実終了一致|0/1/2を期待どおり確認|
|旧固定judgeでIR1負対照|1試験の意図した失敗、4結合順FAIL/FAIL/UNKNOWN/UNKNOWN|1|
|新Collectorで同一IR1入力|4結合順すべてUNKNOWN|0（新規試験内）|
|集合順不変性|8資料×40並べ替え=320比較、raw hash以外の全出力一致|0（新規試験内）|

fixtureの作成時期待値は契約から固定した `fixtures/cases.json`。
Collectorの出力から期待値を生成していない。fixtureの便宜上の分類はnormal5、unknown9、fault26。
正常なabort/errorの資料はCONSISTENTでも観測R/U FAILであり、資料statusとは別。
40資料のstatusはCONSISTENT7、INCOMPLETE7、INCONSISTENT14、INVALID_SCHEMA12。
全入力と出力hash、宣言hash、実終了コードをcomparison.jsonに保存した。

依頼の最低18項目はcases.jsonの先頭18資料で個別にカバー。
追加はschema/重複JSON key（escape同値も含む）/余分field/異常観測/誤型参照/受信後停止の逆/
全削除、複数Worker、収録末尾欠落/範囲外/未宣言stream/台帳重複、識別・受理より前の終端、
ID/hash末尾改行・上限・CLI引数不足/読込み不能など。
任意イベント単独削除11通りと必須field削除も、新規試験内で確認する。
commit/abort合成ラベルは内部hook実装ではなく、正常未終端witnessを供給しない。

限定validatorの独立汎用JSON Schema実装との比較は未実施。入力・出力の固定schema照合に加え、
status/R/U/validTrace/安全状態を明示的にassertした。外部hashも更新された意味上有効な改変は
認証できないことを明示試験した。hash照合を真正性保証としない。

## 保全

着手時の61既存worktreeについてHEAD/status（変更・未追跡一覧）を前後比較し、一致。
既存変更・未追跡の非ignoredファイル、対象研究directoryのtrackedファイル計2,850件の
SHA-256が一致。不一致0。全ignored cacheの内容まで保存・照合したという主張ではない。
前後のraw snapshotと収集スクリプト、範囲の要約をrecordsに保存。
既存の未コミット/未追跡物をstash・破棄・上書き・今回commitへ混入していない。

固定baseの全963 blob/modeは新規worktreeで不変更。
Git clean-filter後のblob IDと元のGit SHA-256の一覧を `records/base-preservation.json` に保存し、
commit後はtree比較でも追加が専用directory内だけであることを確認する。
D/E/F/G/T7の保存証拠、既存judge/schema/試験、製品検索・認可・保存、runner/workflowを保全した。
root mainと旧研究branch/worktreeのHEADは動かしていない（remote-tracking fetchは最新化）。

`records/SHA256SUMS` は本directoryの現在成果物用。旧manifestは変更しない。
Gitに保存した新規blob bytesとの照合も行い、改行変換を専用.gitattributesで抑止する。

## 実行境界・CI・未解決事項

実ブラウザ起動、新旧WebKit実験、1ms/旧T7再実行、実Worker terminate、実IndexedDB操作、
実メモ変更、OAuth/MCP検索、8791/8792、Secure MCP Tunnel、独自build、dispatch、実験承認付与は0。
合成JSONのterminateイベントを処理しただけで実Worker操作ではない。
CIはNOT_RUN（GitHub指定HEADの実run一覧はPR提出時に再確認して記録する）。
全8既存workflowの発火条件を確認し、研究base/専用directory/[skip ci]を使う。workflow自体は不変更。

独立レビューで確認すべき点：

1. #401に対する入力集合正規化の妥当性、source単位の範囲・連番とtx別の既存judge接続。
2. ID重複・別session/tx混入・誤型参照と欠落の区別、部分edgeを残しても全体条件を昇格させないこと。
3. 独立期待値、負対照の同一入力、全出力schema/実終了コード、旧証拠保全の範囲。
4. 新提案イベントの能力限界、資料CONSISTENT・R/U分類・実験状態の分離。

自己検証範囲で新規P1/P2は未検出、独立レビュー未了。P3相当の残る範囲制約は単一session/main、
readonly合成profile・各tx各type1回、実ログadapter未実装、独立schema validator未照合、
自己申告収録末尾の完全性/資料真正性の独立検証なし。
これらを暗黙に対応済みとせず、今回の入力契約で限定/拒否する。
将来実験の不足条件はcontract.md末尾のbuild/内部ID/実停止・DB終端因果区間/損失検出/計測摂動。
Collector自己試験の成功で不足は解消されない。

H1〜H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、将来実験未承認、開始BLOCKED、条件U NOT_RUN。
独立レビュー前のマージは禁止。既存#403の修正後独立再レビューとマージ判断も別工程のまま。
