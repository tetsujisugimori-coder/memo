# 試行前の限定確認

2026-11-11 JST、Windows / Node 24.20.0 / Playwright 1.62.1 / WebKit 26.5。合成 fixture の初回テスト2件は FAIL。data URL に charset がなく日本語 aria-label が文字化けし、期待値の照合が失敗した。`charset-failure-*.jsonl` はそのときの計測原票。製品試験の失敗ではない。fixture に UTF-8 を明示した後、light・detailed の同一 node、beforeinput/input 順、click時の値、詳細モードの timeout snapshot が PASS。再検証は4 PASS・1 SKIP（Linux 子孫終了テスト）。

独立事前レビューでは A 群から preloader を除外し、プロセスごとの保存先、非同期書込み上限、B 群の close/reload 境界、Linux の detached 子孫追跡、実験上限と停止条件を確認した。追加の試行前 P1 は未検出。ただし Linux 上の限定試験 PASS と、試行後の原票・欠落・hash・機密走査・source・artifact の独立照合が受入条件。検出前に再親化された子孫および未送信末尾は UNKNOWN。

元のテスト出力は当該会話の実行結果にあり、このディレクトリには保存していない。原票の hash は同梱 manifest に記載する。
