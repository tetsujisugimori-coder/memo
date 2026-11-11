# Chart WebKit 第3工程 最終報告

## A. 総合判定: PARTIAL

終了時回収と詳細 C の合成検証を実施。稼働中 browser を持つ preloader の controlled SIGTERM で終了境界を取得できず、Step 1 の回収受入条件は未達。Step 3 は **BLOCKED**、全 Chart suite は **NOT_TESTED（0/最大4）**。これは原 Chart 失敗の再現ではない。

## B. Step 1

第2工程の120 document 中10件は、旧 recorder が `context.close`／`browser.close` を回収していないことが有力候補。原票に全終了経路はなく確定ではない。

新 recorder は process・page・document・event seq を識別し、page close／reload／context close／browser close を有界 checkpoint で観測する。受信最大 seq、write callback 完了、最終観測、未確認末尾を区別。queue の非破壊 snapshot と batch の重複は ID・内容で分類。write失敗、flush timeout、missing request/result、重複、衝突を成功扱いしない。callback は fsync・永続化を意味しない。初期 hook と native close に取消保証はなく外側 timeout が必要。

Ubuntu の合成 checks [43006004348](https://github.com/tetsujisugimori-coder/memo/actions/runs/43006004348) は **25 PASS / 0 FAIL / 0 SKIP**。正常／制御 SIGTERM／SIGKILL／外側 timeout、browser kill、識別済み detached 子孫、人工欠落・write失敗・flush失敗を検証。ただし当初の signal 試験は ledger 合成子で、稼働中 browser の実 preloader 全経路ではない。

追加の実 preloader＋合成 WebKit 試験 [43007579380](https://github.com/tetsujisugimori-coder/memo/actions/runs/43007579380) は **4 PASS / 1 FAIL**。SIGTERM 時、capture が error となり Infinity が未保存なのに pages.ok=true と報告していた。結果伝播と例外保持を局所修正した。Windows の修正関連合成テストは20 PASS。SIGKILL や外側 timeout の未送信末尾、捕捉前に再親化した子孫は UNKNOWN。

同じ controlled SIGTERM だけを計画した1回で再確認した [43008647620](https://github.com/tetsujisugimori-coder/memo/actions/runs/43008647620) も **0 PASS / 1 FAIL**。`pages.ok=false` と `page.evaluate: Target page, context or browser has been closed` を正しく記録し誤成功は解消したが、終了境界と Infinity は未保存。親から見た入力後の signal・子の exit143 と、最後に保存された140までの batch は原票にある。どの component が browser を先に閉じたか、及び未保存 event 数は UNKNOWN。成功するまで繰り返していない。

## C. Step 2

修正前の recorder commit `3d1fcfd43bc1604bda0d2e1ba87625fa063c4a74` で、共通合成 fixture の A/B/C を各3回、計9回実行。共通 fixture の値・focus・node 再生成・event 順は一致し、B/C の期待境界、C の focus call と mutation callback を観測。観測済み gap・衝突・drop・write error は0。

| 群 | 所要時間 | CPU 標本 | RSS 標本の最大 |
| --- | ---: | ---: | ---: |
| A | 470.5–614.4 ms | 450–580 ms | 660,475,904 bytes |
| B | 475.9–518.5 ms | 490–500 ms | 660,217,856 bytes |
| C | 508.8–547.4 ms | 510–580 ms | 659,095,552 bytes |

200 ms間隔の controller と観測できた子孫の標本で、短命 process は UNKNOWN。B は第3工程 light、A にも全群共通の fixture event listener がある。C は focus wrapper、MutationObserver、wait 監視、非同期退避と終了待機を追加し、時系列への影響を排除できない。MutationObserver の時刻は callback 観測時刻。少数回で統計的同等性を主張しない。診断器の誤分類修正後に9回は繰り返しておらず、更新後 C の影響は未再評価。Step 2 は **PARTIAL**。

## D–F. Step 3・再現・仮説

Step 1 の回収受入条件が不成立のため、指定の旧 main／PR #448 × A/C 全 suite は **BLOCKED / 0回**。前工程の全 suite 4/4成功は別時点の参考資料で、今回の A 対照ではない。元の Chart Infinity 失敗は今回再現していない。H1〜H6 の因果評価はいずれも UNKNOWN。合成 SIGTERM failure を Chart 不具合や PR #448 の原因としない。

## G. 欠落と異常終了

正常 close／reload と合成の browser kill・process kill・timeout は区別して記録。送信済み、callback完了、永続化を混同しない。SIGKILL では exit.json がなく、未送信末尾は UNKNOWN。実 lifecycle の SIGTERM では最後の Infinity が未保存であり、欠測を0としない。Linux の識別済み子孫残存は観測上0、捕捉前に再親化した子孫は UNKNOWN。Windows の強制終了は Linux の signal と同義ではない。

## H. CI・試験

- [合成 gate 43006004348](https://github.com/tetsujisugimori-coder/memo/actions/runs/43006004348): checks 25 PASS、合成比較9回、workflow SUCCESS（対象は修正前 recorder）。
- [lifecycle 43007579380](https://github.com/tetsujisugimori-coder/memo/actions/runs/43007579380): 4 PASS / 1 FAIL。
- [SIGTERM 再確認 43008647620](https://github.com/tetsujisugimori-coder/memo/actions/runs/43008647620): 0 PASS / 1 FAIL、指定1件のみ。失敗を維持。
- 局所修正後 Windows 合成 checks 20 PASS。別の Windows 合成 checks は22 PASS / Linux 固有3 SKIP。Windows を Ubuntu と同一視しない。
- 後続 Draft は PR #450 branch が base。main 向け通常 CI や Step 3 suite は最終 HEAD で NOT_TESTED。ゲートのみの SUCCESS を実験実施と扱わない。

## I. 原票・保管・機密

Ubuntu 合成 artifact を保存し GitHub digest と manifest を独立照合：`ubuntu-synthetic-43006004348.zip` SHA-256 `2945660128a3d41d1da5846428a2ef674c0d96eaa0d7f50af06ec88ad7fdc4cb`、85 files。一回目 failure `ubuntu-lifecycle-failure-43007579380.zip` SHA-256 `d31daa05ae72ccdc35d31efa82f483357fe5b84dafe36639b80c5d29647951eb`、16 files。再確認 `ubuntu-sigterm-recheck-43008647620.zip` SHA-256 `5f3f3f09f6b6963f77e29a98883760931222edc55f3249aebeaac740ccaa3f23`、6 files。いずれも合成 text JSON/JSONL/log のみ、全 hash 一致、限定 token・メール・Windows 個人 profile path 走査で検出なし。lifecycle 原票には GitHub runner の `/home/runner/...` が含まれる。完全な機密不存在を保証しない。

Windows の source-linked 原票は profile 絶対パスを含むため公開せず workspace 内 `work/chart-stage3-step1-windows-451-final/` と、後続 checkout 内の未追跡 `docs/chart-webkit-infinity/stage3/windows-step1-source-linked.zip` に隔離し、派生 manifest のみ提出。旧 Windows ZIP は限定走査済みだが実行時 source の厳密な同一性 UNKNOWN。旧研究原票は変更・削除していない。

## J–N. 独立レビュー・原因・次工程

[独立レビュー](INDEPENDENT.ja.md) は PARTIAL / Step 3 BLOCKED / マージ NO。元 Chart 失敗の根本原因 UNKNOWN。追加実装は診断器と合成 fixture のみで、製品・保存処理・既存 Chart テスト、CAS、IndexedDB、tombstone、原稿保全、280ms、MCP/OAuth、研究 HOLD は変更していない。保存ガイドは Issue #447 として別扱い。

次工程では SIGTERM 競合の発生源を限定観測し、controller が事前 flush を指示する方式などを、終了順序を変更する介入として別の有限計画で評価する。突然の SIGKILL の完全回収は保証しない。詳細 C の更新後再評価と、安全な全 suite 保管先・65分予算確認が済むまで実 suite を開始しない。

[後続 Issue #451](https://github.com/tetsujisugimori-coder/memo/issues/451) / [Draft PR #452](https://github.com/tetsujisugimori-coder/memo/pull/452) / [親 Issue #449](https://github.com/tetsujisugimori-coder/memo/issues/449) / [親 Draft PR #450](https://github.com/tetsujisugimori-coder/memo/pull/450)。最終 HEAD とその CI は提出コメントで別途明記する。
