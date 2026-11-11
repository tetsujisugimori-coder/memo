# Chart WebKit 第3工程

Issue #451 は #449 の後続。Draft PR #450 の `c558cf693f3ddcbb19f59e63c744e43a816c5447` から分岐し、第2工程の原票・コードを保持する。

`PLAN.ja.md` は試行前の上限と停止条件。`tools/chart-webkit-stage3/` は合成 fixture と診断専用実装。A は recorder を挿入せず、合成 A/B/C 全群には共通の fixture 内 event listener がある。第3工程 B は新しい light 実装で、第2工程の B と同一方式・同時点の対照ではない。

ローカルは Windows 10.0.26300 / Node 24.20.0 / Playwright 1.62.1、空き容量の観測値 496,930,451,456 bytes。Ubuntu hosted runner とは別環境。GitHub Actions の課金・残利用枠 API は 404 で取得できず UNKNOWN。試行前に runner の空き容量を検査し、設定した上限を超える実行はしない。

第2工程の境界欠落10件は各 B 群で同じ5件。touch helper 等の `context.close`、file-export の `browser.close` を旧 preloader が wrap していないことは有力候補だが、全10件の終了経路は原ログで断定できない。

ログの write callback は OS 内の書込み完了通知であり、fsync や永続性の証明ではない。snapshot と定期 batch の同じ event は重複記録され得るため、document ID と seq、batch ID／request ID、内容一致で分類する。異常終了の未送信末尾、capture 前の再親化子孫、異なる時計間の順序は UNKNOWN。

詳細 C は focus 呼出しの wrapper、MutationObserver、wait の監視、終了境界の有界回収と非同期退避を追加する。これらは実行時のタイミングを変え得る。wait の結果自体や product の rAF・storage・assertion は変更しない。hook の初期設定、native close 自体は個別の取消保証がなく、外側 timeout が必要。

Windows 初回 `windows-step1-raw.zip` は合成 test の原票と限定 scan を保存するが、実行時 source の個別 hash がないため、実行コードの厳密な同一性は UNKNOWN。ZIP 内の9件の result JSON は analyzer の人工反例入力であり、A/B/C の実 browser 比較ではない。

後の Windows 合成確認は source 個別 hash を実行前後で記録した。原票の `outcome.json` にローカル user profile 絶対パスが含まれるため、原本とその ZIP は公開せず user workspace 内に隔離した。`windows-source-linked-manifest.json` は原本と区別した派生 manifest で、原本は加工していない。
