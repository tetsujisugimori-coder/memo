# 第4工程 安全機構の局所修正（未完了）

## レビュー 5875046378 後の局所修正（2026-11-13）

総合PARTIAL、実験BLOCKED、マージNO。共通絶対期限、全失敗登録からの追記、実controllerのidentity接続を局所修正した。基準HEAD/treeは8de93c0da94903b9f998aafcc600e8810fffddd3 / c158fec5b08db25f66fb8eebc7848d6bad44dabd。Windows Node v24.20.0の合成63 PASS、同一3反例は旧モジュール3 FAIL→修正版3 PASS。既存preflush/sealは16 PASS / 2 FAILでassertion未変更。旧コードのロード失敗を不具合REDには含めない。

Linux環境不在でダミー故障注入NOT_TESTED。実controllerはガードを外して実行しておらず、配線の静的確認と共有部品の合成試験のみ。同期停止時の有界性、PID照合とsignalの競合、未捕捉/再親化子孫、非干渉、実原票の保管・転送・再読込み、永続試行台帳、原票分析器は未完了。BLOCKEDガード、workflow抑止、公開artifact無効を維持。証拠と保証範囲は[今回の検証記録](REVIEW-5875046378.ja.md)を参照。

## レビュー 5867381923 後の部分対応

- 基点 HEAD `a805dcb929ddc8b2ae48697b3b605b2d8ba33d2f`、tree `4e05e5bce1390961948471c206602524eb8270c1`。停止要求を新規 `stop-controller.cjs` にまとめ、cleanup と最終確定の再入を抑止し、失敗理由は追加保持する。同期処理が完了したことは cleanup 成功の証明ではない。実 process や証拠回収の故障注入は未実施。
- 修正前の controller ソースには直接 `cleanup()` 呼出しが8か所あり、直接呼出しを1以下とする静的反例が RED、修正後は0で GREEN。これは実行時の再入を実証した RED ではない。新規 coordinator の初回試験は新機能の合成試験であり、旧実装の RED に数えない。timeout＋遅延応答＋callback error の実コード RED→GREEN は前回の変更で記録済み。
- Windows Node 24.20.0 の合成試験は停止要求の重複、cleanup 中の同期再入・例外、スケジューラ例外、失敗後の正常 exit、および各異常名の組合せを検査。異常名の合成注入は controller の fork、stream、stat、実証拠回収の実配線故障注入ではない。後者は NOT_TESTED。同期 filesystem 操作や多数の process 走査がハングした場合の時間上限は保証されていない。
- Windows の実行コマンドは `node --test tools/chart-webkit-stage4/stop-controller-check.cjs tools/chart-webkit-stage4/stop-once-check.cjs tools/chart-webkit-stage4/review-5865455311-check.cjs tools/chart-webkit-stage4/safety-check.cjs tools/chart-webkit-stage4/regression-check.cjs tools/chart-webkit-stage4/trace-check.cjs` で43 PASS。`node --test tools/chart-webkit-stage4/preflush-check.cjs tools/chart-webkit-stage4/seal-check.cjs` は16 PASS / 2 FAIL。合成証拠は試験コードとこの記録であり、実行ログ原票は保存していない。試験コード `stop-controller-check.cjs` の SHA-256 は `2c343cddbcf3d8c4c8062b00f3111cb61700aa50ee216981f15eb7586d17aef0`（Windows での読み出し bytes）。
- Linux 専用ダミーは WebKit を使わず、単一 child を自動終了させる IPC の最小検査のみ。Linux 実行、SIGTERM/SIGKILL、PID 世代不一致、再親化、無関係 process の負対照、残存確認は NOT_TESTED。ハーネスは実 process の完全な故障注入をまだ実装していない。取得不能の stat は終了扱いせず `remaining_unknown` を記録するが、実際の終了との区別は未解決。PID の最終照合と signal 間の競合、未捕捉子孫と再親化は UNKNOWN。
- 契約移行案：preflush の旧「停止2回」assertion は独立レビュー後に停止1回へ移行し、遅延応答・重複 callback・停止中再入・失敗理由保持を負対照とする。seal の旧 `ok:true` は `integrity` と `screen` 等の個別検査へ移行し、hash 一致かつ screen FAIL / publicUpload DENY と、screen PASS でも DENY を負対照とする。汎用 `ok` を復活させない。旧呼出元は戻り値の契約更新が必要で、旧 assertion 2件は未変更・FAIL のまま。非公開と永続保管は BLOCKED。
- 原票分析器、欠測評価、readback hash、実原票の非公開転送・永続保管、試行台帳は未成立。進行ゲートと controller 無条件 BLOCKED、実験 workflow と公開 artifact の無効化は維持。実 WebKit A/B、全 Chart suite、Actions は実行しない。マージ NO。

## レビュー 5866973537 後の局所修正

- preflush の停止要求は一回のみとし、timeout 後の遅延応答、送信 callback の失敗・重複など、後から発生した失敗理由もラッチに残す。停止中の同期再入でも再度 stop を呼ばない。修正前の実装では timeout、遅延応答、送信エラーで stop が3回呼ばれた（RED）。修正後の同じ組合せは1回（GREEN）。この検査は実 supervisor の cleanup 一回性を証明しない。
- procedure PASS と実験の進行許可を分離。実際の証拠回収・原票保存・耐久保管・未捕捉子孫が UNKNOWN の現在、進行ゲートは BLOCKED。controller 冒頭の無条件 BLOCKED と workflow の無効化は維持。callback や preflush を fsync の証拠としない。
- 既存 `preflush-check.cjs` の1件は旧挙動の停止2回を要求し FAIL。安全要件上は停止1回に契約を移行すべきだが、既存 assertion は変更せず残した。`seal-check.cjs` の旧 `ok:true` 要求も1件 FAIL。移行先は `integrity`、`screen`、`publicUpload`、`privateStorage`、`durableStorage` の個別判定であり、汎用 `ok` の復活は公開許可と混同するため採用しない。限定走査 PASS でも公開 DENY。
- P1 supervisor の fork・IPC・stream・容量・証拠回収の全経路、実 cleanup 一回性と有界性は未完成。Linux ダミー故障注入は NOT_TESTED。`stat` は読取失敗と終了を区別できず、識別不能・未捕捉・再親化や PID 照合と signal 間の競合は UNKNOWN。識別不能対象を推測して signal しない。実験、原票転送、非公開／永続保管は BLOCKED、マージ NO。

## レビュー 5865455311 後の部分対応（2026-11-12）

対象 HEAD は `1657bb481184d29e52f5bb41addaed0a0888b3ef`。第1段階は **BLOCKED**。実験可否の判断ではない。

- controller の child error、stream、IPC callback、ログ失敗などを部分的にラッチへ接続。ログ失敗時の cleanup 再帰を抑止する。ただしガード下の実配線としての試験は未実施。fork 同期例外、容量不足、証拠回収、全例外と有界停止の接続・実証は未完成。
- PID と開始時刻を signal 直前に再照合する既存方針を維持。`stat` は読み取れない場合と終了を区別できず、tree 捕捉と signal の間に終了・PID 再利用が起こり得る。捕捉前に再親化した子孫も UNKNOWN。無関係 process に作用しないことを Linux 実機で立証していない。
- preflush は応答と送信 callback の両方を待つ。期限、重複、送信エラーはラッチする。応答後のエラー反例は旧実装で proceed が先行して RED、修正後 GREEN。preflush と callback は原票保存・fsync の証拠ではない。
- manifest の戻り値から汎用 `ok` を除き、`integrity`、`screen`、`publicUpload`、`privateStorage`、`durableStorage` を分離。限定走査 PASS でも公開 DENY。機密ダミーの hash 一致時に integrity PASS / screen FAIL / publicUpload DENY を確認。旧 API の曖昧な `ok` 契約を要求する既存 `seal-check.cjs` の assertion は変更禁止のため残しており、該当1件は FAIL（`undefined !== true`）。この互換性問題は未解決であり全試験 PASS とはしない。
- Windows Node v24.20.0：`node --test tools/chart-webkit-stage4/review-5865455311-check.cjs tools/chart-webkit-stage4/preflush-check.cjs tools/chart-webkit-stage4/safety-check.cjs tools/chart-webkit-stage4/regression-check.cjs tools/chart-webkit-stage4/trace-check.cjs` は合成37 PASS。`node --test tools/chart-webkit-stage4/seal-check.cjs` は8 PASS / 1 FAIL。試験は実WebKitや実process supervisorの安全性の証明ではない。
- Linux：WSL ディストリビューション未導入。ダミーprocess故障注入は NOT_TESTED、専用ハーネスも未完成。Actions 権限設定は有効だが、予算・安全なダミー専用実行経路は未確認でジョブを起動しない。実 WebKit A/B NOT_TESTED。guard、experiment job の無効条件、公開artifact無効は維持。

## 独立再レビュー 5863893673 後の部分対応（2026-11-12）

- P2-01 PARTIAL：B の preflush 要求と応答を分離した状態機械経由で既存 safety に接続。ID 不一致、重複、送信失敗、欠測と期限超過を失敗にする。5秒の timer に加え、応答時に単調時計の期限を照合する。これは実 process の停止や Infinity 保存の証明ではない。
- RED→GREEN：期限切れ後、timer callback が遅れた状態で応答を受ける合成反例は修正前 `UNKNOWN`（期待 `FAIL`）で失敗、修正後 PASS。初回のモジュール未作成による RED は旧挙動の証拠に数えない。
- P1-01/P1-02 BLOCKED：child error、ログ、stream、capture、stat、cleanup 等の全異常経路の安全な接続と実停止は未完成。状態機械単体の PASS を supervisor 全体の PASS としない。識別不能・再親化子孫の扱いも未実証。
- P2-02 BLOCKED：manifest 整合性と公開許可の契約は未修正。実原票分析器と永続試行台帳も未実装。合成 AES-GCM は実隔離や保管の証拠ではない。
- Windows Node v24.20.0 で非ブラウザ合成試験。Linux は WSL ディストリビューション未導入で故障注入 NOT_TESTED。実 WebKit A/B NOT_TESTED、experiment workflow 無効、controller hard guard 維持。保管・転送 BLOCKED、マージ NO。

対象レビュー #454 review `5860591208`、基点 `fcd2e0a3a5aecc5a315b04270c2811a02d092c79`。A/B 実 WebKit は **NOT_TESTED**、workflow は無効、controller は起動直後に無条件 BLOCKED。解除は別の判断が必要。

## 修正前反例と現在

- P1-01：旧 controller の成功条件は timeout・cleanup によって stage が変わらない場合に成功となり得た。状態ラッチの合成実装は失敗後の child exit で失敗を解除しない。controller に latch を部分接続し、未検証の supervisor が起動しない hard guard を追加。ただし supervisor の例外・stop 全経路への接続は未完了であり、この変更だけで実 process の fail-closed 停止を証明しない。
- P1-02：旧 controller の log・IPC・子孫取得の例外経路は不完全。合成状態モデルで timeout、SIGKILL、cleanup、identity、IPC、容量、ログ、起動、早期終了、capture/stat、証拠失敗をラッチするが、実際の process supervisor の故障注入試験ではない。Linux 実検証は環境不在で BLOCKED。識別不能・再親化前に未捕捉の子孫は UNKNOWN。
- P1-03：旧 seal は検査失敗の原票を保全する非公開経路がなく、壊れた JSON も受理した。修正後の検査は原本を編集せず、破損・非 UTF-8・未知形式・size・symlink・制限パターンを拒否する。manifest 照合とダミー bytes の AES-GCM 往復および改竄検出を合成した。これはメモリ内の模擬であり、アクセス制御、実転送、鍵管理、Windows 保管、永続性を実装・実証していない。公開 artifact upload も無効。
- P2-01：抽象判定で signal、入力、flush、evaluate、callback、boundary、seq、exit、hash を個別に扱い、未観測を UNKNOWN にする。実原票を自動照合する分析器は未実装。callback は fsync でない。B の成功応答は Infinity の保存証拠でない。
- P2-02：`run_attempt` は異なる run 間の排他を保証しない。下記の台帳設計は提案であり未実装。P2-03 の screen は限定走査であり、秘密の不存在を保証しない。

## RED → GREEN と範囲

旧 controller の危険な成功式と、壊れた JSON を受理する seal を検出する2チェックは変更前 FAIL、変更後 PASS。追加モデルの初回 RED は module 未作成によるもので、旧挙動の実証ではない。Windows Node 24 の合成 39 PASS：抽象状態と単調 latch、識別子比較、IPC 応答検証、書込み callback、dummy 機密・不正形式・hash・manifest・容量超過、模擬暗号化往復、controller 起動拒否。これは Linux process cleanup、実 WebKit、実際の保存先の受入ではない。既存 assertion は変更していない。

## 試行枠の提案（未実装）

保護された非公開の永続ストアで、実験ID・A/B各枠・固定HEAD・承認ID・状態・世代番号を記録する。独立権限の承認後、atomic compare-and-swap で `UNUSED → RESERVED` を1件だけ確定し、その成功者のみ起動する。予約は child 起動前に耐久性を確認して消費済みとし、crash・timeout・未確定時に自動で枠を戻さない。並行 run と再実行はいずれも同一の枠を参照し、CAS 敗者は停止する。変更履歴、実行ID、結果・原票ハッシュと承認を監査し、手動リセット・追加試行は新しい有限計画と独立判断を要する。ストアの暗号化、ACL、耐久性・CAS・停止時の検証が成立するまでは実装しない。GitHub concurrency や `run_attempt` 単独では台帳にならない。

## 未成立の保管・受入

承認済み候補の Windows path は GitHub runner からの到達・転送・暗号化・鍵管理・保管 ACL・再読込み・耐久性が未確認で、永続保管は BLOCKED。Windows path の存在自体も未確認。機密原票を public repo、Actions artifact、ログへ平文公開しない。実保管先へ dummy を含む書込みは行っていない。

実行再開には supervisor の安全な停止を完成し Linux で故障注入、暗号化した非公開隔離から受信先 SHA 照合まで検証、永続保管と限定公開を区別、回収分析器と試行台帳を実装、別観点の独立レビューを受けた後、さらに独立した実験開始判断が必要。元 Chart・H1〜H6・PR #448 の因果 UNKNOWN。観測同期書込みによるタイミング変化も残る。マージ NO。
