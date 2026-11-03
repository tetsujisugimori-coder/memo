# U-2 独立レビュー・次工程ゲート

**計画の実装や実験実行を承認する文書ではない。**
この工程の範囲は新規Markdownだけ。旧修正をマージせず、本研究は進められるが、実験実施権限を自動取得できるという意味ではない。

## ゲートの区別
|Gate|何を閉鎖するか|確認手段|現在|閉鎖後も許可されないこと|
|---|---|---|---|---|
|D0 文書整合|資料の区分、必要証拠、想定反例、R/U別判定が論理的に整合|独立静的レビュー、N01〜N24、既存#401/#403/#405との照合|**独立レビュー待ち／PARTIAL**|実計測、実Worker停止、マージ|
|D1 実体対応|対象WebKitの配布バイナリ/patch/configと調査対象ソースを結合できるか|固定一次資料・hash・build provenanceとnegative control|UNKNOWN|内部状態witnessを取得済みと主張|
|D2 ID/STOP|アプリidentity→native tx→実停止cutが同一ビルドで因果的に結合可能か|native計測案の設計、コード経路・IPC・再起動/ID衝突の静的検討|UNKNOWN|計測器のビルド・実験実行|
|D3 記録完全性|terminal/abnormalの網羅と停止後も独立に検証できるrecorderを作れるか|loss、flush、tail、overflow、high-water、摂動、故障モードの設計レビュー|UNKNOWN|「未記録＝未発生」によるU PASS|
|D4 計測可否決定|カスタムビルド・計測の費用/摂動が許容可能か|D1〜D3が少なくとも設計上解消した後、追加工数/代替構成を比較|NOT_REVIEWED|実WebKit・Workerを起動|
|D5 試行承認|別Issue・事前登録planIdで、最小の有限な対照とU観測を許すか|固定環境/ビルド、予算ledger、watchdog、証拠保全、異常時中止、独立承認|**NOT_GRANTED／BLOCKED**|本文だけを根拠に実行|

`D0`がPASSしても`D1〜D5`をPASSへ昇格しない。設計文書が完成したことと、内部証拠が取れたことは別。現在はD0すら独立レビュー未完了。

## 独立レビューの着眼点
- #401：Worker completeのmain受信前／後とstopの前後を、完全IDとsourceSeqでのみ分類する。RとUを合成しない。
- #403：版`2336`と上流参考ソース`343e13b…`は候補対応であり、配布バイナリの動作一致ではない。既存check.cjsの資料CONSISTENTは実内部witnessを意味しない。
- #405/#406：有限sourceMsのJSON Schema修正・実CLI局所PASSをU内部証明へ持ち込まない。`R2-out-of-scope-sentinel`の歴史的期待値を勝手に再解釈しない。
- native ID：同名/番号衝突、プロセスincarnation、別run/worker/connection、発生レイヤーを確認。ID参照が不明なら後段もUNKNOWN。
- STOP：停止要求/terminate returnと実境界を分け、DB状態の確定した「cutを跨ぐ区間」が存在する証拠がない限りU PASS経路を認めない。
- RECORDER：producerが終了した後に「来なかった」ことを信じる方式を拒否。完全性が一部でも欠ければUNKNOWN、dropの隠蔽は不合格。
- 失敗時：矛盾と欠落を別理由で保存し、序列上は矛盾優先。条件不成立FAILと観測不能UNKNOWNと資料不正を区別する。
- 計測摂動：通信、flush、lock、ログ量が状態や停止順序を変更し得る。比較不能なら結果の一般化を停止。
- 独立性：文書の引用・コード静的閲覧・実バイナリからの出力・recorder署名を証拠ランク別に明示。自分の生成したmarkerを別レイヤーで再掲しても独立証拠ではない。

## 安全な次の最小作業（実行実験0）
1. D1で必要な配布物・patch/build対応の一次資料を列挙し、**現在保有しているファイルhashと未保有のもの**を区別する。入手できない場合も「どこで途切れたか」を記録して終了する。別版で代用しない。
2. D2で単一の論理readonly transactionと単一のWorker停止候補を固定し、native ID発生→IPC結合→commit/abort→stop cutの線を、*実行しない*ソースレビューで描く。stop cutが構築不能ならそこで保留にする。
3. D3で必要な全terminal/abnormalのproducerを列挙し、drop/overflow/プロセス消滅時に検出可能な機構を一つずつ評価する。保存済みログのtailが不明ならUNKNOWN。
4. そのうえで、正式なカスタムビルド＋ネイティブ診断が不可欠か、既存診断で十分か、それでも証明不能かを比較。予算/摂動/維持負荷とアプリ側の代替設計（停止・物理解放を検索再開条件にしない、認可・検索制御経路を分離）を比較する。ただし製品設計・実装は別Issue。
5. D1〜D3が**証拠付きで**前進した場合だけ、新しい有限実験の設計レビューを起票。既存`../finite-plan.md`の2試行上限を自動転用しない。新計画の実行承認がなければ0試行。

## 設計文書の納品と保全
- 親コミットは`a72e0657d07632926d2ace9bcd7836cfbc41ac13`（#401研究統合）。#403/#405/#406は別のDraftで未マージ。新しい静的文書はこれらの未マージコードをコピーしない。
- 新規成果物は本ディレクトリのMarkdownだけ。既存生ログ/manifest/契約schema/runnerを変更しない。新しい実行フックや自動CIトリガーを追加しない。
- レビューにはdocsのdiff、リンク先固定HEAD、参照している事実の出自、独立に未検証な判断を区別して記録する。
- GitHub Actions未実行なら`CI NOT_RUN`、動的試験0なら`NOT_RUN`。静的レビューだけで本番安全性が証明されたとは扱わない。
- **マージの判断**は研究文書の限定統合のみ別途行う。現在はDraft／マージ推奨NO。#405、#406、#403は触れない。

## 終了時の固定表示
`overall=PARTIAL`、`documentDesign=INDEPENDENT_REVIEW_PENDING`、`buildBinding=PARTIAL`（metaのみ）、`nativeIdentity=UNKNOWN`、`realStopCut=UNKNOWN`、`recorderCompleteness=UNKNOWN`、`hypotheses={H1:UNKNOWN,H2:UNKNOWN,H3:UNKNOWN,H4:PARTIAL}`、`conditionU=NOT_RUN`、`realExperiment=NOT_RUN`、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`。
