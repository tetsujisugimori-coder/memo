# 第3工程：試行前計画

対象 Issue #451 / 親 #449、base PR #450 HEAD `c558cf693f3ddcbb19f59e63c744e43a816c5447`。原票を改変しない。製品、保存、既存 Chart テスト、assertion、rAF を変更しない。

Step 1 は合成プロセス・合成 browser fixture のみを使い、正常／制御SIGTERM／SIGKILL／外側timeout／browser異常／page close・reload／子孫捕捉漏れを区別する。欠落・重複・flush timeout・write失敗の人工反例を各1回、シグナル試験は各1回とする。各ケース20秒以下、全体10分、原票100 MiBを停止基準とする。WindowsはLinux信号の代替としない。末尾未確認は UNKNOWN とする。

Step 2 は同一の合成fixtureを A → B → C の順で各3回、計9回まで。A は全群共通の合成fixture内 event listener のみ、B は第3工程 recorder の light、C は同 recorder の detailed。第2工程の B とは別方式であり、異なる時点の結果を同一対照としない。各回30秒、全体10分、原票100 MiB停止基準。node・focus・値・順序の整合、所要時間、CPU・メモリ、write/flushと欠落を記録する。少数回の比較は統計的同等性を示さない。重大干渉または証拠欠落があれば Step 3 は BLOCKED。

Step 3 は Step 1/2 の受入と独立レビュー、Linux runner の空き容量と秘密情報検査・永続保管先を確認した後のみ。固定2 HEADの A→A→C→C 各1回、計4回上限、各 suite 900秒、workflow全体65分、出力1 GiB停止基準、自動再試行なし。容量は一定間隔で監視するため厳密な上限ではない。失敗時は残りを開始せず追加実験は別計画。65分予算に収まる保証はなく、超過時は timeout と未回収範囲を明記する。

原票にはランダムな実データや secret を入れず、JSON・ログ・画像・バイナリ全種の公開リスクを確認する。検査不能な原本は公開せず隔離し、期限付きartifactのみを永続保管とみなさない。保管先を確保できなければ HOLD。未確認結果は UNKNOWN、未実行は NOT_TESTED、条件未達は BLOCKED。
