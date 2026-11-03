# P1 第2段階：JSC実停止cutの負の対照（事前期待値・実験0）

親契約：#410固定HEAD `5ea6f42db5ff122259261a5f0f3d25f6d63ba990` / blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。参照：[JSC静的経路](jsc-exit-cut-deep-dive.md)。以下は**机上反例**であり、ブラウザ・JSC実行試験ではない。
|ID|想定する反例／対照|合格とする期待値|拒否する誤昇格|
|---|---|---|---|
|JSC-N01|NeedTermination trapをfireしたが、現在のJS frameはまだ実行中|J1のみ。J2 UNKNOWN|trap送信＝実行終了|
|JSC-N02|NeedTerminationがdeferされている|J2 UNKNOWN|defer中に終了と扱う|
|JSC-N03|JS stackがtrap処理前に先に抜け、次のentryで終了例外|当該cutで終了例外の発生時刻UNKNOWN|trap日時でJS実終了|
|JSC-N04|VM::throwTerminationException()でexecutionForbiddenがtrue、C++/JS frameはunwind中|再入禁止flag候補のみ。実frame終了の証明不足／J2 UNKNOWN|flag=trueをJ2|
|JSC-N05|classic evaluate()がreturnしたが、IDB callbackを網羅していない|classic入口だけの局所事実、対象callbackのJ2 UNKNOWN|別入口へ一般化|
|JSC-N06|module / debugger / event callbackのentrypointが未監査|coverage不足、J2 UNKNOWN|単一entrypointの結果を全域PASS|
|JSC-N07|Workerがまだstartしていない時にforbidExecutionへ|対象txの存在未確定。研究U対象外/UNKNOWN|空のWorkerを対象Uに採用|
|JSC-N08|J2候補とW1の両ログが別producer、ID付きedgeなし|先後UNKNOWN、P1 BLOCKED|時刻／ログ配列順でJ2≺W1|
|JSC-N09|Workerのrunloop終了後context破棄を確認|W2候補。J2のcleanup前先行はUNKNOWN|W2からJ2を事後推論|
|JSC-N10|J2候補のproducerが失われtail/flushが不明|INCOMPLETE、J2 UNKNOWN|記録欠落で正常終了|
|JSC-N11|J2観測とW1先行を証明してもnative tx ID joinなし|P1研究の一部のみ、U UNKNOWN|J2だけでU PASS|
|JSC-N12|計測専用lockでJ2とW1の順序を直列化|測定摂動・元条件との同一性UNKNOWN|計測器が作った順序を実証|
## この版の受入
- JSC-N01〜N12は**予め固定した期待値**で、テスト実行数12を意味しない。
- 同一のJS実行停止、VMへの再入禁止、W1 cleanup先行、Client/Server tx状態、native-ID対応、recording completenessをそれぞれ分離。
- いずれかが不明ならJ2の肯定証明／P1終了ゲートの突破を行わない。既存R/U判定・schema/runner・実験許可を変更しない。
- H1〜H3 UNKNOWN/H4 PARTIAL、G1 PARTIAL、G2〜G4 UNKNOWN、conditionU/realExperiment NOT_RUN、NOT_GRANTED/BLOCKED/HOLD維持。
