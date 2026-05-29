# AI朝刊オートメーション出力仕様

このメモ帳アプリへそのまま取り込むには、朝刊オートメーションの出力を次の形にそろえます。

1. 先頭に人が読む日本語の朝刊本文を書く
2. 末尾に ```json のコードブロックを付ける
3. JSON は `ai-news-template.json` と同じ構造にする

出力例:

```md
2026年5月27日 6:30 JST時点で確認した、重要度の高いAIニュース5件です。

1. OpenAIの推論モデルが80年来の離散幾何の予想を覆す
要約本文...

2. GoogleがI/O 2026でGemini新機能を発表
要約本文...

全体傾向まとめ...

```json
{
  "title": "AI最新ニュース朝刊",
  "date": "2026-05-27",
  "items": [
    {
      "heading": "OpenAIの推論モデルが80年来の離散幾何の予想を覆す",
      "points": [
        "汎用推論モデルが長年の有力予想を破る証明を見つけた。",
        "外部の数学者による検証が進み、研究支援を超えた貢献として注目されている。"
      ],
      "whyImportant": "AIが最先端研究の発見フェーズに入りつつあることを示す。",
      "sourceLabel": "OpenAI",
      "sourceUrl": "https://openai.com/index/model-disproves-discrete-geometry-conjecture/"
    }
  ],
  "trendSummary": "研究ブレークスルーと実運用の両輪で、AI各社の競争がさらに加速している。"
}
```
```

この形式なら、朝刊本文を `.md` や `.txt` に保存して `AI Import` するだけで、JSON部分を自動抽出してノート化できます。

必要なら、保存した本文からあとで JSON ファイルだけを作ることもできます。

```powershell
node build-ai-news-json.js morning-news.md "C:\Users\tetsu\Documents\Codex\メモ帳\IMPORT\ai-news-2026-05-27.json"
```

オートメーションで自動保存する場合の推奨保存先:

- `C:\Users\tetsu\Documents\Codex\メモ帳\IMPORT\ai-news-YYYY-MM-DD.json`
- `C:\Users\tetsu\Documents\Codex\メモ帳\IMPORT\ai-news-latest.json`

この `IMPORT` フォルダは、AI朝刊以外の取込ファイルもまとめて置く前提です。
