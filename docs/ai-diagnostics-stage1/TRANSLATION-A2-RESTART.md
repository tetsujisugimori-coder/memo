# 翻訳検証の再開：A2限定の実機1回・直接Ollama1回

2026-11-17：選択文章の参照UIは利用者判断で正式受入。翻訳品質は未解決（以前の実機A2が1 PASS / 1 FAIL）。PR #456全体のマージは未承認。

## 目的と判定境界

選択文章のプレビューと実際のAI要求を区別する。対象英文は架空の The blue bird sits by the window. のみ。モデルは導入済みのphi4-mini:latest、翻訳先ja、履歴0、選択文章参照。実ブラウザ（通常アプリ）と直接Ollamaは別試験である。成功した回答を得るまで再試行しない。

同じ入力でもモデル生成が非決定的な場合がある。通信成功は翻訳内容の正しさを保証しない。プレビューと推定fixtureが一致しても、実送信payloadを独立取得できなければ payload 完全一致は UNKNOWN とする。

## 1. 非推論の読み取り確認

Windowsの既存の隔離コピー（実データのないテスト用プロファイル）でPowerShell 7を開く。Gitの現在版・既存の変更は勝手に更新、移動、削除しない。

    git status --short
    git rev-parse HEAD
    node scripts/ai-translation-a2-once.cjs plan
    node scripts/ai-translation-a2-once.cjs probe

plan はモデルを実行しない。sourceUnchangedとworktreeCleanがtrue、入力197文字、role system,user、options={}、history0を確認する。probe は127.0.0.1:11434へのGETのみで、モデルの導入・更新をしない。Windows、AVAILABLE、phi4-mini:latestを確認できなければBLOCKED。

## 2. 通常アプリでのA2 1試行

新規会話を開き、架空本文の英文を全文選択。AIの参照範囲を選択文章、用途を翻訳、言語を日本語、モデルをphi4-mini:latestとする。画面のプレビューに元メモ名・選択本文・文字数を表示し、本文が一致することを目視確認する。アプリのsystem指示が既定値でない場合、この固定fixtureとの同条件比較は不成立（無断で設定を変更しない）。

条件がそろった場合に限り1回送信。画面の回答内容・日本語/英語の別・診断のrequestId/HTTP/chunk/done/body/final/UI/時間を各1回の原票として保存する。英語原文を返したら正常終了でも翻訳FAIL。無限再試行しない。

## 3. 直接OllamaでのA2 1試行

上記アプリ試行が終わり、同条件を確認した場合に限り、既存の専用アーカイブに出力フォルダを作って明示実行する。コマンドの実行はこの工程では行っていない。

    $root = Join-Path $HOME 'Dev-Artifact-Archive\Memo-Nexus\A2-Direct'
    New-Item -ItemType Directory -Force $root | Out-Null
    node scripts/ai-translation-a2-once.cjs direct-one --execute --app-observed --model phi4-mini:latest --output $root

実行器は1回だけPOSTし、最大60秒・応答最大1MiB・自動再試行0。出力先は毎回新しい専用子フォルダ。request.json、answer-local-only.txt、diagnostic-metadata.json、report.jsonの実物を保存する。個人メモ、秘密、トークンを出力・公開しない。公開報告での原文回答全文やrequest JSON共有は禁止、必要なら利用者が共有範囲を判断する。

## 4. 比較・判定

アプリ側と直接側のrequest SHA256・messages SHA256が完全一致したとは、直接側の記録だけではいえない。必要に応じてアプリ実送信を安全に取得し、同一版、system指示、messages、model、options、履歴を独立に照合する。

一試行ずつ翻訳品質PASS/FAIL/UNKNOWN/NOT_TESTEDを付与し、直接側とアプリ側を混同しない。A2歴史結果1 PASS/1 FAILを上書きしない。B5、別モデル、Chart #458、mainへのマージは本工程の対象外。原因UNKNOWNは独立に立証できるまで保持。
