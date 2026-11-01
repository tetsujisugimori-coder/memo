# D/F/G比較

各列は独立試行。原始ID/時計・全反復はD-F-G-comparison.json。Dの0msは専用getAll/unresolvedイベントではなく、元の通知payload.workerMs間の参考値。

|項目|D|F|G|
|---|---|---|---|
|実行HEAD|53445474028601131136e2bc540ee48aee83cd7a|6b25f7ecf1d3b290958556708fee9899f188c5f2|b08c0f8b73ec4184478669fb4ac5907be83dbb52|
|tree|0a9f3bf1d88c035a33ed46efbda4e79207aa378e|af4e504157e334bdc62d0082f614e7489b3a8435|7ce3d9c7b33847cccad747ef3376890518b4e1b6|
|WebKit / Node|26.5 / v22.23.4|26.5 / v22.23.4|26.5 / v22.23.4|
|runId|eec76e89-5f10-45d0-8830-8dcb3ddf2110|61b757bd-6b5f-4fdf-aab8-574c511aea93|16060bc8-4b98-435c-a534-f276b70ae612|
|DB|worker-poc-d12d5caa-4a7d-4223-81c0-0a6cd77a1f74|worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508|worker-poc-d941090b-4231-4752-9a72-20b40592915f|
|待機方式|追加待ちなし|transaction complete待ち|固定1ms、completeを条件としない|
|getAll→送信 実測ms|専用記録なし。payload参考値0,0|1,0,1,0,1,1,1,0,1,1,1,1|2,2,1,1,2,1,1,2,1,1,1,2|
|待機開始→終了 実測ms|NOT_APPLICABLE|1,0,1,0,1,1,1,0,1,0,1,0|1,1,1,1,2,1,1,1,1,1,1,1|
|Worker complete観測数|0|12|12|
|送信時終端|UNKNOWN,UNKNOWN|complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete|complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete|
|停止時の受信済み知識|UNKNOWN,UNKNOWN|complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete|complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete,complete|
|terminate呼出/戻り観測数|2/2|12/12|12/12|
|upgrade成功数|1|12|12|
|upgrade timeout|i2|NOT_OBSERVED|NOT_OBSERVED|
|blocked|0|0|0|
|versionchange|0|0|0|
|cleanup|UNKNOWN (2001ms)|PASS (1ms)|PASS (0ms)|
|Worker close記録数|0|0|0|
|正常接続閉鎖/物理解放|UNKNOWN / UNKNOWN|UNKNOWN / UNKNOWN|UNKNOWN / UNKNOWN|

Dは専用送信時計なし。Fは完了待ちログ/error監視、Gは固定タイマーログ/終端snapshot/error監視を追加。Gは異常検知時に安全停止するmainガードも持つ。全条件とも正常経路のsuiteは同じ。計測/待ち/環境差があり因果の完全統制比較ではない。
