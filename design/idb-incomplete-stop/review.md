# 独立レビュー用チェック

- [ ] 最新main、各PR HEAD、正式レビューの対象commit、本文・関連Issueと実行/証拠版を混同していない。#397/#399正式レビュー0を尊重する。
- [ ] D/E/F/GのFAIL・UNKNOWN・INCONCLUSIVEとH1/H2/H3 UNKNOWN、H4 PARTIALを維持している。
- [ ] S1〜S5の保証、upstream参考コードからの推論、対象26.5の未検証事項が区別されている。
- [ ] active/inactive、request readyState、内部未終端、event dispatch、送信/受信、停止、閉鎖/解放を分離している。
- [ ] 通知後の完了競合を時間・欠測から否定していない。内部abortの配送が止まるケースを除外できないと記録している。
- [ ] 推奨Sは人工的callback保持候補であり、T7同一・停止時内部未完了保証とはしていない。ゲートのtimeout/強制中断でmarkerが残るケースを考慮している。
- [ ] 独立証明未確立ではU実行不可。問いをcallback保持に狭める場合も再承認が必要。
- [ ] 将来R/U最大2試行、各1反復、retry0、資源/期限、保存前delete禁止、中止/NOT_RUNが具体的。旧枠転用なし。
- [ ] CPUの硬い上限やwait復帰時刻をJS APIが保証するとは書いていない。外側watchdogの実装が未解決である。
- [ ] judgeTrace公開profileからstopCondition PASSへの経路がない。synthetic oracleのPASSは実測ではなくrealExperiment NOT_RUN。
- [ ] 異常、旧ID、欠測、送信後complete、期限、cleanupUNKNOWN、late success等の反例を試験している。
- [ ] 新ブラウザ/Worker/IndexedDB実行0、旧実験再実行0、製品/旧ソース/原始証拠変更0。旧workflow起動条件に追加差分が一致しない。
- [ ] GitHubのIssue/PR/相互参照コメントを投稿後に読戻し、文字化けや欠落、Draft/auto-merge状態を確認する。
- [ ] 本静的成果を実行許可・本番統合許可・マージ許可に読み替えていない。
