# 第4工程 安全機構の局所修正（未完了）

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
