# 候補比較

`sources.md` S1〜S5/I-WebKitを根拠とする静的評価。利用可否や停止競合の頻度を実ブラウザで試していない。

|候補|確認できる状態と時点|送信→main停止の競合|配送停止と内部処理|有限性・CPU|異常／保存／cleanup|WebKit条件|F/Gとの差・交絡|
|---|---|---|---|---|---|---|---|
|N 自然な未完了区間|request callback中の追加要求受理でAPI上activeだった瞬間を確認可能。request成功単独では不可|callbackから戻るとcomplete/abortし得る。通知受信時には状態が古くなる。防止不可、停止時UNKNOWN|pending readyStateやcomplete未受信は内部未完了の証明にならない|readonly1〜2要求、固定小データ、無追加待ち。CPU小|観測なし/遅延なら不成立として終了、証拠保存→既存cleanup1回|通常IDB/Workerのみ。配布版の通知挙動は未実測|元T7に近いが観測のため要求を追加すれば既に変更。再現率不明。自然区間を捕まえるまで反復は禁止|
|Q 有限のreadonlyバッチ|同一tx内の2要求目受理はそのAPI呼出時に要求追加可だった証拠|バックエンドが速ければ通知前に全件処理。有限件数は未完了保持を保証しない|全要求の内部読取終了とJS結果配送は別|合計2要求、32件/64KiB以内。追加チェーンなし、CPU小|要求上限超過/例外は即終了。完全データをログに出さず保存/cleanup|通常IDBのみ|要求数・読取量・キュー順が変化。T7と同一扱い不可|
|A 非同期メッセージack/Promiseゲート|Workerが一度観測してsendした履歴|awaitでevent loopへ戻るためcommitし得る。ack待ちは保護にならない|通知の往復だけではDB処理を止めない|1往復・期限付きにはできる|期限で条件不成立、追加往復せず保存/cleanup|通常postMessageのみ|協調通知と待ち時間を同時に追加。E/F/Gと異なる条件|
|S 有限同期ゲート＋Q（条件付き推奨）|成功callback内で2要求目受理後、世代付き共有状態をHELDとして通知。mainがCASでclaimし、terminate呼出前後の共有状態を読む|callback退出競合の一部は単調状態とpost-call読取で検出可能。最後のreadだけでは不十分。期限切れ/退出/不確かな中断はUNKNOWN。内部abortとの競合は防げない|JS callback保持で通常自動commitへの進行を制約する推論。DB内部readが進むことや内部abortを停止した証明ではない|Int32共有領域64B、wait1回500ms指定。busy loopなし。実復帰時間のpaddingを見込み外側監視。CPU時間の硬い上限はAPI保証なし|期限・例外時は退出前にEXPIREDを記録する設計。ただし強制中断でfinally不実行もあり得る。HELD残留だけでは証明不可。部分証拠保存後有限teardown/UNKNOWN|専用Worker、SAB/Atomics同期wait、secure context/隔離header、agent cluster確認。26.5での終了割込み/対応ビルドは未検証|COOP/COEP、共有メモリ、callback抑止、要求追加、タイマー、ログが交絡。元T7とは新人工条件|

無期限busy loop・無限要求チェーン・wait再投入・時間だけの未完了推定は不採用。原版worker.jsに既存のreading/transaction_waitの無限loopがあっても利用・修正しない。

## 推奨の意味

Sはcallbackの退出を「起きていないはず」ではなく共有状態で監査する余地があり、N/Q/Aより観測境界を説明しやすい。Qの要求受理という正の証拠を保持し、R/U両条件で同じ人工負荷を使える。ただし、**完全な未完了停止実験として採用できる候補は現時点でない**。Sを次の静的レビュー対象として1案選ぶ。対象ビルドの内部abort/commit状態と停止境界の証拠がなければ、S実装の有無にかかわらず目的の成立はUNKNOWN。

## 共有状態の監査案（非実装）

1. 新しいrun/worker/tx/epoch/nonceに専用slotを割り当て、再利用しない。PREPARED→HELD→CLAIMED→EXITED/EXPIREDのみ。ABAを許さない。
2. success callbackから2個目のreadonly要求を追加し、受理時点を記録。まだこの呼出時点の事実に限る。HELDを公開し通知を送る。
3. Workerは別のrelease wordに対して同期waitを1回だけ行う。mainのCLAIMEDへのCAS自体はwaitを解放しない。タイムアウト/復帰時はcallbackを抜ける前にEXITED/EXPIREDを公開する。claimを見て期限を延長しない。
4. mainは同一nonceのsend/receiveを結び、HELD→CLAIMEDを1回だけCAS。claim失敗なら条件不成立。主観的な経過時間だけでclaimしない。
5. main停止要求・terminate呼出・戻り・post-call共有値を同一main連番で記録。前後でCLAIMEDでも示すのはプロトコル上のcallback保持候補まで。途中で期限切れ/退出すれば失敗。強制中断で退出markerが書かれない可能性はUNKNOWN。
6. DBバックエンドはこのslotに参加していない。従ってその共有値を内部transaction未完了のackにしない。最後の共有読取と実停止の隙間も別に残る。

単に「通知→Atomics.wait」のコード形を見て未完了と決めない。通常commitの抑止に関する仕様推論、アプリケーション状態の共有順、内部処理の実測を三層に分けてレビューする。
