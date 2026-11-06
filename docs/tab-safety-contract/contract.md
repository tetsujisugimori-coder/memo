# 工程③: 複数タブ保存の受入契約

Issue #431。PR #430 / review-5801397676のテスト契約だけを補正する。製品の保存競合修正は工程② / #429へ分離する。

積み上げbaseは`4651a506245f19086e34125cc1eed00512eb71ab`、親branchは`codex/storage-guide-ci-tab-followup-20261106`。親PRはDraftを維持し、親HEAD/main/研究PRを変更しない。

## 判定の分離

- 契約改善: 単体・独立レビュー・実反例の検出・回帰確認でPASS/PARTIAL/FAIL。
- 製品の複数タブ保存安全性: 実ブラウザの観測だけでPASS/FAIL/UNKNOWN。合成入力のPASSを転記しない。
- CI全体: 実際のSUCCESS/FAILUREを記録。現行反例がある間は非任意tabs試験をREDのままにする。
- マージ推奨: 現行製品が未解消ならNO。今回はDraft提出まででマージ禁止。

## 旧番号との対応

| 番号 | 親PRの意味 | 今回の意味 |
|---|---|---|
| 1 | 同じ保存領域に2タブ | 維持。同一一時context/originを確認 |
| 2 | 同じメモを表示 | 維持。IDと基準本文を確認 |
| 3 | 片側の通常自動保存 | 維持。直接保存関数を呼ばずDBとUIを読む |
| 4 | cleanな他タブへ反映 | 維持 |
| 5 | 両変更が自動的にDBへ統合されることが必須 | **A完全成立またはB完全成立**。安全停止も受入可能 |
| 6 | 保存済みUIとDBの一致 | 保存済みUIはDBと一致。競合原稿は未保存として明確に分離 |
| 7 | 統合、または警告/errorだけでも可 | 警告単独を拒否。拒否証拠・確定内容・原稿保全・実回復が必要 |
| 8 | reload後も両変更がDB内に必須 | Aの統合結果、またはBの確定内容＋回復可能な保全原稿がreloadとタブ終了後も保持 |
| 9 | ガイド読取り中のデータ不変 | 維持。全object store/localStorage/sessionStorageを比較 |
| 10 | 直接訪問・同一タブの導線 | 維持 |
| 待機 | 両タブdirty=false | 有限Node pollでsaved候補、conflict-stopped候補、timeout、execution-errorを分離。dirty=trueの安全停止を妨げない |

5/7/8はそれぞれの狭い条件だけで安全PASSを作らず、全Aまたは全Bの証拠が揃った場合だけPASSにする。詳細な不足条件はA0〜A5、B0〜B8としてJSONに残す。

## 方式A: 安全な自動統合

実際に同じ2行基準から、Aは1行目だけ、Bは2行目だけを変更したdirty原稿を観測する。設定文字列だけは証拠にしない。

1. 確定DBの本文が両行の変更を含む正確な統合本文である。
2. 保存中/保留/タイマー予約が残っておらず、両UIが保存済みでDB本文と一致する。
3. reload後、両タブを閉じて開き直した後も1/2を満たす。
4. 読取りで一度見た変更が後のDB読取りで消える巻戻りがない。

読取りサンプルは全commitの履歴ではない。観測の順序を、完全なcommit順序・全interleavingの証明とは呼ばない。

## 方式B: 競合検知・上書き阻止・永続保全・回復

警告、dirty=true、error、回復可能という宣言だけでは受理しない。以下をすべて要求する。

1. DBから読み取った拒否レコードが、note ID、request ID、試みた旧基準revision、実際の確定revision、拒否対象本文、確定本文へ結び付いている。確定revisionは旧基準より新しい。
2. 確定済み本文はAまたはBの実編集本文であり、基準本文へ巻戻らない。terminal/reload/reopenで確定内容を保持し、観測済みの古い上書きを拒否レコードで正当化しない。
3. 拒否された側の全文原稿・基準本文/revision・request IDを、実在する永続レコードとして読む。reloadとタブ終了後も同じ内容・拒否証拠がある。memory/sessionだけでは不可。
4. 競合した側は未保存/競合を可視化し、確定本文と未保存全文の双方を参照できる。未保存Bを保存済みと表示しない。確定側の保存済み表示もDBと一致する。
5. 開き直した後、実在するUIを操作し、回復用に書き出されたファイルをNodeで読み戻す。内容が保全原稿全文と一致し、確定DBを変更していないことも確認する。
6. 書出し後は未解決の競合表示を保持しても、正しい確定DB本文と保存済み表示へ戻ってもよい。未保存本文を保存済みと見せる経路は拒否する。

### テスト観測用の結合点

現在の製品にBの機能を追加するものではない。将来の工程②に向け、試験補助を製品の保存コードと分離した。

- DB名と全object storeの生レコード、localStorage/sessionStorageを読み、`stored`要約と`notes`の原レコードが一致することも検査する。
- 正規化する拒否レコード: `kind: memo-conflict-rejection`、id/requestId/noteId、expectedRevision/committedRevision、attemptedBody/committedBody。
- 正規化する原稿レコード: `kind: memo-conflict-draft`、id/requestId/noteId、body/baseBody/baseRevision。
- 実UI観測アダプターは`[data-memo-conflict]`内の確定本文・原稿本文・note/request ID・可視性と、`[data-memo-conflict-export]`を読む。宣言フラグで実行結果を代用しない。
- 回復経路の現在の観測実装は、UIから実際にダウンロードし、読み戻した全文で検証する方式。工程②が別の有効な回復UI/保存先を採るなら、この読取り/操作アダプターを実装へ結合する。A/Bの保全条件を緩和しない。
- 別IndexedDBが存在する、DB一覧が観測できない、保全先を結合できない場合は保全範囲を完全と推測しない。BはUNKNOWN/FAILのまま。現行の無警告・偽保存済み上書きは、完全な全保存先列挙に依存せず反例としてFAILにする。

現行製品に拒否/保全/回復UIがないことを、利用者が手動コピーできるはずという仮定で補わない。

## 有限待機と実行失敗

Nodeが各読取りを明示awaitし、単一の読取り自体にも残りdeadlineを適用する。観測にはmonotonicな経過時間と`readOrder`を記録。sleepも残りdeadline以内に制限する。

saved候補には、実DBレコードと保存キュー/予約のidleを要求する。conflict-stopped候補は実在する可視UIと非保存済み状態、idleを要求し、dirty=trueも許容する。どちらも**候補**であり、候補だけでA/Bの安全性をPASSにしない。

timeoutや途中例外は理由・最終読取りを保存し、未到達の条件をUNKNOWNとする。browser起動失敗はNOT_TESTED、試験全体は非ゼロ。10条件の欠落/重複、明示FAIL/NOT_TESTEDと結果の矛盾、ログ/HEAD欠落は成功にしない。非同期`waitForFunction`による保存判定は使用しない。

## 合成試験と実RED

純粋関数の正常A、正常B、回復完了後に正しい保存済みUIへ戻るBはSYNTHETIC入力で検査する。これらは製品実装のPASSではない。

実ブラウザでは通常のUI入力と自然autosaveだけを使う。保存関数、timer、BroadcastChannel、IDB writerは差し替えない。両dirty原稿、保存DB、表示、reload、タブ終了/再開まで観測する。現行のA行消失・双方保存済み・警告なし・再開後も非回復はFAILを維持する。原20条件・負対照2件のコード、既存CI判定は変更しない。

## 工程②への推奨

最初は自動統合より、**同じIDB readwrite transaction内でrevisionを比較し、古い書込みを拒否して未保存原稿を永続保全する方式B**を優先する。

- 安全性: 比較と書込みを同じtransactionへ置き、読取り後の別transactionで確認しただけのTOCTOUを避ける。BroadcastChannelや単なる排他ロックだけを、古い本文を拒否する根拠にしない。
- 変更範囲: 通常メモ保存のrevision guard、競合原稿/拒否結果の保存、競合状態UIと回復/書出しに限定。MCP/Worker研究へ混入しない。共有1件のdraft mirrorだけへ依存せず、note/attempt単位で双方の原稿を保持する。保存先追加/移行は別途設計・検証する。
- 検証可能性: 拒否された書込みがnotesを変えないこと、確定本文と原稿の実体、再読込・タブ終了後の保全、実UIによる回復をこの契約へ結合する。通常保存成功callbackを競合停止に流用して「保存済み」と表示しない。

解決は明示操作で行い、保全した原稿を別メモへ安全に回復する経路などから始める。自動3-way mergeは将来の任意改善とし、今回の非重複2行例だけを一般文書の統合保証へ拡張しない。工程②後は新しい実装HEADでWindows/Linux・両engine・RED反例・正常B・既存回帰・独立レビューを再受入する。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。実データ/実接続/停止実験なし。

2026-11-06 着手（JST）
