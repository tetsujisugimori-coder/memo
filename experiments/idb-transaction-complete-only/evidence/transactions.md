# F transaction対応表

runId: 61b757bd-6b5f-4fdf-aab8-574c511aea93

DB: worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508

HEAD: 6b25f7ecf1d3b290958556708fee9899f188c5f2; tree: af4e504157e334bdc62d0082f614e7489b3a8435; WebKit 26.5; 2026-11-01 20:45:10 JST

数値はmain receipt sequence。Worker発生順は各Worker内sourceSeq (getAll=5, wait開始=6, complete=7, wait終了=8, unresolved送信=9)も検証済み。異時計間の時間差は計算しない。正常close完了/物理解放は全件UNKNOWN。

|i|Worker / logical request|connection / tx|version|getAll|wait開始|complete|complete受信|wait終了|unresolved送信|unresolved受信|stop|terminate呼出/戻り|upgrade要求|
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|1|worker-1 / request-1|worker-1/c1 / worker-1/tx1|1|#26|#28|#29|#30|#31|#32|#33|#34|#35 / #36|#37|
|2|worker-2 / request-2|worker-2/c1 / worker-2/tx1|2|#53|#55|#56|#57|#58|#59|#60|#61|#62 / #63|#64|
|3|worker-3 / request-3|worker-3/c1 / worker-3/tx1|3|#80|#82|#83|#84|#85|#86|#87|#88|#89 / #90|#91|
|4|worker-4 / request-4|worker-4/c1 / worker-4/tx1|4|#107|#109|#110|#111|#112|#113|#114|#115|#116 / #117|#118|
|5|worker-5 / request-5|worker-5/c1 / worker-5/tx1|5|#134|#136|#137|#138|#139|#140|#141|#142|#143 / #144|#145|
|6|worker-6 / request-6|worker-6/c1 / worker-6/tx1|6|#161|#163|#164|#165|#166|#167|#168|#169|#170 / #171|#172|
|7|worker-7 / request-7|worker-7/c1 / worker-7/tx1|7|#188|#190|#191|#192|#193|#194|#195|#196|#197 / #198|#199|
|8|worker-8 / request-8|worker-8/c1 / worker-8/tx1|8|#215|#217|#218|#219|#220|#221|#222|#223|#224 / #225|#226|
|9|worker-9 / request-9|worker-9/c1 / worker-9/tx1|9|#243|#245|#246|#247|#248|#249|#250|#251|#252 / #253|#254|
|10|worker-10 / request-10|worker-10/c1 / worker-10/tx1|10|#270|#272|#273|#274|#275|#276|#277|#278|#279 / #280|#281|
|11|worker-11 / request-11|worker-11/c1 / worker-11/tx1|11|#297|#299|#300|#301|#302|#303|#304|#305|#306 / #307|#308|
|12|worker-12 / request-12|worker-12/c1 / worker-12/tx1|12|#324|#326|#327|#328|#329|#330|#331|#332|#333 / #334|#335|
