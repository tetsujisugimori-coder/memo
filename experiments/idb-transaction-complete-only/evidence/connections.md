# F 接続ライフサイクル

{"runId":"61b757bd-6b5f-4fdf-aab8-574c511aea93","dbName":"worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508","testedCommit":"6b25f7ecf1d3b290958556708fee9899f188c5f2","tree":"af4e504157e334bdc62d0082f614e7489b3a8435","dirty":false,"browser":"26.5","node":"v22.23.4","platform":"linux","condition":"F","recordedAtJST":"2026-11-01 20:45:10 JST","ci":41303212794}

生成/最後の観測欄は当該所有者の単調時計(ms)。通常close完了と物理解放は全行UNKNOWN。最後の観測は最後の実利用の証明ではない。Workerはterminate後にログが失われ得る。

|connection|owner|iteration/version|open request|生成 seq/ms|最後の観測 seq/ms/event|close呼出/戻り|tx terminal|
|---|---|---|---|---|---|---|---|
|main/c1|main|0/1|main/r1|#2/53|#10/54/close_returned|#9/#10|main/tx1:#5, main/tx2:#8|
|main/c2|main|0/1|main/r2|#12/54|#17/56/transaction_complete|#15/#16|main/tx3:#17|
|worker-1/c1|worker-1|1/1|worker-1/r1|#21/6|#32/8/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-1/tx1:#29|
|main/c3|main|1/2|main/r3|#38/65|#44/65/close_returned|#43/#44|main/tx4:#41|
|worker-2/c1|worker-2|2/2|worker-2/r1|#48/4|#59/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-2/tx1:#56|
|main/c4|main|2/3|main/r4|#65/71|#71/72/close_returned|#70/#71|main/tx5:#68|
|worker-3/c1|worker-3|3/3|worker-3/r1|#75/4|#86/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-3/tx1:#83|
|main/c5|main|3/4|main/r5|#92/77|#98/77/close_returned|#97/#98|main/tx6:#95|
|worker-4/c1|worker-4|4/4|worker-4/r1|#102/3|#113/4/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-4/tx1:#110|
|main/c6|main|4/5|main/r6|#119/83|#125/83/close_returned|#124/#125|main/tx7:#122|
|worker-5/c1|worker-5|5/5|worker-5/r1|#129/3|#140/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-5/tx1:#137|
|main/c7|main|5/6|main/r7|#146/88|#152/89/close_returned|#151/#152|main/tx8:#149|
|worker-6/c1|worker-6|6/6|worker-6/r1|#156/4|#167/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-6/tx1:#164|
|main/c8|main|6/7|main/r8|#173/94|#179/94/close_returned|#178/#179|main/tx9:#176|
|worker-7/c1|worker-7|7/7|worker-7/r1|#183/4|#194/6/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-7/tx1:#191|
|main/c9|main|7/8|main/r9|#200/101|#206/101/close_returned|#205/#206|main/tx10:#203|
|worker-8/c1|worker-8|8/8|worker-8/r1|#210/3|#221/4/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-8/tx1:#218|
|main/c10|main|8/9|main/r10|#227/106|#234/107/close_returned|#233/#234|main/tx11:#231|
|worker-9/c1|worker-9|9/9|worker-9/r1|#238/3|#249/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-9/tx1:#246|
|main/c11|main|9/10|main/r11|#255/112|#261/113/close_returned|#260/#261|main/tx12:#258|
|worker-10/c1|worker-10|10/10|worker-10/r1|#265/4|#276/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-10/tx1:#273|
|main/c12|main|10/11|main/r12|#282/119|#288/119/close_returned|#287/#288|main/tx13:#285|
|worker-11/c1|worker-11|11/11|worker-11/r1|#292/4|#303/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-11/tx1:#300|
|main/c13|main|11/12|main/r13|#309/125|#315/125/close_returned|#314/#315|main/tx14:#312|
|worker-12/c1|worker-12|12/12|worker-12/r1|#319/4|#330/5/unresolved_send|NOT_OBSERVED/NOT_OBSERVED|worker-12/tx1:#327|
|main/c14|main|12/13|main/r14|#336/131|#342/131/close_returned|#341/#342|main/tx15:#339|
