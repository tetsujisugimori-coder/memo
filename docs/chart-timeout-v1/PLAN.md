# PR456 Chart timeout 診断 v1 固定計画

2026-11-15 JST。Issue #457。製品変更ではなく診断。main開始点 08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d / tree bc6709ee93d44d8722ac653ef9cd960d99b93c03。AGENTSを確認し、変更対象・理由を本人へ提示済み。

## 固定入力と境界
対象HEAD 87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1、tree b28b20bfe6a5b21da39b2c010e0ea4be42437932。原CI checkoutはmerge-ref 28c2c8b2e1be596f02a4f5a9b790618d11ce6a22、treeは同一。SHAが同一という意味ではない。実行時git archiveで対象全体を隔離抽出、原E2E SHA-256 240e906757c2514864cf1f2150cf4dfb5423abb8ba2030673ca80c49ad3a4722を必須照合。

追加のみ: scripts/chart-timeout-v1.cjs のgenerate/analyzeOriginal/run、observerのattach/snapshot、専用単体試験、本ディレクトリ。既存E2E・製品・P2・Track A・lock・PR456ブランチは変更しない。#449/#451/#453は旧HEADの調査と終了診断で今回の原CIではない。

## 固定有限枠（独立事前レビュー完了まで実行禁止）
1. Chromium legacy
2. WebKit legacy
3. Chromium narrow（legacy前提経路を含む）
4. WebKit narrow（legacy前提経路を含む）

各枠1回、追加・補充・自動retryなし。engine当たりlegacy経路最大2回、narrow1回。旧CIは新しい枠に数えない。元chart-multi-series featureの先行操作・assertionを保存して各目的待機直後で切り、他featureは既存feature選択で非実行。narrow前提のlegacyが失敗したらnarrowは未到達。先行エラーを成功へ変換しない。

API/actionの30秒を維持。各子process壁時計180秒、stdout/stderr各合計上限16MiB（spawnSync maxBuffer）、全体最大12分。出力新規ディレクトリのみ、同じ保存先を拒否。子process期限/起動環境障害/取得不可なら残枠NOT_TESTED。製品検査失敗は原票を保存して次の事前固定枠へ進む。容量予算300MiB（依存/browser導入は別、開始時16GiB空き）。関連プロセス以外を停止しない。

## 観測と介入
DOMのinput/change/click/focusイベント（上限1000件）と、目的wait前後/timeout後のモデル・入力文字列・focus・status・total label・述語部分条件を記録。元のpredicate、引数、timeoutは不変。観測追加のawait/ブラウザイベントlistener自体がタイミングへ介入する。ON/OFF対照は今回NOT_TESTEDであり、非再現を解決としない。順序はperformance.nowの同page内順序で、OSスケジュール/永続性の証明ではない。

## 保留条件
独立review未完なら試行禁止。原CI環境はUbuntu26.04/Node22.23.4/Playwright1.62.1/WebKit2336。クラウド作業機はDebian13/Node24.22.1、同一環境ではない。ブラウザ入手・起動不能ならBLOCKEDで原記録保存し、別buildへ勝手に変更しない。実機Safari対象外。

## 受入
診断整合PASS、製品の原FAIL、証拠不足UNKNOWN、起動不能BLOCKED、未着手NOT_TESTEDを分離。欠測を根因断定に使わない。固定入力ドリフト・構文破損は機構異常で、製品故障検出ではない。原票と単体の合成例を区別する。後続通常CIで行われる全Chart suiteは今回有限枠とは別であり、診断枠に加算・転用しない。
