# Worker停止耐性の限定診断

架空fixture専用のPoC。実アプリ、実DB、認証、外部配送、8791／8792／Tunnelは使用しない。

`node experiments/mcp-search-worker-feasibility/run.cjs` を実行する。WebKitは `WORKER_POC_BROWSER=webkit` を設定する。各実行は元のT1〜T12を1回、独立DBの対照A（transaction完了後に明示close）・B（未解決でterminate）を各1回、stage注入の検証を実施する。8秒の期限を変えず、成功するまで再試行しない。

`node --test experiments/mcp-search-worker-feasibility/cleanup.test.cjs experiments/mcp-search-worker-feasibility/evidence.test.cjs` で削除の正常・error・blocked・timeout・遅延successと過去証拠の保全を検査する。削除待機は独立した2秒で終了し、success未確認はUNKNOWNとする。primary削除待機→対照A→A削除待機→対照B→B削除待機→注入試験の順に実行する。待機追加が後続のタイミングに影響し得ることを前提にする。

結果は `e2e-artifacts/mcp-worker-diagnostics/` に実行ごとに異なる名前で排他的に作成する。JSONは実際のcheckout HEAD、Node・ブラウザ・OS、PoCソース6件のSHA-256、試験状態、時系列、削除結果、対照条件、注入結果を含む。ローカルの未コミット実行ではHEADだけでソースを特定できないため、SHA-256を併用する。CIでは実checkout HEADとartifactを参照する。

このディレクトリ直下の `results-chromium.json`／`results-webkit.json` はffe10a4版の過去Windows証拠であり、現在のソースやd2c4ad1の成功結果ではない。変更・置換しない。d2c4ad1のCI #40852560234は `evidence/d2c4ad1-ci/` と `evidence-index.json` を参照する。hash、checkout、tree、run、artifactの対応と、旧版／参照版／今回版を `test-results.md` で区別する。

時系列の `seq` はメイン側受信順、`mainMs` はメイン側時計、`workerMs` はWorker側の `performance.now()`。両者を同じ時間原点として計算しない。Workerの未観測イベントは発生しなかった証拠ではない。`db.close()`／`terminate()`の戻りは接続やOS資源の解放完了を意味せず、確認不能な値はUNKNOWNとする。messageの追加自体が実行順序・負荷を変え得る。非計測対照は未実施。
