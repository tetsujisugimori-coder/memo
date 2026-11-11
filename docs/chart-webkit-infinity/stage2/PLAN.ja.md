# 第2工程：試行前計画

状態: 試行前計画。事前の独立レビューと CI 上の限定検証を通過した場合のみ試行する。

対象は固定 commit `08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d` と `a581cb66cb0dc4889ff8ce3434c1edad88546431`。原 CI の merge commit `dea1b38b983643f4cdb2d6926159fddff2055877` の tree は後者と同一。順に旧 main A、PR #448 A、旧 main B、PR #448 B の各1回、計4回を初期上限とする。A は preloader や browser wrapper を使わない。B は限定イベント計測。C は実装と限定検証の対象だが、初期4試行には含めない。失敗後の追加試行には別計画が必要。

各回は独立した clean checkout で WebKit actionability smoke を別プロセスで実行後、`npm run test:e2e:chart:all` を実行する。suite は chart-block、chart-file-export の順、失敗時は後者を実行しない。先行 feature を省略しない。各 smoke は120秒、各 suite は900秒の外側 timeout、全体は4800秒、出力容量は1 GiB を停止基準とする。容量は5秒間隔の監視のため最大値を厳密には保証しない。smoke失敗、suite非成功、source差分、予算超過時は残りを開始しない。自動再試行しない。終了時は識別した Linux 子孫を開始時刻付き PID で照合し TERM/KILL する。観測前に親から切り離された子孫の有無は UNKNOWN。

原 CI は Ubuntu 26.04.1、Node 22、Playwright 1.62.1、WebKit 26.5 build 2336。手元の Windows / Node 24.20.0 は同一環境ではない。環境差や不明項目を原票に残す。異なる時計の値を根拠なく比較しない。

計測器は製品、既存テスト、rAF、保存処理、既存待機・期待値を変更しない。プロセスごとに出力先を分け、既存原票を上書きしない。B は1秒ごとの非同期退避と close/reload 境界の回収が負荷や後続 feature の開始時刻に影響し得る。C は詳細記録と定期退避を使うが close/reload 境界の追加待機は行わない。いずれも異常終了直前の未送信末尾は UNKNOWN。MutationObserver の時刻は callback の観測時刻であり変更実行時刻ではない。計測が再現性に与える影響は未確定。

開始条件: 事前独立レビューと node ID・順序・時計・timeout 捕捉の限定動作確認、Linux の detached 子孫終了テスト、clean checkout の確認。記録欠落、ハッシュ・機密情報・永続保存先、原本不変は試行後に原票を検証し、未検証ならその旨を報告する。原票は hash・限定機密走査後に CI artifact に保存し、期限付き artifact だけを永続保管とは扱わない。
