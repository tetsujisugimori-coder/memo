# 検証と提出範囲

以下の表は提出版 `636e279…` の著者局所自己検証記録。旧ログは不変更保存する。
提出版の独立レビューではparser P2によりチェッカー受入FAILとなった。
現在の[P2補訂・修正前後比較](p2-fix.md)は41試験成功、修正後独立再レビュー待ち、
マージ推奨NO。旧15試験成功だけでP2を検出できたとは扱わない。

|検証|結果|終了コード・範囲|
|---|---|---|
|純粋CLI契約試験|15 PASS、FAIL/skip/cancelled/todo 0|0、Node v24.20.0、`records/tests.tap`|
|実際の静的調査入力|INCOMPLETE、不足理由11件、矛盾0|1、`records/assessment-result.json`|
|整合した仮定資料|CONSISTENT、自己申告の意味は未検証、開始BLOCKEDを維持|0、試験1・15。Rラベルでも実行承認なし|
|形式不正|必須欠落、型・schema版・余分なproof・緩めたschema・不正JSON/引数を拒否|2、試験2・3・15。実プロセス終了コードとJSONも照合|
|不正・不足資料|不正参照、範囲、ID重複、hash不一致、別版/transaction、候補間矛盾、UNKNOWN、取得不能を検出|1。schema有効時は矛盾と不足を双方保持|
|WebKit source|25取得fileのsource-index記載SHA一致|全件。Git blob IDも保存。意味上の証明ではない|
|lock・パッチ対応|D/E・F・Gのlock Git blobは同一。patch353 pathと参照25 pathの直接交差0|静的比較のみ。`records/version-audit.json`|
|既存worktree保全|関連6 worktreeのHEAD/status・既存変更/未追跡100 fileのSHAがbefore/after一致|`records/preservation-*.json`。旧作業をstageしない|
|継承証拠|D/E/F/G evidence、旧design、reviews計122 fileの現在bytesをhash化|`records/inherited-evidence-sha256.json`。旧64件索引と集計範囲が異なる|
|新旧ブラウザ実験・build・依存更新|すべて0|旧runnerのimport/起動0、dispatch0|
|CI|NOT_RUN|成功扱いにしない。workflow不変更。提出branch/base/pathは既存実験発火条件外、commitは[skip ci]|

実入力の11不足は、境界UNKNOWN4、明示UNKNOWN3、内部ID未取得、異常区別不足、
停止状態UNKNOWN、版対応PARTIAL。候補hookの存在をU成立にする経路はない。

試験は小さな合成資料と一時fileだけを使用し、入力hash不変を実際に確認する。
API・実CLIの終了0/1/2を照合。取得不能sourceでも有限終了し、別資料を探索しない。
一時試験directoryはmkdtempで作った絶対pathがtemp root直下か確認してから削除する。

再計算引数を可搬化する過程で、著者のPython既定cp932読込みにより絶対path文字列が
壊れた一回はJSON_INPUT/終了2として保存（`records/reproduction-path-failure.json`）。
チェッカーはその読取不能を検出した。引数データを相対ASCII pathへ修正した後、
同じchecker sourceで実入力INCOMPLETE/終了1を確認した。失敗を成功に書き換えない。

## 差分と保全確認

新規 `design/idb-webkit-evidence/` のみ。CLI、schema、15純粋試験、報告、
明示入力・固定一次資料・GitHub現状・hash/保全記録を追加する。
既存製品、旧judge、旧実験runner/workflow、旧証拠の変更はない。
`records/base-tree.txt` は固定baseの全963 blob/mode/pathを保存したもの。
commit後にbase→HEADの全変更がこの新規directory内の追加だけであること、
全963の既存pathが同じmode/blob IDであることを確認して提出する。

関連6以外のworktreeは一覧確認のみ。ignored cache等を全byte照合したとは主張しない。
新worktreeの継承122 fileはhashを記録し、既存worktreeでは非ignoredの変更・未追跡全件を
hash比較した。Git treeによる保存履歴の保全とローカル作業状態の保全を分ける。
新manifestは自身を除く提出fileを対象とし、旧manifestを上書きしない。
新規directory内の属性でCRLF bytesを保持し、著者コード・文書はCRを行末として差分検査する。
inputs/recordsの原始空白は改変せず、当該captureだけwhitespace検査対象から除外する。

## 独立レビューを求める論点

1. metadata→上流revisionの対応範囲と、パッチ/バイナリ一致UNKNOWNの扱い。
2. IDB論理transactionとreadonly SQLite層、停止要求/実中断/cleanup境界を分けた読解。
3. 公開方式の不足、候補hookを証明手段にしない判断と、内部collector設計の残件。
4. schema・固定parser・参照/版/transaction整合と、全経路で実行未承認/BLOCKED/U NOT_RUNを維持すること。
5. 保存入力・旧証拠・base全blobの保全。自己検証を独立受入としないこと。

現在方式の不足と次の最小判断材料が具体化したため、追加実験や研究系列の拡張を行わず終了する。
本番Worker HOLD、将来実験未承認、開始BLOCKED、U NOT_RUNを維持する。
