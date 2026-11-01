# G transaction・停止対応表

runId 16060bc8-4b98-435c-a534-f276b70ae612; DB worker-poc-d941090b-4231-4752-9a72-20b40592915f; commit b08c0f8b73ec4184478669fb4ac5907be83dbb52; tree 7ce3d9c7b33847cccad747ef3376890518b4e1b6; WebKit 26.5; 2026-11-01 23:28:25 JST

時刻は各Worker内sourceMs、#はmain受信順。停止時の知識は受信済みの情報であり物理的状態ではない。

|i|Worker / connection / tx|version|getAll ms|delay開始/終了 ms|実測delay ms|getAll→送信 ms|complete ms/seq|送信 ms/seq|送信時状態|main受信/stop seq|停止時知識|terminate呼出/戻り seq|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|1|worker-1 / worker-1/c1 / worker-1/tx1|1|6|7/8|1|2|7/#29|8/#32|complete|#33/#34|complete|#35/#36|
|2|worker-2 / worker-2/c1 / worker-2/tx1|2|5|6/7|1|2|6/#56|7/#59|complete|#60/#61|complete|#62/#63|
|3|worker-3 / worker-3/c1 / worker-3/tx1|3|5|5/6|1|1|5/#83|6/#86|complete|#87/#88|complete|#89/#90|
|4|worker-4 / worker-4/c1 / worker-4/tx1|4|5|5/6|1|1|5/#110|6/#113|complete|#114/#115|complete|#116/#117|
|5|worker-5 / worker-5/c1 / worker-5/tx1|5|4|4/6|2|2|5/#137|6/#140|complete|#141/#142|complete|#143/#144|
|6|worker-6 / worker-6/c1 / worker-6/tx1|6|4|4/5|1|1|4/#164|5/#167|complete|#168/#169|complete|#170/#171|
|7|worker-7 / worker-7/c1 / worker-7/tx1|7|5|5/6|1|1|5/#191|6/#194|complete|#195/#196|complete|#197/#198|
|8|worker-8 / worker-8/c1 / worker-8/tx1|8|4|5/6|1|2|5/#219|6/#222|complete|#223/#224|complete|#225/#226|
|9|worker-9 / worker-9/c1 / worker-9/tx1|9|4|4/5|1|1|4/#246|5/#249|complete|#250/#251|complete|#252/#253|
|10|worker-10 / worker-10/c1 / worker-10/tx1|10|4|4/5|1|1|5/#273|5/#276|complete|#277/#278|complete|#279/#280|
|11|worker-11 / worker-11/c1 / worker-11/tx1|11|4|4/5|1|1|4/#300|5/#303|complete|#304/#305|complete|#306/#307|
|12|worker-12 / worker-12/c1 / worker-12/tx1|12|4|5/6|1|2|5/#327|6/#330|complete|#331/#332|complete|#333/#334|
