# Stage U-1A 観測契約（offline-collector-v1）

Issue #404。基準は親 [contract v2](../contract.md)、PR #401統合
`a72e0657d07632926d2ace9bcd7836cfbc41ac13`。既存judgeはbyte不変更で使う。
PR #403 `b64906439094b9f2bdfcc195fe7ec50895b5d2b4` の資料整合/内部計測調査を参照するが、
未マージ成果を取り込まず、独立再レビューも今回の工程に含めない。

## 識別

既存必須identityは runId/dbName/workerId/connectionId/transactionId/iteration。
eventId/source/sourceSeqも既存契約。completeIdはtransaction_complete.eventIdへの参照、
sendIdはsendまたはcomplete_sent.eventIdへの参照であり、新しい独立IDではない。
receive専用IDはそのeventIdだけ。全イベントにcompleteId/sendIdを要求しない。
requestIdはrequest_acceptedだけで必須。epoch/nonce、架空の内部IDを一律に追加しない。
今回はreadonly公開観測の限定profileであり、ゲート/upgrade/cleanup/oracle等は未対応として拒否する。

新提案：外側schemaVersion=1、materialId、planId、runId、identities（対象tx台帳）、
streams（source別収録範囲firstSeq=1/lastSeq）、fixtureKind=SYNTHETIC。
台帳はイベント削除時に対象tx自体を見失わないため。materialId/planIdは資料ラベルで認証ではない。
同一runでmainは単一stream、workerはworkerIdごとにstreamを分離。mainの連番はtx間でも共有する。
複数main・実測adapter・内部witnessをこのv1へ自己申告で注入できない。
sourceMsは任意の有限数値、判定不使用。未対応schema/type/field/sourceは黙って捨てない。

|type|source|追加必須/親|記録可能性と欠落の影響|
|---|---|---|---|
|transaction_identified|worker|なし（新提案）|JS側ラベル付与。内部開始の証明ではない。欠落はINCOMPLETE|
|request_accepted|worker|requestId, mode=readonly, result=accepted|既存API受理。tx識別より後。欠落はR UNKNOWN|
|send|worker|eventIdが送信ID|既存要求通知。受理より後。欠落は照合不足|
|receive|main|sendId→send|既存通知受信。未受信は非発生の証明ではない|
|transaction_complete|worker|eventIdがcomplete ID|既存listener観測。内部commit時刻とは別。単独なら停止との順序UNKNOWN|
|complete_sent|worker|completeId→transaction_complete|同一identity、親より大きいsourceSeq。欠落なら停止前完了は未確定|
|complete_received|main|sendId→complete_sent|受信が同一mainでstopより前の場合のみU FAIL候補|
|transaction_abort|worker|なし|既存abort listener。R/U ABNORMAL。欠落をabort不在にしない|
|transaction_error|worker|なし|既存error listener。必ずabort済みとはしない|
|commit_observed|worker|layer=LOGICAL_IDB（新提案）|将来の内部終端結果ラベルの合成モデル。SQL commitと区別。実取得能力は未成立|
|abort_observed|worker|layer=LOGICAL_IDB（新提案）|同上。commitとの併記は矛盾。欠落時は内部終端UNKNOWN|
|stop_requested|main|なし|既存停止要求。receiveより後。実停止とは異なる|
|terminate_called|main|なし|既存呼出記録。stopより後。実停止ではない|
|terminate_returned|main|result=returned|既存戻り記録。callより後。物理解放/実停止を証明しない|
|collection_error|worker/main|なし|既存収集違反。記録全体を条件判定に採用しない|

各tx各typeは最大1件（requestId/complete IDの曖昧なfirst-matchを避ける有限profile）。
Workerの全記録はtransaction_identifiedより後、終端記録はrequest_acceptedより後であることを
両イベントが存在する場合に確認する。識別/受理自体が欠落しても架空の親は補わない。
eventIdは資料内一意、同一completeIdの複数送信と同一sendIdの複数受信も拒否。
台帳の複合identityを完全一致で照合し、txラベル単独で結ばない。

## 部分順序

入力events配列を**未整列の集合**として扱うことが、このcollectorの新しい収録形式。
#401 judgeの配列内厳密増加要件は、検証済みsourceSeqで各sourceを並べた正規形を渡して満たす。
異sourceを時刻や受信した配列位置でmerge-sortしない。正規形のsourceブロック順は意味を持たない。
配列の反転はsequence逆転ではない。参照親子や契約上の同一source順がsourceSeqと反する場合を逆転とする。
sequence衝突/範囲外は矛盾。1〜lastSeqの穴・記録なしは不足かつvalidTrace FAIL、R/U UNKNOWN。
lastSeqは自己申告の収録範囲にすぎず、未記録tailやcollector損失がない証明ではない。

検証edgeは(1)同一sourceの隣接連番（穴があっても既知の大小は保持）、
(2)完全に照合したsend→receive、(3)complete→complete_sent。
worker全体の送信順に対してmain受信順を強制する等、契約にないedgeは追加しない。
欠落・不正資料にも照合できた局所edgeを残すが、全体の条件判定には採用しない。
Worker completeとmain stopの比較は、対応complete受信とmain stopの大小からだけ行う。
停止後受信の場合はR FAIL/U UNKNOWN。commit_observedだけから停止前完了へ昇格させない。

## 分類・終了コード

資料軸：INVALID_SCHEMA=2、INCONSISTENT=1、INCOMPLETE=1、CONSISTENT=0。
JSON構造/型/ID/非対応版・余分fieldはINVALID_SCHEMA。構造内の誤参照先が存在するが型/identityが違う、
重複/逆転/終端矛盾はINCONSISTENT。参照先欠落・必要イベント/連番欠落はINCOMPLETE。
両方あればINCONSISTENTを優先して両方の理由を保存する。
構造不正・矛盾・sequence穴/未対応identity/欠落参照はvalidTrace FAIL/R,U UNKNOWN。
それ以外の不足はvalidTrace PASSでも資料INCOMPLETE/条件UNKNOWNになり得る。
#401のcompleteと停止列が有効ならR PASS/U FAIL。abort/errorは有効な異常観測としてR/U FAIL。
正常条件のR/Uを資料整合性statusや実験状態と混ぜない。

missingEvidenceはPUBLIC_CHAIN（本profileに必要）とFUTURE_WITNESS（今回実装できない）を区別する。
実停止境界、内部正常未終端区間、build/内部IDの独立対応は常にFUTURE_WITNESSとして残し、
CONSISTENTでも存在する。資料CONSISTENTは全証拠完備やU PASSの意味ではない。
実験状態conditionU=NOT_RUN、観測分類はtransactions[].assessment.conditionUで分離する。
全出力でrealExperiment NOT_RUN、executionAuthorization NOT_GRANTED、startCondition BLOCKED、
productionWorker HOLD、H1/H2/H3 UNKNOWN、H4 PARTIAL、connectionClosed/physicalRelease UNKNOWN。

## hashと信頼限界

collectEvidence(bytes,{materialId,expectedSha256})は明示したbytesだけを扱う純粋関数。
CLIは明示された1ファイルだけを読み、ネットワーク/URL/他入力を追わない。必須expected hashは
外部manifest等から渡す。raw SHA-256は改行/空白/配列順を含む全bytes。semanticSha256は
object keyとidentity/stream/event集合を正規化した内容hashで、順序不変性の照合に使う。
raw hashが一致しても真実性・真正性は証明しない。意味変更を加えてhashも更新すれば、
schema/契約に反しない変更は検出不能。独立署名/由来の監査は将来課題。
JSON重複キーは曖昧な上書きなので拒否。最大2MiB、events512、tx32、seq8192、深さ32。
CLIで読込み不能/サイズ超過の場合、全fileのactualSha256はnullとし、未読fileや切り詰めた
prefixのhashを全fileのhashと表示しない。正常に読めた不正JSONにはraw hashを残す。

## 将来計測と未解決事項

#403のID-BIND/DB-LIFECYCLE/STOP-BOUNDARY/SURVIVING-RECORDERを設計上の前提として参照する。
対象WebKit配布build・patch/configの対応、アプリidentityとprocess incarnation付き内部IDの対応、
論理IDB層の正常開始/commit intent/result/abort intent/result/異常/破棄、実停止境界の定義と
同IDの因果区間、外部recorderのdrop/overflow/process-loss/flush証跡、有限予算と計測摂動の評価が必要。
readonly論理transactionとSQL transactionを混同しない。今回のcommit/abort合成ラベルで代用しない。
公開通知/markerだけで正常未終端を証明する手段、全異常経路の網羅性、未記録tailの独立検証は未確立。
新規P1/P2は自己検証範囲で未検出という限定評価。独立レビューは未実施、実験開始不足は解消していない。
