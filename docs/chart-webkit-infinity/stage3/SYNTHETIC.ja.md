# Step 1・2 の合成試験（中間）

対象 commit `3d1fcfd43bc1604bda0d2e1ba87625fa063c4a74` / tree `03d8c9d1ade282e5cb504426bdf692ddb13742ae`。[Ubuntu run 43006004348](https://github.com/tetsujisugimori-coder/memo/actions/runs/43006004348)、Ubuntu 26.04 image `20261101.186.1` / Node 22.23.4 / Playwright 1.62.1 / WebKit 26.5。開始時空き約93.0 GB、実行前後の tracked source status は空。GitHub 残課金枠は UNKNOWN。

Step 1 の限定チェックは **25 PASS / 0 FAIL / 0 SKIP**。ledger の正常、制御 SIGTERM、SIGKILL、外側 timeout、合成 browser kill、識別済み detached 子孫、page/context/browser close と reload、write失敗、flush timeout、連番欠落・重複・tail injection を検証した。人工 oracle で未送信 seq 4 を検出したが、実 crash の未送信末尾を同様に知ることはできない。Windows は別環境で22 PASS / Linux 固有3 SKIP。

上記 signal 試験の対象は ledger 合成子であり、**稼働中 browser を持つ実 preloader の SIGTERM・SIGKILL・外側 timeout を検証したものではない**。この差と、beforeExit `normal` と exit code の違いを埋める追加の固定合成試験を別途計画し、その結果を Step 3 開始前に独立照合する。

Step 2 は A/B/C 各3回、9/9 完了。A は共通 fixture 内 listener のみ、B は第3工程 light、C は第3工程 detailed。9回の共通 fixture の focus・input・node 再生成・値・順序は一致。B/C で対象 node の beforeinput→Infinity input→click 時 Infinity→同 node focus を取得し、C は focus-call と MutationObserver callback を取得。各指定終了境界、reload の別 document、flush callback を確認。観測された gap・衝突・drop・write error は0。ただし snapshot/batch の意図的重複を区別しており、未送信末尾は UNKNOWN。

| 群 | 所要時間の範囲 | 子孫を含む CPU 標本 | 子孫を含む RSS 標本の最大値 |
| --- | ---: | ---: | ---: |
| A | 470.5–614.4 ms | 450–580 ms | 660,475,904 bytes |
| B | 475.9–518.5 ms | 490–500 ms | 660,217,856 bytes |
| C | 508.8–547.4 ms | 510–580 ms | 659,095,552 bytes |

CPU/RSS は200 ms間隔の controller と観測できた子孫の標本で、短命 process は見逃し得る。B/C の ledger close 区間は各約2.9–3.7 ms、node・browser 全体への負荷を完全には表さない。MutationObserver の時刻は callback 観測時刻であり、DOM 変更の正確な実行時刻ではない。少数の合成試験は実 suite における影響なし・統計的同等性の証拠にならない。Step 2 判定は **PARTIAL**。

原 [synthetic artifact](https://github.com/tetsujisugimori-coder/memo/actions/runs/43006004348/artifacts/13849080679) の期限付き保管に加え、原 ZIP を `ubuntu-synthetic-43006004348.zip` に保存。SHA-256 `2945660128a3d41d1da5846428a2ef674c0d96eaa0d7f50af06ec88ad7fdc4cb`。manifest記載85ファイルの hash 一致・未列挙なし。全 entry は合成 fixture 由来の UTF-8 JSON/JSONL/log、画像・その他 binary はなし。限定 token・メール・Windows profile path の走査は検出0。独立担当も hash と限定 token 走査を確認したが、完全な機密不存在を保証するものではない。

Step 3 は、追加 lifecycle 合成試験と独立レビュー、65分の workflow 制限、十分な runner 空き容量、実 suite の全原票を安全に検査・保全できる経路の確認まで **BLOCKED**。第2工程の B を今回の同時対照として使わない。
