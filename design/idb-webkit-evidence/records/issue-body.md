## 問い
条件U（正常未終端の内部transactionを実Worker停止境界まで独立に裏付ける条件）の証拠取得可否を静的に調査する。新旧ブラウザ実験0、runner/workflow追加0。資料整合性チェッカーは実行許可・安全性認定を行わない。

## 対象・固定base
PR #401はinvestigate/idb-time-delay-onlyへマージ済み。固定分岐点 a72e0657d07632926d2ace9bcd7836cfbc41ac13（親9872ee7、852c883）。reviewed_sha e08c065161ba147e7dbba175a2038ef27bf968a0、レビュー記録852c883を継承するためこのbaseを選ぶ。main統合扱い・既存PRのbase変更なし。
対象は保存済みLinux WebKit 26.5のD/E/F/G。lockのPlaywright 1.62.1と実行logのrevisionを照合し、上流ソースとの対応限界を記録する。表示版だけでは一致判定しない。

## 変更範囲
新規design/idb-webkit-evidence/内の資料、schema、明示入力だけを読む純粋CLI、局所試験。製品・旧judge・旧証拠・runnerは変更しない。実メモ/OAuth/サービス/8791/8792/Tunnel操作なし。

## 終了条件
版対応表、内部ID/終端/停止経路と候補・不足・UNKNOWN、資料整合性CLIと試験、hash・保全記録を作成し、commit/pushして同baseへのDraft PRを提出する。候補フックだけで成立としない。内部計測/独自ビルドが必要なら提案までで終了し、成功まで拡張しない。
H1〜H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、将来実験未承認、開始BLOCKED、U NOT_RUNを維持。merge/auto-merge/Draft解除/branch削除/main更新なし。

Refs #387 #389 #391 #392 #396 #400 / #388 #390 #393 #395 #397 #398 #399 #401
