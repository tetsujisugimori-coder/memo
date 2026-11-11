# 独立レビュー記録

判定: **PARTIAL / 原因 UNKNOWN / マージ推奨 NO**。APPROVE ではない。

独立担当が計測コードと実行計画を事前確認し、A群に既存 preloader を流用できないこと、別 process の出力衝突、段階退避の不足、WebKit の detached 子孫、分析器の input 不在時の情報落ちを指摘。局所修正と合成反例の内容・実装者の試験報告、および Linux CI の限定試験結果を確認した。独立担当が合成反例を新たに実行したわけではない。timeout の実 trial と未送信末尾は未検証。

実装者の集計に依存せず、artifact 13839268363 の ZIP digest、展開561ファイルの SHA-256、各 result.json、suite stdout、イベント JSONL、process exit、CI 原ログを照合した。4回とも smoke・全 suite 成功、先行 feature と2スクリプトの順序を確認。2例で対象 input の140→Infinity、click 時の値と項目順、同 node への focus 復帰を各 document の連番で確認した。原失敗は再現せず、失敗時の rAF・DOM・入力は UNKNOWN。

観測された event の連番欠落・重複、記録された dropped・write error は0。未送信末尾は UNKNOWN。全ファイルの byte 走査で Node compile cache の4ファイルに PRIVATE KEY の開始 marker を検出したが、対応箇所の間は14 bytes、base64 形式不成立で、正常な PEM 鍵を示さなかった。画像や他形式も含めた完全な機密不存在はこの方法では証明できない。

修正後の通常 CI 42983927651 は Figure E2E 1 job FAIL、13 SUCCESS、任意診断1 SKIP。CI checks と Windows recovery の一般単体試験はいずれも1991 PASS / 0 FAIL / 0 SKIP。Figure の原因・Chart との関係は UNKNOWN。成功の一般化、推測による製品修正、マージを支持しない。
