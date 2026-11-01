# F upgrade時系列

runId 61b757bd-6b5f-4fdf-aab8-574c511aea93; DB worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508; commit 6b25f7ecf1d3b290958556708fee9899f188c5f2; tree af4e504157e334bdc62d0082f614e7489b3a8435; Linux WebKit 26.5; 2026-11-01 20:45:10 JST

全12反復でversionchange/Worker close/blockedはNOT_OBSERVED。Workerの実際のclose/解放状態はUNKNOWN。timeout/errorはNOT_OBSERVED。

|i|version|request|open seq / main ms|upgradeneeded seq|upgrade tx complete seq|success seq / main ms|elapsed main ms|結果|
|---|---|---|---|---|---|---|---|---|
|1|1→2|main/r3|#37 / 64|#40|#41|#42 / 65|1|PASS|
|2|2→3|main/r4|#64 / 71|#67|#68|#69 / 72|1|PASS|
|3|3→4|main/r5|#91 / 77|#94|#95|#96 / 77|0|PASS|
|4|4→5|main/r6|#118 / 83|#121|#122|#123 / 83|0|PASS|
|5|5→6|main/r7|#145 / 88|#148|#149|#150 / 89|1|PASS|
|6|6→7|main/r8|#172 / 94|#175|#176|#177 / 94|0|PASS|
|7|7→8|main/r9|#199 / 101|#202|#203|#204 / 101|0|PASS|
|8|8→9|main/r10|#226 / 106|#229|#231|#232 / 107|1|PASS|
|9|9→10|main/r11|#254 / 112|#257|#258|#259 / 113|1|PASS|
|10|10→11|main/r12|#281 / 119|#284|#285|#286 / 119|0|PASS|
|11|11→12|main/r13|#308 / 124|#311|#312|#313 / 125|1|PASS|
|12|12→13|main/r14|#335 / 130|#338|#339|#340 / 131|1|PASS|
