// IndexedDBで使うデータベース名・保存箱名・バージョン。
// バージョンを上げると、あとで保存形式の変更処理を追加できます。
const DB_NAME = "memo-nexus";
const STORE_NAME = "notes";
const COLLECTION_STORE_NAME = "collections";
const ATTACHMENT_STORE_NAME = "attachments";
const DB_VERSION = 3;
const APP_VERSION = "0.4.0";
const APP_LABEL = "Waypoint";
const APP_BUILD = "2026-07-15";
const UNCLASSIFIED_COLLECTION_ID = "system-unclassified";
const MAX_COLLECTION_DEPTH = 5;
const DRAFT_STORAGE_KEY = "memo-nexus-current-draft";
const POPOUT_WINDOW_STORAGE_KEY = "memo-nexus-popout-window";
const POPOUT_SYNC_CHANNEL = "memo-nexus-sync";
const THEME_STORAGE_KEY = "memo-nexus-theme";
const COLLECTION_SORT_STORAGE_KEY = "memo-nexus-collection-sort";
const IMAGE_BLOCK_SIZE_STORAGE_KEY = "memo-nexus-image-block-size";
const LOGO_ANIMATION_STORAGE_KEY = "memo-nexus-logo-animation";
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UNDO_LIMIT = 50;
const UNDO_INPUT_INTERVAL_MS = 800;
const HIGHLIGHT_AUTO_MIN_RELEVANCE = 2;
const MAX_ATTACHMENT_IMAGE_DIMENSION = 1800;
const ATTACHMENT_IMAGE_QUALITY = 0.86;
const HIGHLIGHT_LANGUAGE_ALIASES = {
  js: "javascript",
  ts: "typescript",
  html: "xml",
  py: "python",
  sh: "bash",
  shell: "bash",
  ps: "powershell",
  md: "markdown",
  yml: "yaml"
};
function createMermaidTemplate(type, name, description, lines, notes) {
  return {
    category: "mermaid",
    type,
    name,
    description,
    syntax: ["```mermaid", ...lines, "```"].join("\n"),
    notes
  };
}

const SYNTAX_GUIDE_ITEMS = [
  { category: "markdown", name: "見出し1", syntax: "# 見出し", description: "最も大きな見出しです。", notes: "行頭に#と半角スペースを書きます。" },
  { category: "markdown", name: "見出し2", syntax: "## 見出し", description: "2段階目の見出しです。", notes: "行頭に##と半角スペースを書きます。" },
  { category: "markdown", name: "見出し3", syntax: "### 見出し", description: "3段階目の見出しです。", notes: "行頭に###と半角スペースを書きます。" },
  { category: "markdown", name: "太字", syntax: "**重要**", description: "文字を太字で強調します。", notes: "文字の前後を**で囲みます。" },
  { category: "markdown", name: "斜体", syntax: "*強調* または _強調_", description: "文字を斜体で強調します。", notes: "単語の途中のアンダースコア、コード、エスケープした記号は変換しません。" },
  { category: "markdown", name: "打ち消し線", syntax: "~~削除予定~~", description: "文字に打ち消し線を付けます。", notes: "コード内では変換しません。" },
  { category: "markdown", name: "番号付きリスト", syntax: "1. 1つ目\n2. 2つ目", description: "連続した項目を番号付きリストで表示します。", notes: "番号はHTMLの自然な番号付きリストとして表示されます。" },
  { category: "markdown", name: "チェックリスト", syntax: "- [ ] 未完了\n- [x] 完了", description: "完了状態を持つ項目を表示します。", notes: "プレビューのチェック操作は、現在開いているメモの本文だけを更新します。" },
  { category: "markdown", name: "水平線", syntax: "---", description: "内容の区切り線を表示します。", notes: "行全体をハイフン3個以上にします。" },
  { category: "markdown", name: "通常リンク", syntax: "[OpenAI](https://openai.com)", description: "http/httpsの外部リンクを安全に新しいタブで開きます。", notes: "javascript:など危険なURLはリンクにしません。Wikiリンクとは別の一般的なMarkdownです。" },
  { category: "markdown", name: "注意書き", syntax: "> [!NOTE]\n> 補足情報です。", description: "NOTE、TIP、IMPORTANT、WARNINGを色とアイコン付きで表示します。", notes: "Memo NexusではGitHub形式をそのまま本文へ保存するため、Markdown出力でも読めます。" },
  { category: "markdown", name: "解説カード", syntax: "本文を選択して［解説を追加］", description: "選択箇所に紐付く独立した解説カードを追加します。", notes: "Memo Nexus独自機能です。本文とは別にメモデータへ保存され、対象が見つからない場合も削除されません。", copyable: false },
  { category: "markdown", name: "インラインコード", syntax: "`const value = 1;`", description: "文中の短いコードを表示します。", notes: "文字列をバッククォート1個ずつで囲みます。" },
  { category: "markdown", name: "箇条書き", syntax: "- 項目", description: "項目を箇条書きで表示します。", notes: "行頭に-と半角スペースを書きます。" },
  { category: "markdown", name: "引用", syntax: "> 引用文", description: "引用文として表示します。", notes: "行頭に>と半角スペースを書きます。" },
  { category: "markdown", name: "Wikiリンク", syntax: "[[メモ名]]", description: "同名メモへの知識リンクを作ります。", notes: "メモ名を二重の角括弧で囲みます。" },
  {
    category: "code",
    name: "JavaScriptコードブロック",
    syntax: ["```javascript", "const greeting = \"Hello, Memo Nexus!\";", "console.log(greeting);", "```"].join("\n"),
    description: "開始側のバッククォート3個の直後に言語名を書き、終了側はバッククォート3個だけを書きます。",
    notes: "言語名を省略するとhighlight.jsが自動判定を試み、判定できない場合は色を付けずに表示します。コードは実行されません。"
  },
  {
    category: "table",
    name: "表ブロック",
    syntax: [
      "表の説明を入力",
      "┌────────┬────────┐",
      "│ 見出し1 │ 見出し2 │",
      "├────────┼────────┤",
      "│ セル     │ セル     │",
      "└────────┴────────┘",
      "出典や補足を入力"
    ].join("\n"),
    description: "エディタ上部の［表］からカーソル位置へ挿入し、説明・セル・出典や補足を編集できます。Excel・Googleスプレッドシートのタブ区切りデータ、Markdown表、WebページのHTML表を本文へ貼り付け、表またはテキストとして挿入することもできます。貼り付け前に1行目を見出しにするか選べます。表の操作メニューから、Excel・Googleスプレッドシート向けの表全体コピーと、Markdown表としてのコピーができます。HTML対応アプリでは表として貼り付けられる場合があります。左端の行番号または上端の列記号を押すと、選択中の行・列の直後へ追加できます。未選択時は末尾へ追加され、追加後は選択が解除されて新しい行・列の先頭セルへカーソルが移ります。削除時は確認画面を表示します。",
    notes: "コピー対象はセルだけで、説明文と補足文は含みません。行や列を選択していても現時点では表全体をコピーします。貼り付け上限は100行・30列・3000セルです。CSVは通常文章との誤判定を避けるため自動判定しません。HTMLの結合セルは左上へ値を置き、残りを空セルにしますが、元の結合表示は完全には再現されません。行と列は同時には選択されません。最後の1行・1列は削除できません。セルはプレーンテキスト専用です。Tabで右へ、Shift+Tabで左へ移動し、最後のセルでTabを押すと行を追加します。見出し行のオン／オフと表全体の削除も操作メニューから行えます。カードでは空の説明や補足を隠し、狭い画面では表だけを横スクロールできます。数式・計算・セル結合・色指定・並べ替え・絞り込みには未対応です。",
    copyable: false
  },
  { category: "math", name: "インライン数式", syntax: "円の面積は $A = \\pi r^2$ です。", description: "文章中に短い数式を表示します。", notes: "数式記法はKaTeXによる表示用で、自動計算は行いません。" },
  { category: "math", name: "ブロック数式", syntax: ["$$", "E = mc^2", "$$"].join("\n"), description: "数式を独立したブロックとして表示します。", notes: "長い数式は数式部分だけを横スクロールできます。" },
  { category: "math", name: "分数", syntax: "$\\frac{a}{b}$", description: "分数を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "平方根", syntax: "$\\sqrt{x}$", description: "平方根を表示します。", notes: "表示専用です。計算ブロックのsqrt()には対応していません。" },
  { category: "math", name: "累乗", syntax: "$x^2$", description: "累乗を表示します。", notes: "表示専用です。計算ブロックの^には対応していません。" },
  { category: "math", name: "添字", syntax: "$a_n$", description: "添字を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "円周率", syntax: "$\\pi$", description: "円周率の記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "掛け算記号", syntax: "$\\times$", description: "掛け算記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "割り算記号", syntax: "$\\div$", description: "割り算記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "プラスマイナス", syntax: "$\\pm$", description: "プラスマイナス記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "等しくない", syntax: "$\\neq$", description: "等しくない記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "およそ等しい", syntax: "$\\approx$", description: "およそ等しい記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "以下", syntax: "$\\le$", description: "以下の記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "以上", syntax: "$\\ge$", description: "以上の記号を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "総和", syntax: ["$$", "\\sum_{i=1}^{n} i", "$$"].join("\n"), description: "総和を独立した数式として表示します。", notes: "数式を表示するだけで、合計は計算しません。" },
  { category: "math", name: "積分", syntax: ["$$", "\\int_a^b f(x)\\,dx", "$$"].join("\n"), description: "積分を独立した数式として表示します。", notes: "数式を表示するだけで、積分値は計算しません。" },
  { category: "math", name: "極限", syntax: ["$$", "\\lim_{x \\to 0} f(x)", "$$"].join("\n"), description: "極限を独立した数式として表示します。", notes: "数式を表示するだけで、極限値は計算しません。" },
  { category: "math", name: "括弧", syntax: "$\\left( \\frac{a}{b} \\right)$", description: "内容に合う大きさの括弧を表示します。", notes: "短い数式として文章中でも使用できます。" },
  { category: "math", name: "行列", syntax: ["$$", "\\begin{pmatrix}", "a & b \\\\", "c & d", "\\end{pmatrix}", "$$"].join("\n"), description: "行列を独立した数式として表示します。", notes: "ブロック数式としてコピー後そのまま使用できます。" },
  { category: "math", name: "複数行の式", syntax: ["$$", "\\begin{aligned}", "a &= b + c \\\\", "  &= d + e", "\\end{aligned}", "$$"].join("\n"), description: "位置を揃えた複数行の式を独立表示します。", notes: "ブロック数式としてコピー後そのまま使用できます。コードブロック内では数式に変換されません。" },
  { category: "calculation", name: "基本構文", syntax: [":::calc", "100 * 1.08", ":::"].join("\n"), description: "1つの独立した式を計算し、式と結果を表示します。", notes: "数式ブロックは表示用、計算ブロックは計算用です。仕様はCalculator Memoの現在のmainに合わせています。" },
  { category: "calculation", name: "加算", syntax: [":::calc", "100 + 200", ":::"].join("\n"), description: "加算を計算します。", notes: "1ブロックにつき1つの式だけ使用できます。" },
  { category: "calculation", name: "減算", syntax: [":::calc", "500 - 120", ":::"].join("\n"), description: "減算を計算します。", notes: "負数にも対応します。" },
  { category: "calculation", name: "乗算", syntax: [":::calc", "25 * 4", ":::"].join("\n"), description: "乗算を計算します。", notes: "表示時だけ*を×として見せ、元の式を計算に使用します。" },
  { category: "calculation", name: "除算", syntax: [":::calc", "100 / 4", ":::"].join("\n"), description: "除算を計算します。", notes: "表示時だけ/を÷として見せます。0では割れません。" },
  { category: "calculation", name: "括弧", syntax: [":::calc", "(12 + 18) / 3", ":::"].join("\n"), description: "括弧内を先に計算します。", notes: "括弧の対応が不正な式は計算できません。" },
  { category: "calculation", name: "小数", syntax: [":::calc", "12.5 * 4", ":::"].join("\n"), description: "小数を含む式を計算します。", notes: "結果はCalculator Memoと同じ方法で整形します。" },
  { category: "calculation", name: "パーセント", syntax: [":::calc", "200 * 10%", ":::"].join("\n"), description: "Calculator Memoと同じく、10%を10÷100として扱うため結果は20です。", notes: "加減算でも相対増減にはせず、200 + 10% は200.1です。独自の%解釈は行いません。" },
  { category: "calculation", name: "Calculator Memoで計算", syntax: "2 * (5 + 3)", description: "本文中の計算式を選択して［計算］を押すと、Calculator Memoに式を渡して新しいタブで開きます。", notes: "文字列を選択していない場合は、空のCalculator Memoを開きます。", copyable: false },
  { category: "calculation", name: "非対応項目", syntax: [":::calc", "2^10", ":::", "", ":::calc", "sqrt(2)", ":::"].join("\n"), description: "累乗、平方根、数学関数、変数、複数式、複数行計算、ブロック間参照には対応していません。", notes: "KaTeXで表示できる式が計算ブロックでも計算できるとは限りません。コードブロック内の計算記法は実行されません。", copyable: false }
];
const MERMAID_TEMPLATE_TYPES = [
  { type: "flowchart", name: "フローチャート" },
  { type: "sequenceDiagram", name: "シーケンス図" },
  { type: "stateDiagram-v2", name: "状態遷移図" },
  { type: "classDiagram", name: "クラス図" },
  { type: "erDiagram", name: "ER図" },
  { type: "gantt", name: "ガントチャート" },
  { type: "gitGraph", name: "Gitグラフ" },
  { type: "timeline", name: "タイムライン" },
  { type: "mindmap", name: "マインドマップ" }
];
const MERMAID_TEMPLATE_ITEMS = [
  createMermaidTemplate("flowchart", "基本的な処理の流れ", "開始から完了までの処理順序を表す例です。", [
    "flowchart TD", "  Start([開始]) --> Input[内容を入力]", "  Input --> Save[保存する]", "  Save --> End([完了])"
  ], "TDは上から下、矢印は処理の進行方向を表します。"),
  createMermaidTemplate("flowchart", "条件分岐", "条件によって処理先が分かれる例です。", [
    "flowchart TD", "  A[内容を確認] --> B{条件を満たす?}", "  B -- はい --> C[保存する]", "  B -- いいえ --> D[見直す]", "  D --> A", "  C --> E([完了])"
  ], "{ }は判断、矢印上の文字は分岐条件を表します。"),
  createMermaidTemplate("flowchart", "繰り返し", "全項目を処理するまで繰り返す例です。", [
    "flowchart TD", "  A[最初の項目] --> B{未処理の項目がある?}", "  B -- はい --> C[項目を処理]", "  C --> D[次の項目へ]", "  D --> B", "  B -- いいえ --> E([終了])"
  ], "判断ノードへ矢印を戻すと繰り返しを表現できます。"),
  createMermaidTemplate("flowchart", "サブグラフ", "関連する工程をグループ化する例です。", [
    "flowchart LR", "  A[依頼] --> B", "  subgraph Review[レビュー工程]", "    B[内容確認] --> C[承認]", "  end", "  C --> D[公開]"
  ], "subgraphとendの間にまとめたい処理を書きます。"),
  createMermaidTemplate("flowchart", "エラー処理", "成功時と失敗時の処理を分ける例です。", [
    "flowchart TD", "  A[保存を開始] --> B{保存成功?}", "  B -- はい --> C[完了を通知]", "  B -- いいえ --> D[エラーを記録]", "  D --> E[再試行を案内]", "  C --> F([終了])", "  E --> F"
  ], "正常系と異常系を別の矢印で示すと流れを追いやすくなります。"),

  createMermaidTemplate("sequenceDiagram", "基本的な通信", "利用者とアプリ間の要求・応答を表す例です。", [
    "sequenceDiagram", "  participant User as ユーザー", "  participant App as Memo Nexus", "  User->>App: メモを保存", "  App-->>User: 保存完了"
  ], "->>は要求、-->>は応答を表します。"),
  createMermaidTemplate("sequenceDiagram", "複数の参加者", "画面、API、データベースの連携を表す例です。", [
    "sequenceDiagram", "  actor User as ユーザー", "  participant App as アプリ", "  participant API as API", "  participant DB as データベース", "  User->>App: 保存", "  App->>API: 保存要求", "  API->>DB: データ登録", "  DB-->>API: 登録結果", "  API-->>App: 成功", "  App-->>User: 完了表示"
  ], "actorとparticipantで役割を区別できます。"),
  createMermaidTemplate("sequenceDiagram", "条件分岐（alt）", "結果に応じて応答が変わる例です。", [
    "sequenceDiagram", "  participant App as アプリ", "  participant Server as サーバー", "  App->>Server: 認証を要求", "  alt 認証成功", "    Server-->>App: トークンを返す", "  else 認証失敗", "    Server-->>App: エラーを返す", "  end"
  ], "alt、else、endで条件分岐を囲みます。"),
  createMermaidTemplate("sequenceDiagram", "繰り返し（loop）", "複数項目を順番に送信する例です。", [
    "sequenceDiagram", "  participant App as アプリ", "  participant Server as サーバー", "  loop 未送信項目ごと", "    App->>Server: 項目を送信", "    Server-->>App: 受信確認", "  end"
  ], "loopとendの間が繰り返される処理です。"),
  createMermaidTemplate("sequenceDiagram", "非同期処理", "受付後にバックグラウンド処理が進む例です。", [
    "sequenceDiagram", "  participant User as ユーザー", "  participant App as アプリ", "  participant Worker as ワーカー", "  User->>App: エクスポート要求", "  App-)Worker: 非同期ジョブを開始", "  App-->>User: 受付完了", "  Worker-->>App: 処理完了"
  ], ")で終わる矢印は非同期メッセージを表します。"),

  createMermaidTemplate("stateDiagram-v2", "基本的な状態遷移", "開始から終了までの状態変化を表す例です。", [
    "stateDiagram-v2", "  [*] --> 待機中", "  待機中 --> 実行中 : 開始", "  実行中 --> 完了 : 正常終了", "  完了 --> [*]"
  ], "[*]は開始状態または終了状態を表します。"),
  createMermaidTemplate("stateDiagram-v2", "保存状態", "メモの編集・保存状態を表す例です。", [
    "stateDiagram-v2", "  [*] --> 未変更", "  未変更 --> 編集中 : 入力", "  編集中 --> 保存中 : 保存", "  保存中 --> 保存済み : 成功", "  保存中 --> 編集中 : 失敗", "  保存済み --> 編集中 : 再編集"
  ], "矢印の後ろにコロンで遷移のきっかけを書けます。"),
  createMermaidTemplate("stateDiagram-v2", "認証状態", "ログインからログアウトまでの状態を表す例です。", [
    "stateDiagram-v2", "  [*] --> 未認証", "  未認証 --> 認証中 : ログイン", "  認証中 --> 認証済み : 成功", "  認証中 --> 未認証 : 失敗", "  認証済み --> 未認証 : ログアウト"
  ], "失敗時に元の状態へ戻る流れも表せます。"),
  createMermaidTemplate("stateDiagram-v2", "処理状態", "キュー処理の待機・実行・再試行を表す例です。", [
    "stateDiagram-v2", "  [*] --> キュー待ち", "  キュー待ち --> 実行中", "  実行中 --> 成功", "  実行中 --> 再試行 : 一時エラー", "  再試行 --> 実行中", "  再試行 --> 失敗 : 上限到達", "  成功 --> [*]", "  失敗 --> [*]"
  ], "複数の終了経路を別々に示せます。"),
  createMermaidTemplate("stateDiagram-v2", "複合状態", "大きな状態の内部に複数状態を持つ例です。", [
    "stateDiagram-v2", "  [*] --> 編集", "  state 編集 {", "    [*] --> 入力中", "    入力中 --> 確認中 : プレビュー", "    確認中 --> 入力中 : 修正", "  }", "  編集 --> 公開済み : 公開", "  公開済み --> [*]"
  ], "state名と波括弧で状態を入れ子にできます。"),

  createMermaidTemplate("classDiagram", "基本的なクラス", "プロパティとメソッドを持つクラスの例です。", [
    "classDiagram", "  class Memo {", "    +String title", "    +String body", "    +save()", "  }"
  ], "+は公開メンバーを表します。"),
  createMermaidTemplate("classDiagram", "クラス間の関連", "メモと添付ファイルの関連を表す例です。", [
    "classDiagram", "  class Memo", "  class Attachment", "  Memo \"1\" --> \"0..*\" Attachment : contains"
  ], "1と0..*で1件対複数件の関係を表します。"),
  createMermaidTemplate("classDiagram", "継承", "基底クラスと派生クラスを表す例です。", [
    "classDiagram", "  class Document {", "    +String title", "    +save()", "  }", "  class Memo", "  class DailyNote", "  Document <|-- Memo", "  Document <|-- DailyNote"
  ], "<|--の三角側が継承元です。"),
  createMermaidTemplate("classDiagram", "複数クラスの関係", "利用者、メモ、コレクションの関係を表す例です。", [
    "classDiagram", "  class User", "  class Memo", "  class Collection", "  User \"1\" --> \"0..*\" Memo : owns", "  Collection \"1\" o-- \"0..*\" Memo : groups"
  ], "-->は関連、o--は集約を表します。"),
  createMermaidTemplate("classDiagram", "インターフェース", "インターフェースを実装するクラスの例です。", [
    "classDiagram", "  class Repository {", "    <<interface>>", "    +save(memo)", "    +find(id)", "  }", "  class IndexedDbRepository", "  Repository <|.. IndexedDbRepository"
  ], "<<interface>>で種別を示し、<|..で実装関係を表します。"),

  createMermaidTemplate("erDiagram", "基本的なテーブル関係", "複数のテーブルと関係を表す例です。", [
    "erDiagram", "  USER ||--o{ MEMO : owns", "  COLLECTION ||--o{ MEMO : contains", "  MEMO ||--o{ ATTACHMENT : has"
  ], "||--o{は1対多の関係を表します。"),
  createMermaidTemplate("erDiagram", "1対多", "1つの著者が複数の記事を書く関係の例です。", [
    "erDiagram", "  AUTHOR ||--o{ ARTICLE : writes", "  AUTHOR {", "    int id PK", "    string name", "  }", "  ARTICLE {", "    int id PK", "    int author_id FK", "    string title", "  }"
  ], "PKは主キー、FKは外部キーを表します。"),
  createMermaidTemplate("erDiagram", "多対多", "学生と講座を中間テーブルで結ぶ例です。", [
    "erDiagram", "  STUDENT ||--o{ ENROLLMENT : registers", "  COURSE ||--o{ ENROLLMENT : includes", "  STUDENT { int id PK }", "  COURSE { int id PK }", "  ENROLLMENT {", "    int student_id FK", "    int course_id FK", "  }"
  ], "多対多は中間エンティティを2つの1対多で表します。"),
  createMermaidTemplate("erDiagram", "ユーザーと注文", "顧客、注文、注文明細、商品の関係を表す例です。", [
    "erDiagram", "  USER ||--o{ ORDER : places", "  ORDER ||--|{ ORDER_ITEM : contains", "  PRODUCT ||--o{ ORDER_ITEM : referenced_by", "  USER { int id PK }", "  ORDER { int id PK }", "  ORDER_ITEM { int quantity }", "  PRODUCT { int id PK }"
  ], "|{は1件以上、o{は0件以上を表します。"),
  createMermaidTemplate("erDiagram", "メモ・コレクション・添付ファイル", "Memo Nexusの主要データ関係を表す例です。", [
    "erDiagram", "  COLLECTION ||--o{ MEMO : contains", "  MEMO ||--o{ ATTACHMENT : has", "  MEMO ||--o{ WIKI_LINK : references", "  COLLECTION { string id PK }", "  MEMO { string id PK }", "  ATTACHMENT { string id PK }", "  WIKI_LINK { string target_title }"
  ], "アプリ固有のデータ構造を整理するときに使える例です。"),

  createMermaidTemplate("gantt", "基本的な予定", "日付と期間を持つ作業予定の例です。", [
    "gantt", "  title 基本的な予定", "  dateFormat YYYY-MM-DD", "  section 作業", "  要件整理 :done, task1, 2026-08-01, 3d", "  実装 :active, task2, after task1, 5d", "  確認 :task3, after task2, 2d"
  ], "dateFormatに合わせて開始日を書きます。"),
  createMermaidTemplate("gantt", "依存関係", "前の作業が終わってから次へ進む例です。", [
    "gantt", "  title 依存関係", "  dateFormat YYYY-MM-DD", "  section 開発", "  設計 :design, 2026-08-01, 4d", "  実装 :build, after design, 7d", "  テスト :test, after build, 3d", "  公開 :after test, 1d"
  ], "after IDで前のタスクへの依存を指定します。"),
  createMermaidTemplate("gantt", "マイルストーン", "重要な到達点を含む予定の例です。", [
    "gantt", "  title リリース計画", "  dateFormat YYYY-MM-DD", "  section リリース", "  候補版 :release_candidate, 2026-09-01, 5d", "  v1.0公開 :milestone, release, after release_candidate, 0d", "  振り返り :after release, 2d"
  ], "milestoneと期間0dで到達点を表します。"),
  createMermaidTemplate("gantt", "複数セクション", "担当領域ごとに予定を分ける例です。", [
    "gantt", "  title 複数チームの予定", "  dateFormat YYYY-MM-DD", "  section デザイン", "  画面設計 :ui, 2026-08-01, 5d", "  section 開発", "  実装 :dev, after ui, 7d", "  section 品質確認", "  テスト :qa, after dev, 3d"
  ], "sectionでタスクを領域別に整理できます。"),
  createMermaidTemplate("gantt", "プロジェクト進行", "計画からリリースまでの全体工程の例です。", [
    "gantt", "  title プロジェクト進行", "  dateFormat YYYY-MM-DD", "  excludes weekends", "  section 計画", "  要件定義 :done, req, 2026-08-03, 5d", "  section 制作", "  開発 :active, dev, after req, 10d", "  section 公開", "  受入確認 :accept, after dev, 3d", "  リリース :milestone, after accept, 0d"
  ], "excludes weekendsで土日を期間計算から除外できます。"),

  createMermaidTemplate("gitGraph", "基本的なブランチ", "mainから作業ブランチを作る例です。", [
    "gitGraph", "  commit id: \"初期\"", "  branch feature", "  checkout feature", "  commit id: \"機能追加\""
  ], "branchで作成し、checkoutで作業先を切り替えます。"),
  createMermaidTemplate("gitGraph", "featureブランチとマージ", "機能ブランチをmainへ統合する例です。", [
    "gitGraph", "  commit id: \"開始\"", "  branch feature", "  checkout feature", "  commit id: \"実装\"", "  commit id: \"テスト\"", "  checkout main", "  merge feature", "  commit id: \"公開準備\""
  ], "mergeの後ろに統合するブランチ名を書きます。"),
  createMermaidTemplate("gitGraph", "複数ブランチ", "開発とドキュメントを並行して進める例です。", [
    "gitGraph", "  commit id: \"開始\"", "  branch develop", "  checkout develop", "  commit id: \"開発\"", "  checkout main", "  branch docs", "  checkout docs", "  commit id: \"文書更新\"", "  checkout main", "  merge docs", "  merge develop"
  ], "checkoutで複数ブランチを行き来できます。"),
  createMermaidTemplate("gitGraph", "タグ付きリリース", "リリースコミットへタグを付ける例です。", [
    "gitGraph", "  commit id: \"初期版\"", "  branch release", "  checkout release", "  commit id: \"調整\"", "  checkout main", "  merge release", "  commit id: \"v1公開\" tag: \"v1.0.0\""
  ], "commitへtagを付けるとリリース点を明示できます。"),
  createMermaidTemplate("gitGraph", "hotfix", "公開後の緊急修正をmainへ戻す例です。", [
    "gitGraph", "  commit id: \"v1.0\" tag: \"v1.0.0\"", "  branch hotfix", "  checkout hotfix", "  commit id: \"緊急修正\"", "  checkout main", "  merge hotfix", "  commit id: \"v1.0.1\" tag: \"v1.0.1\""
  ], "hotfixブランチの短い修正履歴を表せます。"),

  createMermaidTemplate("timeline", "年表", "年ごとの主な出来事を並べる例です。", [
    "timeline", "  title サービス年表", "  2024 : 構想開始", "  2025 : 試作版を公開", "  2026 : 正式版を公開"
  ], "時点の後ろにコロンで出来事を書きます。"),
  createMermaidTemplate("timeline", "プロジェクト履歴", "プロジェクトの段階を時系列でまとめる例です。", [
    "timeline", "  title プロジェクト履歴", "  企画 : 要件を整理", "  設計 : 画面とデータを設計", "  開発 : 機能を実装", "  公開 : 利用を開始"
  ], "日付以外の段階名も時点として使用できます。"),
  createMermaidTemplate("timeline", "技術の発展", "技術選定の変化を年ごとに示す例です。", [
    "timeline", "  title 技術の発展", "  2023 : ローカル保存を採用", "  2024 : Markdown表示を追加", "       : Wikiリンクを追加", "  2025 : Mermaid表示を追加"
  ], "同じ時点へ複数の出来事を追加できます。"),
  createMermaidTemplate("timeline", "リリース履歴", "バージョンごとの変更点をまとめる例です。", [
    "timeline", "  title リリース履歴", "  v0.1 : メモ編集", "  v0.2 : 添付ファイル", "  v0.3 : コレクション", "  v0.4 : Mermaidテンプレート"
  ], "バージョン名を時点として使うと変更履歴を整理できます。"),
  createMermaidTemplate("timeline", "出来事と説明", "各時点に複数の説明を添える例です。", [
    "timeline", "  title 開発の節目", "  7月 : 課題を発見", "      : 再現条件を整理", "  8月 : 修正を実装", "      : 自動テストを追加", "  9月 : 利用者へ公開"
  ], "同じインデントのコロン行で説明を追加できます。"),

  createMermaidTemplate("mindmap", "基本的な階層", "中心テーマから項目を枝分かれさせる例です。", [
    "mindmap", "  root((中心テーマ))", "    項目A", "      詳細A1", "      詳細A2", "    項目B", "      詳細B1"
  ], "インデントを深くすると子要素になります。"),
  createMermaidTemplate("mindmap", "プロジェクト整理", "プロジェクトの要素を領域別に整理する例です。", [
    "mindmap", "  root((プロジェクト))", "    目的", "      解決する課題", "      成功条件", "    作業", "      設計", "      実装", "      テスト", "    関係者", "      利用者", "      開発者"
  ], "大きな分類から具体的な項目へ展開します。"),
  createMermaidTemplate("mindmap", "学習計画", "学ぶ内容と実践方法を整理する例です。", [
    "mindmap", "  root((学習計画))", "    基礎", "      用語", "      文法", "    実践", "      小さな課題", "      成果物", "    振り返り", "      理解度確認", "      次の目標"
  ], "学習段階ごとに枝を分けると進め方が見えます。"),
  createMermaidTemplate("mindmap", "アイデア整理", "検討中のアイデアを観点別に広げる例です。", [
    "mindmap", "  root((新しい機能))", "    利用者", "      困りごと", "      期待", "    価値", "      時間短縮", "      ミス削減", "    実現方法", "      UI", "      データ", "      テスト"
  ], "最初は広く枝を作り、あとから具体化できます。"),
  createMermaidTemplate("mindmap", "知識分類", "知識を分野と具体例に分類する例です。", [
    "mindmap", "  root((知識))", "    データ構造", "      配列", "      木", "      グラフ", "    アルゴリズム", "      探索", "      並べ替え", "    品質", "      テスト", "      レビュー"
  ], "階層構造を使って関連知識を俯瞰できます。")
];
const {
  buildCollectionLocalPlan,
  hasNameCollision,
  sanitizeWindowsName,
  supportsDirectoryPicker,
  uniqueFileName
} = window.MemoNexusExportUtils;
const {
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentCapacity,
  buildMemoExportBundle,
  classifyAttachment,
  createKeyedSerialQueue,
  extractAttachmentReferenceIds,
  findAttachmentReference,
  formatAttachmentBytes,
  insertAttachmentReferences,
  normalizeImageBlockSize,
  renderImageCaptionMarkdown,
  replaceImageBlock,
  saveAttachmentAdditionWithRollback,
  splitImageBlocks
} = window.MemoNexusAttachmentUtils;
const { buildMemoListView } = window.MemoNexusMemoListUtils;
const { createTermRelationCache, extractExplicitTerms, findAutomaticTermMatches, findTermCountMatches, termColor } = window.MemoNexusTermLinkUtils;
const { openCalculatorMemo } = window.MemoNexusCalculatorLink;
const {
  BODY_FONT_SIZES,
  CODE_FONT_SIZES,
  DEFAULT_FONT_SETTINGS,
  FONT_OPTIONS,
  FONT_SETTINGS_STORAGE_KEY,
  buildFontComparisonUrl,
  comparisonSample,
  effectiveFontSettings,
  fontOption,
  normalizeFontSettings,
  normalizeNoteFontSettings,
  noteFontSettingsEqual,
  readFontSelection,
  TITLE_FONT_SIZES,
  withoutFontSelectionParams
} = window.MemoNexusFontSettings;
const {
  TABLE_PASTE_LIMITS,
  addTableColumn,
  addTableRow,
  createTableBlock,
  deleteTableColumn,
  deleteTableRow,
  detectPastedTable,
  insertTableBlock,
  moveTableCell,
  normalizeTableBlock,
  replaceTableBlock,
  splitTableBlocks,
  tableColumnLabel,
  tableBlockPlainText,
  tableBlockToMarkdown,
  updateTableCell,
  validatePastedTableSize,
  writeTableToClipboard,
  writeTextToClipboard
} = window.MemoNexusTableBlockUtils;
const {
  AI_CONNECTION_STATES,
  AI_GENERATION_STATES,
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  friendlyAiError,
  groupModels,
  isLoopbackBaseUrl,
  normalizeAiSettings,
  resolveSavedAiState,
  withAiProviderSettings
} = window.MemoNexusAiProvider;
const { OllamaAdapter } = window.MemoNexusOllamaAdapter;
const { GeminiAdapter, groupGeminiModels } = window.MemoNexusGeminiAdapter;
const { AI_PROMPTS, aiAppendMarkdown, aiMemoTitle, buildAiMessages } = window.MemoNexusAiPrompts;
const {
  AI_REFERENCE_MODES,
  AI_REFERENCE_MAX_CHARS,
  aiReferenceLabel,
  aiReferenceSnapshot,
  createAiReferenceContext,
  emptyAiReference,
  isAiReferenceWithinLimit
} = window.MemoNexusAiContext;
const {
  selectAllReferenceNotes,
  selectCollectionReferenceNotes
} = window.MemoNexusAiReferenceSelection;
const { buildCalloutMarkdown, checklistEntries, updateChecklistAt, createExplanationCollapsedStateSaver, hydrateExplanationCardsIntoDom } = window.MemoNexusMarkdownEnhancements;
const { createPopoutGhost, getMemoSyncDecision } = window.MemoNexusPopoutUtils;
const { nextLogoAnimation: nextLogoAnimationInCycle, normalizeLogoAnimation, resolveLogoAnimation } = window.MemoNexusLogoAnimationUtils;

// HTML要素を短く取得するための小さなヘルパー。
const $ = (id) => document.getElementById(id);
const popoutMemoId = new URLSearchParams(location.search).get("popout");
const isPopoutWindow = Boolean(popoutMemoId);
const memoSyncChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(POPOUT_SYNC_CHANNEL);

// 画面上のボタンや入力欄をJavaScriptから操作できるように取得します。
const newBtn = $("newBtn");
const todayBtn = $("todayBtn");
const undoBtn = $("undoBtn");
const backupBtn = $("backupBtn");
const graphBtn = $("graphBtn");
const linkStatsBtn = $("linkStatsBtn");
const settingsBtn = $("settingsBtn");
const deleteBtn = $("deleteBtn");
const collectionsBtn = $("collectionsBtn");
const collectionExplorer = $("collectionExplorer");
const collectionBackdrop = $("collectionBackdrop");
const closeCollectionsBtn = $("closeCollectionsBtn");
const contextPanel = $("contextPanel");
const contextCollectionTab = $("contextCollectionTab");
const contextAiTab = $("contextAiTab");
const contextMemoListTab = $("contextMemoListTab");
const closeContextPanelBtn = $("closeContextPanelBtn");
const memoListCount = $("memoListCount");
const memoSidebar = $("memoSidebar");
const memoPaneBtn = $("memoPaneBtn");
const closeMemoPaneBtn = $("closeMemoPaneBtn");
const cardPaneBtn = $("cardPaneBtn");
const cardPaneButtonLabel = $("cardPaneButtonLabel");
const closeCardPaneBtn = $("closeCardPaneBtn");
const layoutBackdrop = $("layoutBackdrop");
const memoListHeading = $("memoListHeading");
const addCollectionBtn = $("addCollectionBtn");
const collectionAddMenuBtn = $("collectionAddMenuBtn");
const collectionAddMenu = $("collectionAddMenu");
const collectionTree = $("collectionTree");
const collectionMenu = $("collectionMenu");
const collectionSelectionBar = $("collectionSelectionBar");
const collectionSortSelect = $("collectionSortSelect");
const collectionToast = $("collectionToast");
const collectionMoveDialog = $("collectionMoveDialog");
const collectionMoveTitle = $("collectionMoveTitle");
const collectionMoveSelect = $("collectionMoveSelect");
const closeCollectionMoveBtn = $("closeCollectionMoveBtn");
const cancelCollectionMoveBtn = $("cancelCollectionMoveBtn");
const runCollectionMoveBtn = $("runCollectionMoveBtn");
const importAiInput = $("importAiInput");
const settingsImportAiBtn = $("settingsImportAiBtn");
const settingsPasteJsonBtn = $("settingsPasteJsonBtn");
const settingsBackupBtn = $("settingsBackupBtn");
const reloadAppBtn = $("reloadAppBtn");
const settingsDialog = $("settingsDialog");
const closeSettingsBtn = $("closeSettingsBtn");
const themeSelect = $("themeSelect");
const imageBlockSizeSelect = $("imageBlockSizeSelect");
const memoNexusLogo = $("memoNexusLogo");
const logoAnimationSelect = $("logoAnimationSelect");
const storageStatusDetails = $("storageStatusDetails");
const storageEstimateMessage = $("storageEstimateMessage");
const globalTitleFontSelect = $("globalTitleFontSelect");
const globalTitleFontSizeSelect = $("globalTitleFontSizeSelect");
const globalBodyFontSelect = $("globalBodyFontSelect");
const globalBodyFontSizeSelect = $("globalBodyFontSizeSelect");
const globalHeadingFontSelect = $("globalHeadingFontSelect");
const globalCodeFontSelect = $("globalCodeFontSelect");
const globalCodeFontSizeSelect = $("globalCodeFontSizeSelect");
const noteFontOverrideEnabled = $("noteFontOverrideEnabled");
const noteFontSettingsGroup = $("noteFontSettingsGroup");
const noteTitleFontSelect = $("noteTitleFontSelect");
const noteTitleFontSizeSelect = $("noteTitleFontSizeSelect");
const noteBodyFontSelect = $("noteBodyFontSelect");
const noteBodyFontSizeSelect = $("noteBodyFontSizeSelect");
const noteHeadingFontSelect = $("noteHeadingFontSelect");
const noteCodeFontSelect = $("noteCodeFontSelect");
const noteCodeFontSizeSelect = $("noteCodeFontSizeSelect");
const fontComparisonSample = $("fontComparisonSample");
const receivedFontSelection = $("receivedFontSelection");
const receivedFontSelectionDetails = $("receivedFontSelectionDetails");
const useReceivedFontBtn = $("useReceivedFontBtn");
const cancelReceivedFontBtn = $("cancelReceivedFontBtn");
const fontSettingsPreview = $("fontSettingsPreview");
const saveFontSettingsBtn = $("saveFontSettingsBtn");
const resetFontSettingsBtn = $("resetFontSettingsBtn");
const fontSettingsStatus = $("fontSettingsStatus");
const fontCompareButtons = document.querySelectorAll(".font-compare-button");
const jsonImportDialog = $("jsonImportDialog");
const closeJsonImportBtn = $("closeJsonImportBtn");
const cancelJsonImportBtn = $("cancelJsonImportBtn");
const runJsonImportBtn = $("runJsonImportBtn");
const jsonImportText = $("jsonImportText");
const jsonImportError = $("jsonImportError");
const closeGraphBtn = $("closeGraphBtn");
const searchInput = $("searchInput");
const memoList = $("memoList");
const titleInput = $("titleInput");
const noteExportBtn = $("noteExportBtn");
const popoutMemoBtn = $("popoutMemoBtn");
const popoutBackBtn = $("popoutBackBtn");
const popoutUnavailable = $("popoutUnavailable");
const popoutUnavailableBackBtn = $("popoutUnavailableBackBtn");
const memoSyncNotice = $("memoSyncNotice");
const loadMemoSyncBtn = $("loadMemoSyncBtn");
const noteMeta = $("noteMeta");
const editor = $("editor");
const insertTableBtn = $("insertTableBtn");
const calloutTypeSelect = $("calloutTypeSelect");
const insertCalloutBtn = $("insertCalloutBtn");
const addExplanationBtn = $("addExplanationBtn");
const explanationDialog = $("explanationDialog");
const explanationForm = $("explanationForm");
const explanationTypeSelect = $("explanationTypeSelect");
const explanationBodyInput = $("explanationBodyInput");
const explanationTarget = $("explanationTarget");
const closeExplanationDialogBtn = $("closeExplanationDialogBtn");
const cancelExplanationBtn = $("cancelExplanationBtn");
const calculatorLinkBtn = $("calculatorLinkBtn");
const tableBlockEditors = $("tableBlockEditors");
const tableAxisDeleteDialog = $("tableAxisDeleteDialog");
const tableAxisDeleteTitle = $("tableAxisDeleteTitle");
const tableAxisDeleteMessage = $("tableAxisDeleteMessage");
const closeTableAxisDeleteBtn = $("closeTableAxisDeleteBtn");
const cancelTableAxisDeleteBtn = $("cancelTableAxisDeleteBtn");
const confirmTableAxisDeleteBtn = $("confirmTableAxisDeleteBtn");
const tablePasteDialog = $("tablePasteDialog");
const tablePasteTitle = $("tablePasteTitle");
const tablePasteSummary = $("tablePasteSummary");
const tablePasteFormat = $("tablePasteFormat");
const tablePasteWarning = $("tablePasteWarning");
const tablePasteHeaderOption = $("tablePasteHeaderOption");
const tablePasteHeaderCheckbox = $("tablePasteHeaderCheckbox");
const closeTablePasteBtn = $("closeTablePasteBtn");
const confirmTablePasteBtn = $("confirmTablePasteBtn");
const pasteTableAsTextBtn = $("pasteTableAsTextBtn");
const cancelTablePasteBtn = $("cancelTablePasteBtn");
const editorCard = document.querySelector(".editor-card");
const appHeader = document.querySelector(".app-header");
const preview = $("preview");
const previewCard = $("previewCard");
const saveStatus = $("saveStatus");
const deleteUndoNotice = $("deleteUndoNotice");
const appVersionDisplays = document.querySelectorAll(".app-version");
const storageWarning = $("storageWarning");
const relatedToggleBtn = $("relatedToggleBtn");
const relatedCount = $("relatedCount");
const relatedBackdrop = $("relatedBackdrop");
const auxiliaryPanel = $("auxiliaryPanel");
const closeRelatedPanelBtn = $("closeRelatedPanelBtn");
const relatedLimitNotice = $("relatedLimitNotice");
const relatedList = $("relatedList");
const discoveryPanel = $("discoveryPanel");
const linkStatsPanel = $("linkStatsPanel");
const graphDialog = $("graphDialog");
const graphCanvas = $("graphCanvas");
const attachmentSection = $("attachmentSection");
const attachmentCount = $("attachmentCount");
const attachmentUsage = $("attachmentUsage");
const attachmentStatus = $("attachmentStatus");
const attachmentDropZone = $("attachmentDropZone");
const attachmentList = $("attachmentList");
const addAttachmentBtn = $("addAttachmentBtn");
const attachmentInput = $("attachmentInput");
const imagePreviewDialog = $("imagePreviewDialog");
const imagePreviewTitle = $("imagePreviewTitle");
const imagePreview = $("imagePreview");
const closeImagePreviewBtn = $("closeImagePreviewBtn");
const imageBlockInput = $("imageBlockInput");
const exportDialog = $("exportDialog");
const exportDialogTitle = $("exportDialogTitle");
const exportDescription = $("exportDescription");
const exportLocalNameRow = $("exportLocalNameRow");
const exportLocalName = $("exportLocalName");
const exportStatus = $("exportStatus");
const exportFailures = $("exportFailures");
const closeExportBtn = $("closeExportBtn");
const cancelExportBtn = $("cancelExportBtn");
const downloadExportBtn = $("downloadExportBtn");
const localExportBtn = $("localExportBtn");
const syntaxGuideBtn = $("syntaxGuideBtn");
const syntaxGuideDialog = $("syntaxGuideDialog");
const closeSyntaxGuideBtn = $("closeSyntaxGuideBtn");
const syntaxGuideBody = $("syntaxGuideBody");
const syntaxGuideStatus = $("syntaxGuideStatus");
const mermaidTemplateDialog = $("mermaidTemplateDialog");
const mermaidTemplateTitle = $("mermaidTemplateTitle");
const closeMermaidTemplateBtn = $("closeMermaidTemplateBtn");
const mermaidTemplateBody = $("mermaidTemplateBody");
const mermaidTemplateStatus = $("mermaidTemplateStatus");
const aiRobotBtn = $("aiRobotBtn");
const aiRobotStatus = $("aiRobotStatus");
const aiBackdrop = $("aiBackdrop");
const aiPanel = $("aiPanel");
const closeAiPanelBtn = $("closeAiPanelBtn");
const aiConnectionBadge = $("aiConnectionBadge");
const aiActiveModel = $("aiActiveModel");
const aiTargetSelect = $("aiTargetSelect");
const aiTargetPreview = $("aiTargetPreview");
const aiChatModeTitle = $("aiChatModeTitle");
const aiReferenceBadge = $("aiReferenceBadge");
const aiClearReferenceBtn = $("aiClearReferenceBtn");
const aiSpecifiedNotePicker = $("aiSpecifiedNotePicker");
const aiSpecifiedNoteSearch = $("aiSpecifiedNoteSearch");
const aiSpecifiedNoteList = $("aiSpecifiedNoteList");
const aiCollectionPicker = $("aiCollectionPicker");
const aiCollectionSearch = $("aiCollectionSearch");
const aiCollectionList = $("aiCollectionList");
const aiChatHistory = $("aiChatHistory");
const aiPurposeSelect = $("aiPurposeSelect");
const aiTranslationRow = $("aiTranslationRow");
const aiTranslationSelect = $("aiTranslationSelect");
const aiInstructionInput = $("aiInstructionInput");
const aiSendBtn = $("aiSendBtn");
const aiStopBtn = $("aiStopBtn");
const aiGenerationStatus = $("aiGenerationStatus");
const aiAnswer = $("aiAnswer");
const aiCopyBtn = $("aiCopyBtn");
const aiAppendBtn = $("aiAppendBtn");
const aiSaveNewBtn = $("aiSaveNewBtn");
const aiSummarizeNoteBtn = $("aiSummarizeNoteBtn");
const aiSendSelectionBtn = $("aiSendSelectionBtn");
const aiEnabledInput = $("aiEnabledInput");
const aiProviderSelect = $("aiProviderSelect");
const aiProviderDescription = $("aiProviderDescription");
const aiBaseUrlField = $("aiBaseUrlField");
const aiBaseUrlInput = $("aiBaseUrlInput");
const aiExternalUrlWarning = $("aiExternalUrlWarning");
const aiGeminiApiKeyField = $("aiGeminiApiKeyField");
const aiGeminiApiKeyInput = $("aiGeminiApiKeyInput");
const aiGeminiPrivacyNote = $("aiGeminiPrivacyNote");
const aiCheckConnectionBtn = $("aiCheckConnectionBtn");
const aiRefreshModelsBtn = $("aiRefreshModelsBtn");
const aiSettingsConnectionStatus = $("aiSettingsConnectionStatus");
const aiModelSelect = $("aiModelSelect");
const aiModelHelp = $("aiModelHelp");
const aiTimeoutInput = $("aiTimeoutInput");
const aiSystemInstructionInput = $("aiSystemInstructionInput");
const aiSaveSettingsBtn = $("aiSaveSettingsBtn");

// アプリ全体で共有する状態。
// notesはIndexedDBから読み込んだメモ一覧のメモリ上コピーです。
let db;
let notes = [];
let collections = [];
let currentId = null;
let saveTimer = null;
let pendingMemoSync = null;
let isLocalMemoDirty = false;
let localDirtyMemoId = null;
let localMemoEditVersion = 0;
let lastDiscovery = "";
let linkStatsVisible = false;
const termRelationCache = createTermRelationCache();
let previewAutomaticTerms = [];
let saveStatusState = "saved";
let saveStatusTime = null;
let mermaidConfiguredTheme = null;
let mermaidRenderGeneration = 0;
let mermaidRenderQueue = Promise.resolve();
let mermaidSvgRenderSequence = 0;
let undoStack = [];
let lastUndoSnapshotAt = 0;
let deletedNoteSnapshot = null;
let selectedCollectionId = null;
let collectionSortOrder = "newest";
let expandedCollectionIds = new Set([UNCLASSIFIED_COLLECTION_ID]);
let selectedMemoIds = new Set();
let selectionAnchorId = null;
let pendingMoveMemoIds = [];
let pendingMoveCollectionId = null;
let collectionToastTimer = null;
let editingCollectionId = null;
let draggedCollectionId = null;
let draggedMemoIds = [];
let pendingExport = null;
let syntaxGuideRendered = false;
const syntaxGuideCopyTimers = new WeakMap();
let pendingExplanation = null;
const tableCopyStatusTimers = new WeakMap();
let activeTableCell = null;
const tableAxisSelections = new Map();
let pendingTableAxisDeletion = null;
let pendingTablePaste = null;
let mermaidTemplateTrigger = null;
let currentAttachments = [];
let imageBlockSize = "medium";
let logoAnimationSetting = "daily";
let logoAnimationSessionOverride = null;
let logoAnimationCleanupTimer = null;
let logoInitialAnimationScheduled = false;
let logoAnimationRequestId = 0;
let pendingImageBlockTarget = null;
let attachmentRenderToken = 0;
let attachmentObjectUrls = new Map();
let pdfObjectUrls = new Map();
let pdfObjectUrlTimers = new Map();
let layoutMode = "wide";
let mobileCardOpen = false;
let compactCardVisible = true;
let contextPanelTab = "collection";
let contextPanelOpen = true;
let contextPanelUserClosed = false;
let globalFontSettings = { ...DEFAULT_FONT_SETTINGS };
let fontSettingsDraft = null;
let pendingFontSelection = null;
let fontSelectionMessage = "";
let aiSettings = { ...DEFAULT_AI_SETTINGS };
let aiSettingsDraft = { ...DEFAULT_AI_SETTINGS };
let aiModels = [];
let aiModelsEndpoint = "";
let aiVerifiedModelId = "";
let aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
let aiDraftConnectionMessage = "";
let aiConnectionRequestId = 0;
let aiConnectionAbortController = null;
let aiSettingsSessionId = 0;
let aiAbortController = null;
let aiAssistantState = {
  panelOpen: false,
  connection: AI_CONNECTION_STATES.UNCHECKED,
  generation: AI_GENERATION_STATES.DISABLED,
  answer: "",
  error: "",
  requestId: 0,
  requestNoteId: null,
  requestNoteTitle: "",
  requestPurpose: "question",
  referenceMode: AI_REFERENCE_MODES.NONE,
  reference: emptyAiReference(),
  selectedTextSnapshot: "",
  specifiedNoteId: null,
  collectionId: null,
  history: []
};
const enqueueAttachmentAddition = createKeyedSerialQueue();
const pendingAttachmentAdditions = new Map();

function mountContextPanel() {
  if (!contextPanel) return;
  contextPanel.append(collectionExplorer, aiPanel, memoSidebar);
  setContextPanelTab("collection", { focus: false });
}

// ページ読み込み後、すぐにアプリを起動します。
if (!isPopoutWindow) mountContextPanel();
init();
memoSyncChannel?.addEventListener("message", (event) => {
  refreshMemoFromOtherWindow(event.data).catch((error) => console.warn("Memo sync failed", error));
});

// 起動処理。DBを開き、初期メモを用意し、今日メモを開いて即入力できる状態にします。
async function init() {
  console.log(`Memo Nexus v${APP_VERSION} "${APP_LABEL}" (${APP_BUILD})`);
  console.log("Memo Nexus URL:", location.href);
  appVersionDisplays.forEach((element) => {
    element.textContent = `v${APP_VERSION} "${APP_LABEL}"`;
  });
  restoreTheme();
  restoreLogoAnimationSetting();
  if (isPopoutWindow) document.body.classList.add("popout-window");
  if (isPopoutWindow) {
    await initPopout();
    return;
  }
  restoreImageBlockSize();
  scheduleInitialLogoAnimation();
  restoreCollectionSortOrder();
  restoreGlobalFontSettings();
  restoreAiSettings();
  consumeReturnedFontSelection();
  initializeResponsiveLayout();
  renderAiSettings();
  renderAiUi();

  const localStorageAvailable = checkLocalStorageAvailable();
  db = await openDb();
  collections = await getAllCollections();
  await ensureInitialCollections();
  notes = await getAllNotes();
  await migrateLegacyNotesToUnclassified();
  notes = await getAllNotes();
  console.log("IndexedDB notes count:", notes.length);
  warnIfStorageRisky(localStorageAvailable, notes.length);
  const restoredDraftId = await restoreCurrentDraftMirror();
  if (restoredDraftId) {
    notes = await getAllNotes();
  }
  await ensureStartupNotes();
  validatePendingFontSelectionMemo();
  renderAll();
  const returnedNote = pendingFontSelection?.memoId && notes.find((note) => note.id === pendingFontSelection.memoId);
  const restoredNote = restoredDraftId && notes.find((note) => note.id === restoredDraftId);
  openNote(returnedNote?.id || restoredNote?.id || getTodayNote().id);
  if (restoredNote && !returnedNote) {
    saveStatus.textContent = "前回の編集中メモを復元しました";
  }
  if (pendingFontSelection || fontSelectionMessage) {
    await openSettingsDialog();
  }
  if (!settingsDialog.open) {
    titleInput.focus();
    titleInput.select();
  }
}

// localStorageへ試し書きし、現在の保存領域で利用できるかを確認します。
function checkLocalStorageAvailable() {
  try {
    const key = "memo-nexus-storage-test";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn("localStorage unavailable", error);
    return false;
  }
}

// 保存領域が分かれている可能性を断定せず、必要な場合だけ画面上へ注意を表示します。
function warnIfStorageRisky(localStorageAvailable, noteCount) {
  if (!storageWarning) return;

  if (!localStorageAvailable) {
    storageWarning.textContent = "保存注意: この環境ではドラフト退避を利用できません。プライベートブラウズ、別タブグループ、ホーム画面版とSafari版の違いにより、メモが残らない・別保存になる場合があります。通常ブラウズ、または同じホーム画面アイコンから開いて使ってください。";
    storageWarning.hidden = false;
    storageWarning.classList.add("storage-warning-strong");
    return;
  }

  if (noteCount <= 1) {
    storageWarning.textContent = "保存注意：プライベートブラウズで開いている可能性があります。\n通常ブラウズ側のメモとは別に保存される場合があります。\nいつもと同じ開き方で開き直してください。";
    storageWarning.hidden = false;
    storageWarning.classList.remove("storage-warning-strong");
    return;
  }

  storageWarning.hidden = true;
  storageWarning.textContent = "";
  storageWarning.classList.remove("storage-warning-strong");
}

function restoreTheme() {
  let savedTheme = "light";
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      savedTheme = storedTheme;
    }
  } catch (error) {
    console.warn("Theme restore failed", error);
  }

  applyTheme(savedTheme);
}

function currentTheme() {
  return document.body.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("dark", nextTheme === "dark");
  if (themeSelect) {
    themeSelect.value = nextTheme;
  }
}

function saveTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const previousTheme = currentTheme();
  applyTheme(nextTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    console.warn("Theme save failed", error);
  }
  if (nextTheme !== previousTheme) renderPreview();
}

function restoreImageBlockSize() {
  let savedSize = "medium";
  try {
    savedSize = normalizeImageBlockSize(localStorage.getItem(IMAGE_BLOCK_SIZE_STORAGE_KEY));
  } catch (error) {
    console.warn("Image block size restore failed", error);
  }
  applyImageBlockSize(savedSize);
}

function applyImageBlockSize(value) {
  imageBlockSize = normalizeImageBlockSize(value);
  if (imageBlockSizeSelect) imageBlockSizeSelect.value = imageBlockSize;
  if (preview) preview.dataset.imageSize = imageBlockSize;
}

function saveImageBlockSize(value) {
  applyImageBlockSize(value);
  try {
    localStorage.setItem(IMAGE_BLOCK_SIZE_STORAGE_KEY, imageBlockSize);
  } catch (error) {
    console.warn("Image block size save failed", error);
  }
  renderPreview();
}

function normalizeCollectionSortOrder(value) {
  return value === "oldest" ? "oldest" : "newest";
}

function applyCollectionSortOrder(value) {
  collectionSortOrder = normalizeCollectionSortOrder(value);
  if (collectionSortSelect) collectionSortSelect.value = collectionSortOrder;
}

function restoreCollectionSortOrder() {
  let savedOrder = "newest";
  try {
    savedOrder = normalizeCollectionSortOrder(localStorage.getItem(COLLECTION_SORT_STORAGE_KEY));
  } catch (error) {
    console.warn("Collection sort restore failed", error);
  }
  applyCollectionSortOrder(savedOrder);
}

function saveCollectionSortOrder(value) {
  applyCollectionSortOrder(value);
  try {
    localStorage.setItem(COLLECTION_SORT_STORAGE_KEY, collectionSortOrder);
  } catch (error) {
    console.warn("Collection sort save failed", error);
  }
  renderCollectionExplorer();
}

function layoutModeForWidth(width) {
  if (width < 720) return "mobile";
  if (width < 1040) return "compact";
  return "wide";
}

function initializeResponsiveLayout() {
  syncLayoutMode(true);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || document.body.clientWidth;
      syncLayoutMode(false, width);
    });
    observer.observe(document.body);
  }
}

function restoreLogoAnimationSetting() {
  let savedSetting = "daily";
  try {
    savedSetting = normalizeLogoAnimation(localStorage.getItem(LOGO_ANIMATION_STORAGE_KEY));
  } catch (error) {
    console.warn("Logo animation restore failed", error);
  }
  applyLogoAnimationSetting(savedSetting);
}

function applyLogoAnimationSetting(value) {
  logoAnimationSetting = normalizeLogoAnimation(value);
  if (logoAnimationSelect) logoAnimationSelect.value = logoAnimationSetting;
  updateLogoAnimationLabel();
}

function saveLogoAnimationSetting(value) {
  applyLogoAnimationSetting(value);
  logoAnimationSessionOverride = null;
  updateLogoAnimationLabel();
  try {
    localStorage.setItem(LOGO_ANIMATION_STORAGE_KEY, logoAnimationSetting);
  } catch (error) {
    console.warn("Logo animation save failed", error);
  }
  if (logoAnimationSetting === "off") finishLogoAnimation();
}

function currentLogoAnimation() {
  return logoAnimationSessionOverride || resolveLogoAnimation(logoAnimationSetting);
}

function updateLogoAnimationLabel() {
  if (!memoNexusLogo) return;
  if (logoAnimationSetting === "off") {
    memoNexusLogo.setAttribute("aria-label", "ロゴアニメーションはオフです");
    return;
  }
  memoNexusLogo.setAttribute("aria-label", "次のロゴアニメーションを表示（現在: " + currentLogoAnimation() + "）");
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finishLogoAnimation() {
  if (!memoNexusLogo) return;
  logoAnimationRequestId += 1;
  window.clearTimeout(logoAnimationCleanupTimer);
  logoAnimationCleanupTimer = null;
  memoNexusLogo.classList.remove("is-animating");
  delete memoNexusLogo.dataset.logoAnimation;
}

function playLogoAnimation(animation = currentLogoAnimation()) {
  if (!memoNexusLogo) return;
  if (animation === "off") return;

  finishLogoAnimation();
  memoNexusLogo.dataset.logoAnimation = animation;
  if (prefersReducedMotion()) return;
  const requestId = ++logoAnimationRequestId;
  requestAnimationFrame(() => {
    if (requestId === logoAnimationRequestId) memoNexusLogo.classList.add("is-animating");
  });
  logoAnimationCleanupTimer = window.setTimeout(finishLogoAnimation, 1400);
}

function cycleLogoAnimation() {
  if (logoAnimationSetting === "off") return;
  logoAnimationSessionOverride = nextLogoAnimationInCycle(currentLogoAnimation());
  updateLogoAnimationLabel();
  playLogoAnimation(logoAnimationSessionOverride);
}

function scheduleInitialLogoAnimation() {
  if (logoInitialAnimationScheduled) return;
  logoInitialAnimationScheduled = true;
  requestAnimationFrame(playLogoAnimation);
}

function syncLayoutMode(force = false, width = document.body.clientWidth) {
  const nextMode = layoutModeForWidth(width);
  if (!force && nextMode === layoutMode) return;

  layoutMode = nextMode;
  mobileCardOpen = false;
  compactCardVisible = true;
  document.body.dataset.layoutMode = layoutMode;
  document.body.classList.remove("mobile-card-open", "compact-card-hidden");
  updateResponsiveLayoutUi();
  if (layoutMode === "wide" && !contextPanelOpen && !contextPanelUserClosed) {
    setContextPanelOpen(true, { restoreFocus: false, explicit: false });
    setAiAssistantPanelActive(contextPanelTab === "ai");
  }
}

function setContextPanelOpen(open, { restoreFocus = true, explicit = true } = {}) {
  let focusTarget = null;
  contextPanelOpen = Boolean(open);
  if (contextPanelOpen) contextPanelUserClosed = false;
  else if (explicit) contextPanelUserClosed = true;
  contextPanel?.classList.toggle("context-panel-closed", !contextPanelOpen);
  document.body.classList.toggle("context-panel-closed", !contextPanelOpen);
  contextPanel?.setAttribute("aria-hidden", String(!contextPanelOpen));
  if (!contextPanelOpen) {
    contextPanel?.setAttribute("inert", "");
    if (aiAssistantState.panelOpen) setAiAssistantPanelActive(false);
    if (restoreFocus && layoutMode !== "wide") {
      focusTarget = contextPanelTab === "ai" ? aiRobotBtn : contextPanelTab === "memo-list" ? memoPaneBtn : collectionsBtn;
    }
  } else {
    contextPanel?.removeAttribute("inert");
  }
  updateResponsiveLayoutUi();
  focusTarget?.focus();
}

function setContextPanelTab(tab, { focus = true } = {}) {
  const nextTab = ["collection", "ai", "memo-list"].includes(tab) ? tab : "collection";
  contextPanelTab = nextTab;
  setContextPanelOpen(true, { restoreFocus: false });
  const panels = [
    ["collection", collectionExplorer, contextCollectionTab],
    ["ai", aiPanel, contextAiTab],
    ["memo-list", memoSidebar, contextMemoListTab]
  ];
  panels.forEach(([id, panel, button]) => {
    const selected = id === nextTab;
    if (panel) {
      panel.hidden = !selected;
      panel.setAttribute("aria-hidden", String(!selected));
      panel.inert = !selected;
    }
    button?.setAttribute("aria-selected", String(selected));
    button?.classList.toggle("active", selected);
  });
  setAiAssistantPanelActive(nextTab === "ai");
  collectionsBtn?.setAttribute("aria-expanded", String(nextTab === "collection"));
  if (nextTab === "collection") renderCollectionExplorer();
  if (nextTab === "memo-list") renderMemoListPanel();
  if (focus) {
    const button = nextTab === "collection" ? contextCollectionTab : nextTab === "ai" ? contextAiTab : contextMemoListTab;
    button?.focus();
  }
}

function setAiAssistantPanelActive(active) {
  aiAssistantState.panelOpen = Boolean(active);
  document.body.classList.toggle("ai-open", aiAssistantState.panelOpen);
  aiPanel.setAttribute("aria-hidden", String(!aiAssistantState.panelOpen));
  aiPanel.inert = !aiAssistantState.panelOpen;
  aiRobotBtn.setAttribute("aria-expanded", String(aiAssistantState.panelOpen));
  aiRobotBtn.setAttribute("aria-label", aiAssistantState.panelOpen ? "AIアシスタントを閉じる" : "AIアシスタントを開く");
  aiBackdrop.hidden = true;
}

function renderMemoListPanel() {
  renderList();
  if (memoListCount) {
    const total = activeNotes().length;
    memoListCount.textContent = String(total);
    memoListCount.hidden = total === 0;
  }
}

function setMemoListPanelOpen(open, { restoreFocus = true } = {}) {
  if (open) {
    mobileCardOpen = false;
    setContextPanelTab("memo-list", { focus: false });
    setRelatedDrawerOpen(false, { restoreFocus: false });
  } else if (contextPanelTab === "memo-list") {
    setContextPanelOpen(false, { restoreFocus: false });
  }
  updateResponsiveLayoutUi();
  if (open) focusLayoutPanel(memoSidebar);
  else if (restoreFocus) memoPaneBtn.focus();
}

function setCardPaneOpen(open, { restoreFocus = true } = {}) {
  if (layoutMode === "wide") return;
  if (layoutMode === "compact") {
    compactCardVisible = Boolean(open);
  } else {
    mobileCardOpen = Boolean(open);
    if (mobileCardOpen) {
      setContextPanelOpen(false, { restoreFocus: false, explicit: false });
      setRelatedDrawerOpen(false, { restoreFocus: false });
    }
  }
  updateResponsiveLayoutUi();
  if (layoutMode === "mobile" && mobileCardOpen) focusLayoutPanel(previewCard);
  else if (restoreFocus) cardPaneBtn.focus();
}

function closeLayoutOverlays({ restoreFocus = true } = {}) {
  if (layoutMode !== "wide" && contextPanelOpen) {
    setContextPanelOpen(false, { restoreFocus });
    return true;
  }
  if (mobileCardOpen) {
    setCardPaneOpen(false, { restoreFocus });
    return true;
  }
  return false;
}

function updateResponsiveLayoutUi() {
  const cardVisible = layoutMode === "wide"
    || (layoutMode === "compact" && compactCardVisible)
    || (layoutMode === "mobile" && mobileCardOpen);
  const contextPanelOverlayOpen = layoutMode !== "wide" && contextPanelOpen;
  const overlayOpen = contextPanelOverlayOpen || (layoutMode === "mobile" && mobileCardOpen);

  document.body.classList.toggle("mobile-card-open", layoutMode === "mobile" && mobileCardOpen);
  document.body.classList.toggle("compact-card-hidden", layoutMode === "compact" && !compactCardVisible);
  document.body.classList.toggle("layout-overlay-open", overlayOpen);

  const memoListVisible = contextPanelOpen && contextPanelTab === "memo-list";
  memoPaneBtn.setAttribute("aria-expanded", String(memoListVisible));
  memoPaneBtn.title = memoListVisible ? "メモ一覧を閉じる" : "メモ一覧を表示";
  memoPaneBtn.setAttribute("aria-label", memoPaneBtn.title);

  previewCard.setAttribute("aria-hidden", String(!cardVisible));
  previewCard.inert = !cardVisible || contextPanelOverlayOpen;
  cardPaneBtn.setAttribute("aria-expanded", String(cardVisible));
  const cardAction = layoutMode === "compact" && cardVisible ? "カード表示を収納する" : cardVisible ? "カード表示を閉じる" : "カード表示を開く";
  cardPaneBtn.title = cardAction;
  cardPaneBtn.setAttribute("aria-label", cardAction);
  cardPaneButtonLabel.textContent = cardVisible ? "カードを閉じる" : "カードを表示";

  layoutBackdrop.hidden = !overlayOpen;
  editorCard.inert = overlayOpen;
  appHeader.inert = overlayOpen;
}

function focusLayoutPanel(panel) {
  requestAnimationFrame(() => {
    const target = panel.querySelector("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])");
    if (target) target.focus();
  });
}

// IndexedDBを開きます。初回起動時だけnotesストアと検索用indexを作ります。
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("title", "title");
      }
      if (!database.objectStoreNames.contains(COLLECTION_STORE_NAME)) {
        const collectionStore = database.createObjectStore(COLLECTION_STORE_NAME, { keyPath: "id" });
        collectionStore.createIndex("parentId", "parentId");
        collectionStore.createIndex("sortOrder", "sortOrder");
      }
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) {
        const attachmentStore = database.createObjectStore(ATTACHMENT_STORE_NAME, { keyPath: "id" });
        attachmentStore.createIndex("memoId", "memoId");
        attachmentStore.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// IndexedDBの操作単位を作る関数。readonlyは読み取り、readwriteは保存用です。
function tx(mode = "readonly") {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

// 保存済みメモをすべて読み込み、更新日時が新しい順に並べます。
function getAllNotes() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}

// メモを1件保存します。idが同じなら上書き、なければ新規追加になります。
function putNote(note) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(note);
    transaction.oncomplete = () => {
      notifyMemoChanged(note);
      resolve(note);
    };
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

function attachmentTx(mode = "readonly") {
  return db.transaction(ATTACHMENT_STORE_NAME, mode).objectStore(ATTACHMENT_STORE_NAME);
}

function getAttachmentsForMemo(memoId) {
  return new Promise((resolve, reject) => {
    const request = attachmentTx().index("memoId").getAll(memoId);
    request.onsuccess = () => resolve(request.result.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
    request.onerror = () => reject(request.error);
  });
}

function putAttachments(items) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ATTACHMENT_STORE_NAME);
    items.forEach((item) => store.put(item));
    transaction.oncomplete = () => resolve(items);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function deleteAttachmentRecord(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
    const request = transaction.objectStore(ATTACHMENT_STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

function deleteAttachmentRecords(ids) {
  const targets = new Set(Array.isArray(ids) ? ids : []);
  if (!targets.size) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ATTACHMENT_STORE_NAME);
    targets.forEach((id) => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function collectionTx(mode = "readonly") {
  return db.transaction(COLLECTION_STORE_NAME, mode).objectStore(COLLECTION_STORE_NAME);
}

function getAllCollections() {
  return new Promise((resolve, reject) => {
    const request = collectionTx().getAll();
    request.onsuccess = () => resolve(request.result.sort(compareCollections));
    request.onerror = () => reject(request.error);
  });
}

function putCollection(collection) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COLLECTION_STORE_NAME, "readwrite");
    const request = transaction.objectStore(COLLECTION_STORE_NAME).put(collection);
    transaction.oncomplete = () => resolve(collection);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

function deleteCollectionRecord(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COLLECTION_STORE_NAME, "readwrite");
    const request = transaction.objectStore(COLLECTION_STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

function activeNotes() {
  return notes.filter((note) => !note.deletedAt);
}

function initialCollections() {
  const now = new Date().toISOString();
  return [
    ["collection-history", "歴史", 10],
    ["collection-programming", "プログラミング", 20],
    ["collection-it", "IT技術", 30],
    ["collection-technology-history", "技術史", 40],
    ["collection-trivia", "雑学", 50],
    [UNCLASSIFIED_COLLECTION_ID, "未分類", 100000]
  ].map(([id, name, sortOrder]) => ({
    id,
    name,
    parentId: null,
    sortOrder,
    isSystem: id === UNCLASSIFIED_COLLECTION_ID,
    createdAt: now,
    updatedAt: now
  }));
}

async function ensureInitialCollections() {
  const existingIds = new Set(collections.map((collection) => collection.id));
  for (const collection of initialCollections()) {
    if (!existingIds.has(collection.id)) await putCollection(collection);
  }
  collections = await getAllCollections();
}

async function migrateLegacyNotesToUnclassified() {
  const legacy = notes.filter((note) => !collectionExists(note.collectionId) || !Object.prototype.hasOwnProperty.call(note, "deletedAt"));
  if (!legacy.length) return;

  await updateNotesTransaction(legacy.map((note) => ({
    ...note,
    collectionId: collectionExists(note.collectionId) ? note.collectionId : UNCLASSIFIED_COLLECTION_ID,
    deletedAt: note.deletedAt || null
  })));
  console.log("Collection migration", { assignedToUnclassified: legacy.length });
}

function updateNotesTransaction(items) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    items.forEach((note) => store.put(note));
    transaction.oncomplete = () => {
      items.forEach((note) => notifyMemoChanged(note));
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function collectionExists(id) {
  return collections.some((collection) => collection.id === id);
}

function compareCollections(a, b) {
  return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), "ja");
}

function deleteNote(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

// 現在編集中の1件だけを、IndexedDB保存前の保険としてlocalStorageへ退避します。
function saveCurrentDraftMirror() {
  const note = currentNote();
  if (!note) return;

  const now = Date.now();
  const draft = {
    id: note.id,
    title: titleInput.value || titleFromBody(editor.value) || "無題メモ",
    body: editor.value,
    collectionId: note.collectionId || UNCLASSIFIED_COLLECTION_ID,
    deletedAt: note.deletedAt || null,
    createdAt: note.createdAt || now,
    bodyUpdatedAt: now,
    updatedAt: now,
    draftSavedAt: now
  };

  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    console.log("Draft mirror saved", { id: draft.id, title: draft.title });
  } catch (error) {
    console.warn("Draft mirror save failed", error);
  }
}

// IndexedDBより新しいドラフトだけを復元し、古すぎるものは削除します。
async function restoreCurrentDraftMirror() {
  let rawDraft;
  try {
    rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
  } catch (error) {
    console.warn("Draft mirror read failed", error);
    return null;
  }

  if (!rawDraft) return null;

  let draft;
  try {
    draft = JSON.parse(rawDraft);
  } catch (error) {
    console.warn("Draft mirror parse failed", error);
    return null;
  }

  if (!draft || typeof draft !== "object" || !draft.id) return null;

  const now = Date.now();
  const draftSavedAt = Number(draft.draftSavedAt);
  if (Number.isFinite(draftSavedAt) && now - draftSavedAt >= DRAFT_MAX_AGE_MS) {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      console.log("Old draft mirror removed", { id: draft.id });
    } catch (error) {
      console.warn("Old draft mirror removal failed", error);
    }
    return null;
  }

  const existingNote = notes.find((note) => note.id === draft.id);
  if (existingNote && (!Number.isFinite(draftSavedAt) || draftSavedAt <= Number(existingNote.updatedAt || 0))) {
    return null;
  }

  const draftUpdatedAt = Number(draft.updatedAt);
  const restoredUpdatedAt = Math.max(
    Number.isFinite(draftUpdatedAt) ? draftUpdatedAt : 0,
    Number.isFinite(draftSavedAt) ? draftSavedAt : now
  );
  const restoredNote = {
    ...(existingNote || {}),
    id: draft.id,
    title: String(draft.title || "無題メモ"),
    body: String(draft.body || ""),
    collectionId: collectionExists(draft.collectionId || existingNote?.collectionId)
      ? (draft.collectionId || existingNote.collectionId)
      : UNCLASSIFIED_COLLECTION_ID,
    deletedAt: draft.deletedAt || existingNote?.deletedAt || null,
    createdAt: draft.createdAt || existingNote?.createdAt || now,
    bodyUpdatedAt: draft.bodyUpdatedAt || restoredUpdatedAt,
    updatedAt: restoredUpdatedAt
  };

  await putNote(restoredNote);
  console.log("Draft mirror restored", { id: restoredNote.id, title: restoredNote.title });
  return restoredNote.id;
}

// 削除したメモが次回起動時にドラフトから復活しないよう、一致する1件だけを消します。
function removeDraftMirrorForNote(id) {
  try {
    const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!rawDraft) return;
    const draft = JSON.parse(rawDraft);
    if (draft?.id === id) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Draft mirror removal failed", error);
  }
}

async function importAiNewsFile(file) {
  if (!file) return;

  await saveCurrentNote();
  const text = await file.text();
  const imported = parseImportedNote(file.name, text);
  const note = await createNote(imported.title, imported.body);
  notes = await getAllNotes();
  renderAll();
  openNote(note.id);
  saveStatus.textContent = "AI朝刊を取り込みました";
}

async function importPastedItNewsJson() {
  clearJsonImportError();
  const text = jsonImportText.value.trim();
  if (!text) {
    showJsonImportError("JSONを貼り付けてください。");
    return;
  }

  let built;
  try {
    built = parsePastedJson(text);
  } catch (error) {
    showJsonImportError(error.message);
    return;
  }

  try {
    await saveCurrentNote();
    const note = await createNote(built.title, built.body);
    notes = await getAllNotes();
    renderAll();
    openNote(note.id);
    closeJsonImportDialog();
    saveStatus.textContent = built.importMessage || "JSONから1件のメモを作成しました";
    jsonImportText.value = "";
  } catch (error) {
    showJsonImportError(`保存に失敗しました: ${error.message}`);
  }
}

function parsePastedJson(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("JSONの読み込みに失敗しました。JSONの構文を確認してください。");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JSONのルートはオブジェクトにしてください。");
  }

  if (isLangBenchResultJson(payload)) {
    return {
      ...buildLangBenchResultNote(payload),
      importMessage: "LangBench Result を取り込みました。"
    };
  }

  if (Array.isArray(payload.items)) {
    return {
      ...buildItNewsNotes(validateItNewsJsonPayload(payload)),
      importMessage: "JSONから1件のニュースメモを作成しました"
    };
  }

  throw new Error("対応していないJSON形式です。items配列を持つニュースJSON、または type: \"langbench_result\" を持つLangBench結果JSONを貼り付けてください。");
}

function parseItNewsJson(text) {
  try {
    const payload = JSON.parse(text);
    return validateItNewsJsonPayload(payload);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`JSONの解析に失敗しました: ${error.message}`);
    }
    throw error;
  }
}

function validateItNewsJsonPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JSONのルートはオブジェクトにしてください。");
  }
  if (!Array.isArray(payload.items)) {
    throw new Error("items が存在しない、または配列ではありません。");
  }
  if (!payload.items.length) {
    throw new Error("items にニュースがありません。");
  }
  return payload;
}

function buildItNewsNotes(payload) {
  const date = pickFirstString(payload, ["date", "publishedAt", "day", "日付"]) || todayStampDashed();
  const baseTitle = pickFirstString(payload, ["title", "heading", "headline", "見出し", "name"]) || "ニュースメモ";
  const title = `${baseTitle} ${date}`;
  const trendSummary = pickFirstTextLines(payload, ["trend_summary", "trendSummary", "summary", "overview", "全体傾向"]);
  const items = payload.items.map(normalizeItNewsItem);
  const missingHeadingIndex = items.findIndex((item) => !item.heading);
  if (missingHeadingIndex >= 0) {
    throw new Error(`items[${missingHeadingIndex}] の見出しが空です。`);
  }

  return {
    title,
    body: buildItNewsParentBody(title, date, trendSummary, items)
  };
}

function normalizeItNewsItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const sourceValue = source.source && typeof source.source === "object" ? source.source : {};
  return {
    heading: pickFirstString(source, ["title", "heading", "headline", "見出し"]),
    category: pickFirstString(source, ["category", "カテゴリ"]),
    period: pickFirstString(source, ["period", "era", "時代", "期間"]),
    importance: pickFirstString(source, ["importance", "重要度"]),
    urgency: pickFirstString(source, ["urgency", "緊急度"]),
    summary: pickFirstTextLines(source, ["summary", "overview", "points", "keyPoints", "details", "要点"]),
    impact: pickFirstTextLines(source, ["impact", "whyImportant", "why", "実務への影響", "なぜ重要か"]),
    sourceLabel: pickFirstString(source, ["sourceLabel", "source", "情報源"]) || pickFirstString(sourceValue, ["label", "title", "name"]),
    sourceUrl: pickFirstString(source, ["sourceUrl", "url", "link", "情報源リンク"]) || pickFirstString(sourceValue, ["url", "link"]),
    tags: normalizeTags(source.tags || source["カテゴリタグ"])
  };
}

function buildItNewsParentBody(title, date, trendSummary, items) {
  const body = [
    `# ${title}`,
    "",
    `日付: ${date}`,
    ""
  ];

  items.forEach((item, index) => {
    body.push(`${index + 1}. ${item.heading}`, "");

    appendBulletIfPresent(body, "カテゴリ", item.category);
    appendBulletIfPresent(body, "時代", item.period);
    appendBulletIfPresent(body, "重要度", item.importance);
    appendBulletIfPresent(body, "緊急度", item.urgency);
    appendBulletIfPresent(body, "タグ", formatTags(item.tags));
    item.summary.forEach((line) => body.push(`- ${line}`));
    item.impact.forEach((line) => body.push(`- なぜ重要か: ${line}`));

    const sourceLine = formatSource(item);
    if (sourceLine) {
      body.push(`- 情報源: ${sourceLine}`);
    }

    body.push("");
  });

  if (trendSummary.length) {
    body.push("## 全体傾向", "");
    appendTextLines(body, trendSummary);
    body.push("");
  }

  return body.join("\n").trim();
}

function pickFirstString(source, keys) {
  const value = pickFirstValue(source, keys);
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(value).trim();
}

function pickFirstTextLines(source, keys) {
  for (const key of keys) {
    const lines = normalizeTextLines(source?.[key]);
    if (lines.length) return lines;
  }
  return [];
}

function pickFirstValue(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return "";
}

function normalizeTextLines(value) {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeTextLines);
  }
  if (value === null || value === undefined) return [];
  if (typeof value === "object") {
    return [JSON.stringify(value)];
  }
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function appendTextLines(body, lines) {
  lines.forEach((line) => body.push(line));
}

function appendBulletIfPresent(body, label, value) {
  if (value) {
    body.push(`- ${label}: ${value}`);
  }
}

function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,、]+/);
  return [...new Set(rawTags
    .map((tag) => String(tag).replace(/^#/, "").trim())
    .filter(Boolean))];
}

function formatTags(tags) {
  return tags.map((tag) => `#${tag.replace(/\s+/g, "")}`).join(" ");
}

function formatSource(item) {
  if (item.sourceLabel && item.sourceUrl) {
    return `${item.sourceLabel} (${item.sourceUrl})`;
  }
  return item.sourceLabel || item.sourceUrl || "";
}

function isLangBenchResultJson(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    payload.type === "langbench_result"
  );
}

function buildLangBenchResultNote(payload) {
  return {
    title: buildLangBenchNoteTitle(payload),
    body: buildLangBenchNoteBody(payload)
  };
}

function buildLangBenchNoteTitle(payload) {
  const benchmark = langBenchText(payload.benchmark || payload.experiment || "unknown_benchmark", "unknown_benchmark");
  const language = langBenchText(payload.language || "unknown_language", "unknown_language");
  const createdAt = langBenchText(payload.created_at || new Date().toISOString(), new Date().toISOString());
  return `LangBench: ${benchmark} / ${language} / ${createdAt}`;
}

function buildLangBenchNoteBody(payload) {
  const benchmark = langBenchText(payload.benchmark || payload.experiment || "unknown_benchmark", "unknown_benchmark");
  const language = langBenchText(payload.language || "unknown_language", "unknown_language");
  const execution = payload.execution && typeof payload.execution === "object" ? payload.execution : {};
  const runtime = payload.runtime && typeof payload.runtime === "object" ? payload.runtime : {};
  const engine = payload.engine && typeof payload.engine === "object" ? payload.engine : {};
  const environment = payload.environment && typeof payload.environment === "object" ? payload.environment : {};
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};

  const body = [
    `# LangBench Result: ${benchmark} / ${language}`,
    "",
    "## Basic Info",
    `- Project: ${langBenchValue(payload.project)}`,
    `- Benchmark: ${langBenchValue(payload.benchmark)}`,
    `- Experiment: ${langBenchValue(payload.experiment)}`,
    `- Language: ${langBenchValue(payload.language)}`,
    `- Created: ${langBenchValue(payload.created_at)}`,
    `- Status: ${langBenchValue(payload.status)}`,
    `- Schema version: ${langBenchValue(payload.schema_version)}`,
    "",
    "## Runtime / Engine",
    `- Runtime: ${langBenchValue(runtime.name || engine.runtime)}`,
    `- Runtime version: ${langBenchValue(runtime.version)}`,
    `- Node version: ${langBenchValue(engine.node_version)}`,
    `- V8 version: ${langBenchValue(engine.v8_version)}`,
    "",
    "## Execution",
    `- Runner: ${langBenchValue(execution.runner)}`,
    `- Runner label: ${langBenchValue(execution.runner_label)}`,
    `- CWD: ${langBenchValue(execution.cwd)}`,
    `- Command: ${langBenchValue(execution.command)}`,
    `- Script path: ${langBenchValue(execution.script_path)}`,
    `- Output file: ${langBenchValue(payload.output_file)}`,
    "",
    "## Environment",
    `- OS: ${langBenchValue(environment.os_name)}`,
    `- OS platform: ${langBenchValue(environment.os_platform)}`,
    `- OS version: ${langBenchValue(environment.os_version)}`,
    `- CPU model: ${langBenchValue(environment.cpu_model)}`,
    `- CPU threads: ${langBenchValue(environment.cpu_threads)}`,
    `- Memory total bytes: ${langBenchValue(environment.memory_total_bytes)}`,
    "",
    "## Benchmark Settings",
    `- Array size: ${langBenchValue(payload.array_size)}`,
    `- Iterations: ${langBenchValue(payload.iterations)}`,
    `- Setup ms: ${langBenchValue(payload.setup_ms)}`,
    `- Expected checksum: ${langBenchValue(payload.expected_checksum)}`,
    "",
    "## Summary",
    `- Count: ${langBenchValue(summary.count)}`,
    `- Average ms: ${langBenchValue(summary.average_ms)}`,
    `- Median ms: ${langBenchValue(summary.median_ms)}`,
    `- Fastest ms: ${langBenchValue(summary.fastest_ms)}`,
    `- Slowest ms: ${langBenchValue(summary.slowest_ms)}`,
    "",
    "## Observations",
    buildLangBenchObservations(payload),
    "",
    "## Results Detail",
    buildLangBenchResultsTable(payload.results),
    "",
    "## Raw JSON",
    "```json",
    JSON.stringify(payload, null, 2),
    "```"
  ];

  return body.join("\n").trim();
}

function buildLangBenchObservations(payload) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (!results.length) {
    return "results 配列がないため、iteration ごとの詳細分析はできません。";
  }

  const elapsedRows = results
    .map((result, index) => ({
      index,
      elapsedMs: langBenchNumber(result && typeof result === "object" ? result.elapsed_ms : undefined)
    }))
    .filter((row) => row.elapsedMs !== null);
  const firstRow = elapsedRows.find((row) => row.index === 0);
  const afterFirst = elapsedRows.filter((row) => row.index > 0).map((row) => row.elapsedMs);
  const afterFirstAverage = afterFirst.length ? averageNumbers(afterFirst) : null;
  const expectedChecksum = payload.expected_checksum;
  const hasExpectedChecksum = expectedChecksum !== null && expectedChecksum !== undefined && expectedChecksum !== "";
  const checksumMismatchCount = hasExpectedChecksum
    ? results.filter((result) => {
      if (!result || typeof result !== "object") return false;
      if (result.checksum === null || result.checksum === undefined) return false;
      return String(result.checksum) !== String(expectedChecksum);
    }).length
    : null;
  const firstGap = firstRow && afterFirstAverage !== null ? firstRow.elapsedMs - afterFirstAverage : null;

  const lines = [
    `- First iteration elapsed ms: ${firstRow ? formatLangBenchNumber(firstRow.elapsedMs) : ""}`,
    `- Average ms after first iteration: ${afterFirstAverage === null ? "not enough data" : formatLangBenchNumber(afterFirstAverage)}`,
    `- Fastest ms after first iteration: ${afterFirst.length ? formatLangBenchNumber(Math.min(...afterFirst)) : "not enough data"}`,
    `- Slowest ms after first iteration: ${afterFirst.length ? formatLangBenchNumber(Math.max(...afterFirst)) : "not enough data"}`,
    `- First iteration gap: ${firstGap === null ? "not enough data" : formatLangBenchNumber(firstGap)}`,
    `- Checksum mismatches: ${hasExpectedChecksum ? checksumMismatchCount : "unknown"}`,
    ""
  ];

  if (firstGap !== null && firstGap > 0) {
    lines.push("初回実行が2回目以降の平均より大きく、ウォームアップやJIT最適化前の影響を疑う余地があります。");
  }

  if (afterFirst.length >= 2 && Math.max(...afterFirst) !== Math.min(...afterFirst)) {
    lines.push("途中の elapsed_ms に変動があるため、実行環境や最適化状態の変化も含めて確認する価値があります。");
  }

  if (lines[lines.length - 1] === "") {
    lines.push("elapsed_ms の傾向は、実行環境や測定条件と合わせて確認してください。");
  }

  return lines.join("\n");
}

function buildLangBenchResultsTable(results) {
  if (!Array.isArray(results) || !results.length) {
    return "results がありません";
  }

  const rows = [
    "| Iteration | Elapsed ms | Checksum |",
    "|---:|---:|---:|"
  ];

  const visibleResults = results.length <= 200
    ? results.map((result) => ({ result }))
    : [
      ...results.slice(0, 100).map((result) => ({ result })),
      { omitted: true },
      ...results.slice(-100).map((result) => ({ result }))
    ];

  visibleResults.forEach((entry) => {
    if (entry.omitted) {
      rows.push("| ... | ... | ... |");
      return;
    }
    const result = entry.result && typeof entry.result === "object" ? entry.result : {};
    rows.push(`| ${langBenchTableValue(result.iteration)} | ${langBenchTableValue(result.elapsed_ms)} | ${langBenchTableValue(result.checksum)} |`);
  });

  return rows.join("\n");
}

function averageNumbers(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function langBenchNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function formatLangBenchNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

function langBenchText(value, fallback = "unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function langBenchValue(value) {
  return langBenchText(value, "unknown");
}

function langBenchTableValue(value) {
  if (value === null || value === undefined) return "";
  return langBenchText(value, "").replace(/\|/g, "\\|");
}

function openJsonImportDialog() {
  clearJsonImportError();
  jsonImportDialog.showModal();
  jsonImportText.focus();
}

function closeJsonImportDialog() {
  jsonImportDialog.close();
}

function showJsonImportError(message) {
  jsonImportError.textContent = message;
}

function clearJsonImportError() {
  jsonImportError.textContent = "";
}

function parseImportedNote(fileName, text) {
  const trimmed = text.trim();
  const fencedJson = extractJsonCodeBlock(text);
  if (fencedJson) {
    try {
      const payload = JSON.parse(fencedJson);
      return buildNewsNoteFromJson(fileName, payload);
    } catch (error) {
      // Fall through to other parsers when the fenced block is not valid JSON.
    }
  }

  const looksLikeJson = fileName.toLowerCase().endsWith(".json") || /^[\[{]/.test(trimmed);

  if (!looksLikeJson) {
    return buildPlainTextImport(fileName, text);
  }

  try {
    const payload = JSON.parse(text);
    return buildNewsNoteFromJson(fileName, payload);
  } catch (error) {
    return buildPlainTextImport(fileName, text);
  }
}

function buildPlainTextImport(fileName, text) {
  const base = fileName.replace(/\.[^.]+$/, "") || "AI news";
  return {
    title: uniqueTitle(base),
    body: text.trim() || "(empty import)"
  };
}

function extractJsonCodeBlock(text) {
  let match = text.match(/(?:^|\n)```json[ \t]*\n([\s\S]*?)\n```/i);
  if (!match) {
    match = text.match(/```json\s*([\s\S]*?)```/i);
  }
  return match ? match[1].trim() : "";
}

function buildNewsNoteFromJson(fileName, payload) {
  if (isLangBenchResultJson(payload)) {
    return buildLangBenchResultNote(payload);
  }

  const normalized = normalizeNewsPayload(payload);
  if (!normalized.items.length) {
    return buildPlainTextImport(fileName, JSON.stringify(payload, null, 2));
  }

  const heading = normalized.title || "AI最新ニュース朝刊";
  const noteDate = normalized.date || todayStampDashed();
  const body = [
    `# ${heading}`,
    "",
    `日付: ${noteDate}`,
    ""
  ];

  normalized.items.forEach((item, index) => {
    body.push(`${index + 1}. ${item.heading}`);
    body.push("");
    item.points.forEach((point) => body.push(`- ${point}`));
    if (item.whyImportant) {
      body.push(`- なぜ重要か: ${item.whyImportant}`);
    }
    if (item.sourceLabel || item.sourceUrl) {
      const label = item.sourceLabel || item.sourceUrl;
      body.push(`- 情報源: ${label}${item.sourceUrl ? ` (${item.sourceUrl})` : ""}`);
    }
    body.push("");
  });

  if (normalized.trendSummary) {
    body.push("## 全体傾向");
    body.push("");
    body.push(normalized.trendSummary);
    body.push("");
  }

  return {
    title: uniqueTitle(`AI朝刊 ${noteDate}`),
    body: body.join("\n").trim()
  };
}

function normalizeNewsPayload(payload) {
  const root = Array.isArray(payload) ? { items: payload } : (payload || {});
  const items = Array.isArray(root.items) ? root.items : Array.isArray(root.newsItems) ? root.newsItems : Array.isArray(root.articles) ? root.articles : [];

  return {
    title: root.title || root.headline || root.name || root["見出し"] || "",
    date: root.date || root.publishedAt || root.day || root["日付"] || "",
    trendSummary: root.trendSummary || root.summary || root.overview || root["全体傾向"] || "",
    items: items.map(normalizeNewsItem).filter((item) => item.heading)
  };
}

function normalizeNewsItem(item) {
  const points = []
    .concat(item.points || [])
    .concat(item.summary ? [item.summary] : [])
    .concat(item.keyPoints || [])
    .concat(item.details || [])
    .concat(item["要点"] || [])
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  return {
    heading: String(item.heading || item.title || item.headline || item["見出し"] || "").trim(),
    points,
    whyImportant: String(item.whyImportant || item.importance || item.why || item["なぜ重要か"] || "").trim(),
    sourceLabel: String(item.sourceLabel || item.source || item["情報源"] || "").trim(),
    sourceUrl: String(item.sourceUrl || item.url || item.link || item["情報源リンク"] || "").trim()
  };
}

// 起動時に最低限の「新規メモ」と「今日メモ」がある状態を保証します。
async function ensureStartupNotes() {
  if (!activeNotes().length) {
    await createNote("新規メモ", "");
  }

  if (!getTodayNote()) {
    await createNote(todayTitle(), `# ${todayTitle()}\n\n`);
  }

  notes = await getAllNotes();
}

// 今日の日付に対応する日次メモを探します。
function getTodayNote() {
  const title = todayTitle();
  return activeNotes().find((note) => note.title === title);
}

// 今日メモのタイトルを YYYY-MM-DD 今日メモ の形で作ります。
function todayTitle() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} 今日メモ`;
}

// 新しいメモを作ってIndexedDBへ保存します。
async function createNote(title = "新規メモ", body = "", options = {}) {
  const now = Date.now();
  const resolvedTitle = title || temporaryMemoTitle();
  const noteTitle = options.avoidDuplicateTitle === false
    ? resolvedTitle
    : uniqueTitle(resolvedTitle);
  const note = {
    id: crypto.randomUUID(),
    title: noteTitle,
    body,
    collectionId: resolveNewNoteCollection(options.collectionId),
    deletedAt: null,
    createdAt: now,
    bodyUpdatedAt: now,
    updatedAt: now
  };

  await putNote(note);
  notes.unshift(note);
  invalidateTermRelationIndex();
  return note;
}

function temporaryMemoTitle() {
  return `memo${activeNotes().length + 1}`;
}

function resolveNewNoteCollection(requestedId) {
  const candidate = requestedId || selectedCollectionId;
  if (!candidate || candidate === "trash" || candidate === UNCLASSIFIED_COLLECTION_ID) {
    return UNCLASSIFIED_COLLECTION_ID;
  }
  return collectionExists(candidate) ? candidate : UNCLASSIFIED_COLLECTION_ID;
}

// 同名タイトルがあるとリンク先が曖昧になるので、末尾に番号を付けて重複を避けます。
function uniqueTitle(base) {
  const clean = base || "無題メモ";
  const titles = new Set(activeNotes().map((note) => note.title));
  if (!titles.has(clean)) return clean;

  let index = 2;
  while (titles.has(`${clean} ${index}`)) index += 1;
  return `${clean} ${index}`;
}

// 画面全体の再描画をまとめて呼ぶ入口です。
function renderAll() {
  renderCollectionExplorer();
  renderMemoListPanel();
  renderNoteMeta();
  renderRelated();
  renderDiscovery();
  renderLinkStats();
  updateUndoButton();
}

// 左側のメモ一覧を描画します。検索欄に入力があればタイトル・本文から絞り込みます。
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const listView = buildMemoListView(notes, selectedCollectionId);
  renderMemoListHeading(listView.heading);
  const filtered = listView.notes.filter((note) => {
    const haystack = `${note.title}\n${note.body}`.toLowerCase();
    return !query || haystack.includes(query);
  }).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  memoList.innerHTML = "";
  const relations = currentTermRelationIndex();

  filtered.forEach((note) => {
    const relation = relations.byNoteId.get(note.id) || { terms: [] };
    const visibleTerms = relation.terms.slice(0, 4);
    const hiddenTermCount = relation.terms.length - visibleTerms.length;
    const item = document.createElement("div");
    item.className = `memo-item${note.id === currentId ? " active" : ""}${relation.terms.length ? " has-term-relations" : ""}`;
    item.innerHTML = `
      <div class="memo-title">${escapeHtml(note.title)}</div>
      <div class="memo-snippet">${escapeHtml(snippet(note.body))}</div>
      ${relation.terms.length ? `<div class="term-card-footer"><span class="term-accent-list" aria-hidden="true">${visibleTerms.map((entry) => `<i style="--term-color:${entry.color}"></i>`).join("")}${hiddenTermCount ? `<b>+${hiddenTermCount}</b>` : ""}</span><span class="term-chip-list">${visibleTerms.map((entry) => `<button type="button" class="term-chip" data-title="${escapeAttr(entry.term)}" data-term-source="${entry.source}" style="--term-color:${entry.color}">${escapeHtml(entry.term)}</button>`).join("")}</span></div>` : ""}
    `;
    item.addEventListener("click", () => {
      openNote(note.id);
      if (layoutMode !== "wide") {
        setContextPanelOpen(false, { restoreFocus: false, explicit: false });
      }
    });
    item.querySelectorAll(".term-chip").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openOrCreateLinkedNote(button.dataset.title);
      });
    });
    memoList.appendChild(item);
  });
}

function currentTermRelationIndex() {
  return termRelationCache.get(activeNotes());
}

function invalidateTermRelationIndex() {
  termRelationCache.invalidate();
}

function renderMemoListHeading(heading) {
  if (!memoListHeading) return;
  memoListHeading.textContent = heading;
  memoSidebar.setAttribute("aria-label", heading);
}

// メモ一覧カードに出す短い本文プレビューを作ります。
function snippet(body) {
  const text = tableBlockPlainText(body).replace(/\[\[|\]\]|#/g, "").trim();
  return text || "空のカード";
}

// 指定したidのメモをエディタに読み込みます。
function openNote(id) {
  const note = notes.find((item) => item.id === id);
  if (!note) return;

  // 関連ドロワーは広い画面では本文と並べて使えるため維持します。
  // 狭幅では本文を見やすくするため、メモ選択後だけ一時的に閉じます。
  if (layoutMode !== "wide") {
    setRelatedDrawerOpen(false, { restoreFocus: false });
  }
  currentId = note.id;
  if (localDirtyMemoId) clearLocalMemoDirty(localDirtyMemoId);
  pendingMemoSync = null;
  renderMemoSyncNotice();
  tableAxisSelections.clear();
  pendingTableAxisDeletion = null;
  titleInput.value = note.title;
  editor.value = note.body;
  lastUndoSnapshotAt = 0;
  setSaveStatus("saved", note.updatedAt);
  renderNoteMeta();
  renderList();
  renderCollectionExplorer();
  renderTableBlockEditors();
  applyEffectiveFontSettings();
  renderPreview();
  renderAttachmentsForCurrentNote();
  renderRelated();
  renderDiscovery();
  updateUndoButton();
  renderAiUi();
  if (isPopoutWindow) document.title = `${note.title} — Memo Nexus`;
  editor.focus();
}

// ポップアウトは本体のペイン・AI・モーダルを初期化せず、同じメモの編集だけを起動します。
async function initPopout() {
  restoreGlobalFontSettings();
  db = await openDb();
  notes = await getAllNotes();
  const note = notes.find((item) => item.id === popoutMemoId && !item.deletedAt);
  if (!note) {
    showPopoutUnavailable();
    return;
  }

  currentId = note.id;
  titleInput.value = note.title;
  editor.value = note.body;
  setSaveStatus("saved", note.updatedAt);
  renderNoteMeta();
  renderTableBlockEditors();
  applyEffectiveFontSettings();
  document.title = `${note.title} — Memo Nexus`;
  requestAnimationFrame(() => editor.focus());
}

// 今開いているメモ本体をnotes配列から取り出します。
function currentNote() {
  return notes.find((note) => note.id === currentId);
}

function markLocalMemoDirty() {
  if (!currentId) return;
  isLocalMemoDirty = true;
  localDirtyMemoId = currentId;
  localMemoEditVersion += 1;
}

function clearLocalMemoDirty(memoId = currentId) {
  if (localDirtyMemoId !== memoId) return;
  isLocalMemoDirty = false;
  localDirtyMemoId = null;
}

function popoutUrlForMemo(memoId) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("popout", memoId);
  return url.href;
}

function readPopoutWindowOptions() {
  const fallback = { width: 540, height: 720 };
  try {
    const saved = JSON.parse(localStorage.getItem(POPOUT_WINDOW_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      width: Math.max(360, Number(saved.width) || fallback.width),
      height: Math.max(480, Number(saved.height) || fallback.height),
      left: Number.isFinite(Number(saved.left)) ? Number(saved.left) : undefined,
      top: Number.isFinite(Number(saved.top)) ? Number(saved.top) : undefined
    };
  } catch (error) {
    console.warn("Popout window options read failed", error);
    return fallback;
  }
}

function popoutWindowFeatures(options = readPopoutWindowOptions()) {
  const width = Math.min(options.width, Math.max(360, screen.availWidth - 24));
  const height = Math.min(options.height, Math.max(480, screen.availHeight - 24));
  const features = [`width=${width}`, `height=${height}`, "resizable=yes", "scrollbars=yes"];
  if (Number.isFinite(options.left)) features.push(`left=${options.left}`);
  if (Number.isFinite(options.top)) features.push(`top=${options.top}`);
  return features.join(",");
}

function openMemoPopout() {
  const note = currentNote();
  if (!note) return;

  const opened = window.open("", `memo-nexus-popout-${note.id}`, popoutWindowFeatures());
  if (!opened) {
    setSaveStatus("error");
    saveStatus.textContent = "別ウィンドウを開けませんでした";
    return;
  }
  writePopoutInitialShell(opened);
  const ghost = createPopoutGhost(
    editorCard.ownerDocument,
    editorCard.getBoundingClientRect(),
    titleInput.value,
    editor.value,
    getPopoutGhostVisualStyle(editorCard)
  );
  const navigate = () => {
    if (!opened.closed) opened.location.href = popoutUrlForMemo(note.id);
    opened.focus();
  };
  if (!isLocalMemoDirty || localDirtyMemoId !== note.id) {
    navigate();
    return;
  }
  flushSave().then(navigate).catch((error) => {
    ghost.remove();
    opened.close();
    setSaveStatus("error");
    console.warn("Save before popout failed", error);
  });
}

function getPopoutGhostVisualStyle(source) {
  const style = getComputedStyle(source);
  return {
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderColor: style.borderColor,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow === "none" ? "0 10px 22px rgba(0, 0, 0, 0.16)" : style.boxShadow
  };
}

function writePopoutInitialShell(opened) {
  try {
    const style = getComputedStyle(document.body);
    const background = style.backgroundColor;
    const color = style.color;
    const scheme = currentTheme();
    opened.document.open();
    opened.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Memo Nexus</title><style>html,body{margin:0;width:100%;height:100%;background:${background};color:${color};color-scheme:${scheme};font-family:system-ui,sans-serif}</style></head><body></body></html>`);
    opened.document.close();
  } catch (error) {
    console.warn("Popout initial shell failed", error);
  }
}

function savePopoutWindowOptions() {
  if (!isPopoutWindow) return;
  try {
    localStorage.setItem(POPOUT_WINDOW_STORAGE_KEY, JSON.stringify({
      width: window.outerWidth,
      height: window.outerHeight,
      left: window.screenX,
      top: window.screenY
    }));
  } catch (error) {
    console.warn("Popout window options save failed", error);
  }
}

function returnFromPopout() {
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    window.close();
    return;
  }
  const url = new URL(location.href);
  url.search = "";
  location.href = url.href;
}

function showPopoutUnavailable() {
  if (!isPopoutWindow || !popoutUnavailable) return;
  editorCard.hidden = true;
  popoutUnavailable.hidden = false;
}

function notifyMemoChanged(note) {
  if (!note?.id) return;
  memoSyncChannel?.postMessage({
    type: "memo-changed",
    memoId: note.id,
    updatedAt: note.updatedAt || Date.now(),
    deletedAt: note.deletedAt || null
  });
}

async function refreshMemoFromOtherWindow(message) {
  if (!db || message?.type !== "memo-changed" || !message.memoId) return;
  const knownNote = notes.find((item) => item.id === message.memoId);
  notes = await getAllNotes();
  invalidateTermRelationIndex();
  const note = notes.find((item) => item.id === message.memoId);
  const decision = getMemoSyncDecision({
    message,
    knownUpdatedAt: knownNote?.updatedAt,
    pendingUpdatedAt: pendingMemoSync?.updatedAt,
    note,
    currentId,
    isLocalMemoDirty,
    localDirtyMemoId
  });

  if (decision === "ignore") return;
  if (decision === "unavailable" && isPopoutWindow && message.memoId === popoutMemoId) {
    showPopoutUnavailable();
    return;
  }
  if (decision === "pending") {
    pendingMemoSync = { memoId: message.memoId, updatedAt: Number(message.updatedAt) || Date.now() };
    renderMemoSyncNotice();
    return;
  }
  if (decision === "refresh-list" || !note || note.deletedAt) {
    renderAll();
    return;
  }

  applyMemoSync(note);
}

function applyMemoSync(note) {
  titleInput.value = note.title;
  editor.value = note.body;
  clearLocalMemoDirty(note.id);
  pendingMemoSync = null;
  renderMemoSyncNotice();
  setSaveStatus("saved", note.updatedAt);
  if (isPopoutWindow) {
    renderNoteMeta();
    renderTableBlockEditors();
    document.title = `${note.title} — Memo Nexus`;
    return;
  }
  renderAll();
  renderTableBlockEditors();
  renderPreview();
  if (isPopoutWindow) document.title = `${note.title} — Memo Nexus`;
}

function renderMemoSyncNotice() {
  if (!memoSyncNotice) return;
  memoSyncNotice.hidden = !pendingMemoSync || pendingMemoSync.memoId !== currentId;
}

function loadPendingMemoSync() {
  if (!pendingMemoSync || pendingMemoSync.memoId !== currentId) return;
  const note = notes.find((item) => item.id === currentId);
  if (!note || note.deletedAt) {
    if (isPopoutWindow) showPopoutUnavailable();
    return;
  }
  applyMemoSync(note);
}

// 入力のたびに即保存すると重いので、少し待ってから保存する予約をします。
function scheduleSave({ render = true } = {}) {
  markLocalMemoDirty();
  saveCurrentDraftMirror();
  clearTimeout(saveTimer);
  setSaveStatus("editing");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCurrentNote().catch((error) => console.error("Scheduled save failed", error));
  }, 280);
  if (render) renderPreview();
  renderRelated();
  updateUndoButton();
}

function captureUndoSnapshot(event) {
  if (!currentId) return;

  const now = Date.now();
  const force = shouldForceUndoSnapshot(event && event.inputType);
  if (!force && now - lastUndoSnapshotAt < UNDO_INPUT_INTERVAL_MS) return;

  pushUndoSnapshot({
    noteId: currentId,
    title: titleInput.value,
    body: editor.value,
    savedAt: now
  });
}

function shouldForceUndoSnapshot(inputType) {
  return [
    "deleteContentBackward",
    "deleteContentForward",
    "deleteByCut",
    "insertFromPaste",
    "insertFromDrop"
  ].includes(inputType);
}

function pushUndoSnapshot(snapshot) {
  const previous = undoStack[undoStack.length - 1];
  if (
    previous &&
    previous.noteId === snapshot.noteId &&
    previous.title === snapshot.title &&
    previous.body === snapshot.body
  ) {
    lastUndoSnapshotAt = snapshot.savedAt;
    return;
  }

  undoStack.push(snapshot);
  if (undoStack.length > UNDO_LIMIT) {
    undoStack = undoStack.slice(undoStack.length - UNDO_LIMIT);
  }
  lastUndoSnapshotAt = snapshot.savedAt;
  updateUndoButton();
}

function undoLastEdit() {
  if (!currentId) return;

  const index = undoStack.map((snapshot) => snapshot.noteId).lastIndexOf(currentId);
  if (index === -1) {
    updateUndoButton();
    return;
  }

  const [snapshot] = undoStack.splice(index, 1);
  titleInput.value = snapshot.title;
  editor.value = snapshot.body;
  lastUndoSnapshotAt = 0;
  renderTableBlockEditors();
  scheduleSave();
  renderNoteMeta();
  renderList();
  updateUndoButton();
}

function updateUndoButton() {
  if (!undoBtn) return;
  undoBtn.disabled = !currentId || !undoStack.some((snapshot) => snapshot.noteId === currentId);
}

// 遅延保存の予約を解除し、現在の入力内容をすぐに保存します。
async function flushSave() {
  const note = currentNote();
  const hasUnsavedChanges = Boolean(note) && (
    note.body !== editor.value ||
    note.title !== (titleInput.value || titleFromBody(editor.value) || "無題メモ")
  );
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (hasUnsavedChanges) await saveCurrentNote();
}

// タイトルと本文を現在のメモへ反映し、IndexedDBへ保存します。
async function saveCurrentNote() {
  const note = currentNote();
  if (!note) return;
  const savedEditVersion = localMemoEditVersion;

  setSaveStatus("saving");
  const beforeLinks = collectLinks(activeNotes()).length;
  const nextBody = editor.value;
  const bodyChanged = note.body !== nextBody;
  note.body = nextBody;
  note.title = titleInput.value || titleFromBody(note.body) || "無題メモ";
  if (!note.createdAt) note.createdAt = Date.now();
  if (!note.bodyUpdatedAt || bodyChanged) note.bodyUpdatedAt = Date.now();
  note.updatedAt = Date.now();

  try {
    await putNote(note);
    console.log("Memo saved", { id: note.id, title: note.title });
    notes = await getAllNotes();
    invalidateTermRelationIndex();
    currentId = note.id;

    const afterLinks = collectLinks(activeNotes()).length;
    if (afterLinks > beforeLinks) {
      lastDiscovery = buildDiscoveryMessage(note);
    }

    titleInput.value = note.title;
    if (localDirtyMemoId === note.id && localMemoEditVersion === savedEditVersion) {
      clearLocalMemoDirty(note.id);
    }
    if (pendingMemoSync?.memoId === note.id) {
      pendingMemoSync = null;
      renderMemoSyncNotice();
    }
    setSaveStatus("saved", note.updatedAt);
    if (isPopoutWindow) {
      renderNoteMeta();
      document.title = `${note.title} — Memo Nexus`;
    } else {
      renderAll();
    }
  } catch (error) {
    setSaveStatus("error");
    throw error;
  }
}

async function deleteCurrentNote() {
  const note = currentNote();
  if (!note) return;

  if (note.deletedAt) {
    await permanentlyDeleteMemos([note.id]);
    return;
  }

  const confirmed = confirm(`「${note.title}」をゴミ箱へ移動しますか？`);
  if (!confirmed) return;

  await flushSave();
  const normalBefore = activeNotes();
  const currentIndex = normalBefore.findIndex((item) => item.id === note.id);
  deletedNoteSnapshot = { id: note.id };
  saveStatus.textContent = "削除中...";

  note.deletedAt = new Date().toISOString();
  note.updatedAt = Date.now();
  await putNote(note);
  removeDraftMirrorForNote(note.id);
  notes = await getAllNotes();
  invalidateTermRelationIndex();

  if (!activeNotes().length) {
    const nextNote = await createNote("新規メモ", "");
    notes = await getAllNotes();
    renderAll();
    openNote(nextNote.id);
    showDeleteUndoMessage(note);
    return;
  }

  const normalAfter = activeNotes();
  const nextNote = normalAfter[Math.min(currentIndex, normalAfter.length - 1)] || normalAfter[0];
  renderAll();
  openNote(nextNote.id);
  showDeleteUndoMessage(note);
}

function showDeleteUndoMessage(note) {
  if (!deleteUndoNotice || !note) return;

  deleteUndoNotice.hidden = false;
  deleteUndoNotice.innerHTML = `
    <span>削除しました。</span>
    <button id="restoreDeletedNoteBtn" type="button">元に戻す</button>
    <button id="closeDeleteUndoNoticeBtn" class="delete-undo-close" type="button" title="閉じる">×</button>
  `;

  const restoreButton = $("restoreDeletedNoteBtn");
  if (restoreButton) {
    restoreButton.addEventListener("click", () => {
      restoreDeletedNote().catch((error) => {
        console.error("Delete undo failed", error);
        setSaveStatus("error");
      });
    });
  }

  const closeButton = $("closeDeleteUndoNoticeBtn");
  if (closeButton) {
    closeButton.addEventListener("click", clearDeleteUndoMessage);
  }
}

async function restoreDeletedNote() {
  if (!deletedNoteSnapshot) return;

  const id = deletedNoteSnapshot.id;
  const existing = notes.find((note) => note.id === id);
  if (!existing) return;
  existing.collectionId = collectionExists(existing.collectionId) ? existing.collectionId : UNCLASSIFIED_COLLECTION_ID;
  existing.deletedAt = null;
  existing.updatedAt = Date.now();
  await putNote(existing);
  notes = await getAllNotes();
  invalidateTermRelationIndex();

  clearDeleteUndoMessage();
  renderAll();
  openNote(existing.id);
}

function clearDeleteUndoMessage() {
  deletedNoteSnapshot = null;
  if (!deleteUndoNotice) return;
  deleteUndoNotice.hidden = true;
  deleteUndoNotice.innerHTML = "";
}

// タイトル欄が空のとき、本文の最初の空でない行をタイトル候補にします。
// 先頭のMarkdown見出し記号やWikiリンク記号は、タイトルとして読みやすい形に整えます。
function titleFromBody(body) {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return "";

  return firstLine
    .replace(/^#+\s*/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .slice(0, 60)
    .trim();
}

// 右側のカード表示を更新します。本文中の[[名前]]はクリック可能なリンクに変換します。
function renderPreview() {
  const renderGeneration = ++mermaidRenderGeneration;
  const note = currentNote();
  if (!note) {
    preview.innerHTML = "";
    renderLinkList();
    renderLinkStats();
    return;
  }

  const body = (note.id === currentId ? editor.value : note.body);
  previewAutomaticTerms = currentTermRelationIndex().byNoteId.get(note.id)?.automaticTerms || [];
  checklistRenderIndex = 0;
  preview.innerHTML = renderPreviewHtml(body, note.id, renderGeneration);
  hydrateMathExpressions();
  hydrateInlineAttachmentImages();
  bindImageBlockControls();
  hydrateExplanationCards(note, body);
  bindChecklistControls(note);

  preview.querySelectorAll(".wiki-link").forEach((button) => {
    button.addEventListener("click", () => openOrCreateLinkedNote(button.dataset.title));
  });
  highlightCodeBlocks();
  void renderMermaidDiagrams(preview, renderGeneration);
  renderLinkList();
  renderLinkStats();
}

function currentTableBlock(blockIndex, tableId) {
  const blocks = splitTableBlocks(editor.value).filter((segment) => segment.type === "table");
  const block = blocks[Number(blockIndex)];
  return block && block.table.id === tableId ? block : null;
}

function tableEditorButton(label, action, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.tableAction = action;
  if (danger) button.classList.add("danger-button");
  return button;
}

function tableAxisSelection(tableId) {
  return tableAxisSelections.get(tableId) || null;
}

function tableColumnAlignment(table, columnIndex) {
  const alignment = Array.isArray(table.alignments) ? table.alignments[columnIndex] : null;
  return ["left", "center", "right"].includes(alignment) ? alignment : "";
}

function tableAxisSelector(type, index, label, selected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-axis-selector";
  button.textContent = label;
  button.dataset.tableAxis = type;
  button.dataset.tableAxisIndex = String(index);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", type === "row" ? `${label}行目を選択` : `${label}列を選択`);
  return button;
}

function setTableEditorStatus(editorBlock, message) {
  const status = editorBlock && editorBlock.querySelector(".table-block-operation-status");
  if (status) status.textContent = message;
}

function tableSnapshotForCopy(editorBlock, tableValue) {
  const table = normalizeTableBlock(tableValue, tableValue && tableValue.id);
  const rows = table.rows.map((row) => [...row]);
  editorBlock.querySelectorAll(".table-block-cell-input").forEach((input) => {
    const rowIndex = Number(input.dataset.rowIndex);
    const columnIndex = Number(input.dataset.columnIndex);
    if (rows[rowIndex] && columnIndex >= 0 && columnIndex < rows[rowIndex].length) {
      rows[rowIndex][columnIndex] = input.value;
    }
  });
  return normalizeTableBlock({ ...table, rows }, table.id);
}

function showTableCopyStatus(editorBlock, message, success) {
  const status = editorBlock && editorBlock.querySelector(".table-block-operation-status");
  if (!status) return;
  const previousTimer = tableCopyStatusTimers.get(status);
  if (previousTimer) clearTimeout(previousTimer);
  status.textContent = message;
  status.classList.toggle("success", success);
  const timer = setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
    status.classList.remove("success");
    tableCopyStatusTimers.delete(status);
  }, 2200);
  tableCopyStatusTimers.set(status, timer);
}

async function copyTableBlock(editorBlock, tableValue, format) {
  const table = tableSnapshotForCopy(editorBlock, tableValue);
  try {
    if (format === "markdown") {
      await writeTextToClipboard(tableBlockToMarkdown(table), { fallbackCopyText });
      showTableCopyStatus(editorBlock, "Markdown表をコピーしました", true);
      return;
    }
    await writeTableToClipboard(table, {
      fallbackCopyText,
      onRichCopyError: (error) => console.warn("Rich table copy failed; trying text fallback", error)
    });
    showTableCopyStatus(editorBlock, "表をコピーしました", true);
  } catch (error) {
    console.error("Table copy failed", error);
    showTableCopyStatus(editorBlock, "表をコピーできませんでした", false);
  }
}

function focusTableAxisHeader(tableId, type, index) {
  requestAnimationFrame(() => {
    const selector = `.table-block-editor[data-table-id="${CSS.escape(tableId)}"] .table-axis-selector[data-table-axis="${type}"][data-table-axis-index="${index}"]`;
    tableBlockEditors?.querySelector(selector)?.focus({ preventScroll: true });
  });
}

function createTableEditor(tableValue, blockIndex) {
  const table = normalizeTableBlock(tableValue, `table-${blockIndex + 1}`);
  const selection = tableAxisSelection(table.id);
  const article = document.createElement("article");
  article.className = "table-block-editor";
  article.dataset.tableId = table.id;
  article.dataset.tableIndex = String(blockIndex);

  const header = document.createElement("div");
  header.className = "table-block-editor-head";
  const title = document.createElement("strong");
  title.textContent = `表 ${blockIndex + 1}`;
  const menu = document.createElement("details");
  menu.className = "table-block-editor-menu";
  const summary = document.createElement("summary");
  summary.setAttribute("aria-label", `表${blockIndex + 1}の操作メニュー`);
  summary.textContent = "操作";
  const actions = document.createElement("div");
  actions.className = "table-block-editor-actions";
  actions.append(
    tableEditorButton("行を追加", "add-row"),
    tableEditorButton("行を削除", "delete-row"),
    tableEditorButton("列を追加", "add-column"),
    tableEditorButton("列を削除", "delete-column"),
    tableEditorButton("表をコピー", "copy-table"),
    tableEditorButton("Markdown表としてコピー", "copy-markdown"),
    tableEditorButton(table.hasHeader ? "見出し行をオフ" : "見出し行をオン", "toggle-header"),
    tableEditorButton("表を削除", "delete-table", true)
  );
  actions.querySelector('[data-table-action="delete-row"]').title = selection?.type === "row"
    ? `${selection.index + 1}行目を削除`
    : "削除する行を選択してください";
  actions.querySelector('[data-table-action="delete-column"]').title = selection?.type === "column"
    ? `${tableColumnLabel(selection.index)}列を削除`
    : "削除する列を選択してください";
  menu.append(summary, actions);
  header.append(title, menu);

  const caption = document.createElement("input");
  caption.type = "text";
  caption.className = "table-block-comment table-block-caption-input";
  caption.dataset.tableField = "caption";
  caption.value = table.caption;
  caption.placeholder = "表の説明を入力";
  caption.setAttribute("aria-label", `表${blockIndex + 1}の説明`);

  const scroll = document.createElement("div");
  scroll.className = "table-block-editor-scroll";
  const tableElement = document.createElement("table");
  tableElement.setAttribute("aria-label", `表${blockIndex + 1}のセル編集`);
  const tableHead = document.createElement("thead");
  const columnHeaderRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "table-axis-corner";
  corner.setAttribute("aria-hidden", "true");
  columnHeaderRow.append(corner);
  table.rows[0].forEach((_, columnIndex) => {
    const selected = selection?.type === "column" && selection.index === columnIndex;
    const headerCell = document.createElement("th");
    headerCell.className = "table-axis-header table-column-header";
    if (selected) headerCell.classList.add("is-selected");
    headerCell.append(tableAxisSelector("column", columnIndex, tableColumnLabel(columnIndex), selected));
    columnHeaderRow.append(headerCell);
  });
  tableHead.append(columnHeaderRow);
  const tableBody = document.createElement("tbody");
  table.rows.forEach((row, rowIndex) => {
    const rowElement = document.createElement("tr");
    const rowSelected = selection?.type === "row" && selection.index === rowIndex;
    const rowHeader = document.createElement("th");
    rowHeader.className = "table-axis-header table-row-header";
    if (rowSelected) rowHeader.classList.add("is-selected");
    rowHeader.append(tableAxisSelector("row", rowIndex, String(rowIndex + 1), rowSelected));
    rowElement.append(rowHeader);
    row.forEach((cell, columnIndex) => {
      const cellElement = document.createElement(table.hasHeader && rowIndex === 0 ? "th" : "td");
      if (rowSelected || (selection?.type === "column" && selection.index === columnIndex)) {
        cellElement.classList.add("is-axis-selected");
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "table-block-cell-input";
      input.value = cell;
      input.dataset.rowIndex = String(rowIndex);
      input.dataset.columnIndex = String(columnIndex);
      input.setAttribute("aria-label", `表${blockIndex + 1} ${rowIndex + 1}行${columnIndex + 1}列`);
      input.style.textAlign = tableColumnAlignment(table, columnIndex);
      cellElement.append(input);
      rowElement.append(cellElement);
    });
    tableBody.append(rowElement);
  });
  tableElement.append(tableHead, tableBody);
  scroll.append(tableElement);

  const operationStatus = document.createElement("p");
  operationStatus.className = "table-block-operation-status";
  operationStatus.setAttribute("role", "status");
  operationStatus.setAttribute("aria-live", "polite");

  const note = document.createElement("input");
  note.type = "text";
  note.className = "table-block-comment table-block-note-input";
  note.dataset.tableField = "note";
  note.value = table.note;
  note.placeholder = "出典や補足を入力";
  note.setAttribute("aria-label", `表${blockIndex + 1}の出典や補足`);
  article.append(header, caption, scroll, operationStatus, note);
  return article;
}

function renderTableBlockEditors() {
  if (!tableBlockEditors) return;
  const blocks = splitTableBlocks(editor.value).filter((segment) => segment.type === "table");
  tableBlockEditors.replaceChildren();
  tableBlockEditors.hidden = blocks.length === 0;
  if (!blocks.length) {
    activeTableCell = null;
    return;
  }
  const heading = document.createElement("div");
  heading.className = "table-block-editors-heading";
  heading.textContent = `本文内の表（${blocks.length}件）`;
  tableBlockEditors.append(heading);
  blocks.forEach((block, blockIndex) => tableBlockEditors.append(createTableEditor(block.table, blockIndex)));
}

function commitTableBlockChange(blockIndex, tableId, nextTable, { rerenderEditors = false } = {}) {
  const block = currentTableBlock(blockIndex, tableId);
  if (!block) return false;
  try {
    captureUndoSnapshot({ inputType: "insertText" });
    editor.value = replaceTableBlock(editor.value, block, nextTable);
    if (rerenderEditors) renderTableBlockEditors();
    renderPreview();
    scheduleSave({ render: false });
    return true;
  } catch (error) {
    alert(error.message || String(error));
    renderTableBlockEditors();
    return false;
  }
}

function focusTableCell(tableId, rowIndex, columnIndex) {
  requestAnimationFrame(() => {
    const selector = `.table-block-editor[data-table-id="${CSS.escape(tableId)}"] .table-block-cell-input[data-row-index="${rowIndex}"][data-column-index="${columnIndex}"]`;
    const input = tableBlockEditors && tableBlockEditors.querySelector(selector);
    if (input) input.focus();
  });
}

function insertTableAtSelection() {
  if (!currentNote() || currentNote().deletedAt) return;
  const table = createTableBlock(crypto.randomUUID());
  const result = insertTableBlock(editor.value, editor.selectionStart, editor.selectionEnd, table);
  captureUndoSnapshot({ inputType: "insertText" });
  editor.value = result.value;
  editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  renderTableBlockEditors();
  renderPreview();
  scheduleSave({ render: false });
  focusTableCell(table.id, 0, 0);
}

function handleTableEditorInput(event) {
  const editorBlock = event.target.closest(".table-block-editor");
  if (!editorBlock) return;
  const blockIndex = Number(editorBlock.dataset.tableIndex);
  const tableId = editorBlock.dataset.tableId;
  const block = currentTableBlock(blockIndex, tableId);
  if (!block) return;
  let next = block.table;
  if (event.target.matches(".table-block-cell-input")) {
    next = updateTableCell(next, Number(event.target.dataset.rowIndex), Number(event.target.dataset.columnIndex), event.target.value);
  } else if (event.target.dataset.tableField) {
    next = normalizeTableBlock({ ...next, [event.target.dataset.tableField]: event.target.value }, tableId);
  } else {
    return;
  }
  commitTableBlockChange(blockIndex, tableId, next);
}

function handleTableEditorFocus(event) {
  if (!event.target.matches(".table-block-cell-input")) return;
  const editorBlock = event.target.closest(".table-block-editor");
  activeTableCell = {
    blockIndex: Number(editorBlock.dataset.tableIndex),
    tableId: editorBlock.dataset.tableId,
    rowIndex: Number(event.target.dataset.rowIndex),
    columnIndex: Number(event.target.dataset.columnIndex)
  };
}

function handleTableEditorKeydown(event) {
  if (event.key !== "Tab" || !event.target.matches(".table-block-cell-input")) return;
  const editorBlock = event.target.closest(".table-block-editor");
  const blockIndex = Number(editorBlock.dataset.tableIndex);
  const tableId = editorBlock.dataset.tableId;
  const block = currentTableBlock(blockIndex, tableId);
  if (!block) return;
  event.preventDefault();
  const movement = moveTableCell(
    block.table,
    Number(event.target.dataset.rowIndex),
    Number(event.target.dataset.columnIndex),
    event.shiftKey
  );
  if (movement.rowAdded) {
    commitTableBlockChange(blockIndex, tableId, movement.table, { rerenderEditors: true });
  }
  focusTableCell(tableId, movement.rowIndex, movement.columnIndex);
}

function handleTableAxisSelection(event) {
  const button = event.target.closest(".table-axis-selector");
  if (!button) return;
  const editorBlock = button.closest(".table-block-editor");
  const tableId = editorBlock.dataset.tableId;
  const type = button.dataset.tableAxis;
  const index = Number(button.dataset.tableAxisIndex);
  const current = tableAxisSelection(tableId);
  if (current?.type === type && current.index === index) {
    tableAxisSelections.delete(tableId);
  } else {
    tableAxisSelections.set(tableId, { type, index });
  }
  renderTableBlockEditors();
  focusTableAxisHeader(tableId, type, index);
}

function closeTableAxisDeleteDialog() {
  if (tableAxisDeleteDialog?.open) tableAxisDeleteDialog.close();
}

function requestTableAxisDeletion(editorBlock, type, index) {
  const label = type === "row" ? `${index + 1}行目` : `${tableColumnLabel(index)}列`;
  pendingTableAxisDeletion = {
    blockIndex: Number(editorBlock.dataset.tableIndex),
    tableId: editorBlock.dataset.tableId,
    type,
    index,
    restoreFocus: true,
    trigger: editorBlock.querySelector(`[data-table-action="delete-${type}"]`)
  };
  tableAxisDeleteTitle.textContent = type === "row" ? "行を削除" : "列を削除";
  tableAxisDeleteMessage.textContent = `${label}を削除しますか？`;
  tableAxisDeleteDialog.showModal();
  cancelTableAxisDeleteBtn.focus();
}

function confirmTableAxisDeletion() {
  const pending = pendingTableAxisDeletion;
  if (!pending) return;
  const block = currentTableBlock(pending.blockIndex, pending.tableId);
  const editorBlock = tableBlockEditors?.querySelector(`.table-block-editor[data-table-index="${pending.blockIndex}"]`);
  if (!block) {
    pending.restoreFocus = false;
    closeTableAxisDeleteDialog();
    return;
  }
  const selection = tableAxisSelection(pending.tableId);
  if (selection?.type !== pending.type || selection.index !== pending.index) {
    pending.restoreFocus = false;
    closeTableAxisDeleteDialog();
    setTableEditorStatus(editorBlock, "選択対象が変わりました。もう一度選択してください");
    return;
  }
  const isRow = pending.type === "row";
  const count = isRow ? block.table.rows.length : block.table.rows[0].length;
  if (count <= 1) {
    pending.restoreFocus = false;
    closeTableAxisDeleteDialog();
    setTableEditorStatus(editorBlock, isRow
      ? "表には最低1行必要なため削除できません"
      : "表には最低1列必要なため削除できません");
    return;
  }
  const next = isRow
    ? deleteTableRow(block.table, pending.index)
    : deleteTableColumn(block.table, pending.index);
  const nextIndex = Math.min(pending.index, count - 2);
  tableAxisSelections.set(pending.tableId, { type: pending.type, index: nextIndex });
  pending.restoreFocus = false;
  closeTableAxisDeleteDialog();
  if (commitTableBlockChange(pending.blockIndex, pending.tableId, next, { rerenderEditors: true })) {
    focusTableAxisHeader(pending.tableId, pending.type, nextIndex);
  }
}

function handleTableEditorAction(event) {
  const button = event.target.closest("[data-table-action]");
  if (!button) return;
  const editorBlock = button.closest(".table-block-editor");
  const blockIndex = Number(editorBlock.dataset.tableIndex);
  const tableId = editorBlock.dataset.tableId;
  const block = currentTableBlock(blockIndex, tableId);
  if (!block) return;
  const selection = tableAxisSelection(tableId);
  let next = block.table;
  let focusCell = null;
  switch (button.dataset.tableAction) {
    case "copy-table":
      void copyTableBlock(editorBlock, block.table, "table");
      return;
    case "copy-markdown":
      void copyTableBlock(editorBlock, block.table, "markdown");
      return;
    case "add-row": {
      const afterIndex = selection?.type === "row" ? selection.index : next.rows.length - 1;
      next = addTableRow(next, afterIndex);
      focusCell = { rowIndex: Math.min(afterIndex + 1, next.rows.length - 1), columnIndex: 0 };
      break;
    }
    case "delete-row":
      if (selection?.type !== "row") {
        setTableEditorStatus(editorBlock, "削除する行を選択してください");
        return;
      }
      if (next.rows.length <= 1) {
        setTableEditorStatus(editorBlock, "表には最低1行必要なため削除できません");
        return;
      }
      requestTableAxisDeletion(editorBlock, "row", selection.index);
      return;
    case "add-column": {
      const afterIndex = selection?.type === "column" ? selection.index : next.rows[0].length - 1;
      next = addTableColumn(next, afterIndex);
      focusCell = { rowIndex: 0, columnIndex: Math.min(afterIndex + 1, next.rows[0].length - 1) };
      break;
    }
    case "delete-column":
      if (selection?.type !== "column") {
        setTableEditorStatus(editorBlock, "削除する列を選択してください");
        return;
      }
      if (next.rows[0].length <= 1) {
        setTableEditorStatus(editorBlock, "表には最低1列必要なため削除できません");
        return;
      }
      requestTableAxisDeletion(editorBlock, "column", selection.index);
      return;
    case "toggle-header":
      next = normalizeTableBlock({ ...next, hasHeader: !next.hasHeader }, tableId);
      break;
    case "delete-table":
      if (!confirm("この表ブロックを削除しますか？")) return;
      captureUndoSnapshot({ inputType: "deleteContentForward" });
      editor.value = replaceTableBlock(editor.value, block, null);
      activeTableCell = null;
      tableAxisSelections.delete(tableId);
      renderTableBlockEditors();
      renderPreview();
      scheduleSave({ render: false });
      editor.focus();
      return;
    default:
      return;
  }
  if (focusCell) tableAxisSelections.delete(tableId);
  if (commitTableBlockChange(blockIndex, tableId, next, { rerenderEditors: true })) {
    if (focusCell) focusTableCell(tableId, focusCell.rowIndex, focusCell.columnIndex);
  }
}

function attachmentTotalSize(items = currentAttachments) {
  return items.reduce((sum, attachment) => sum + (Number(attachment.size) || 0), 0);
}

function setAttachmentStatus(message = "", isError = false) {
  attachmentStatus.textContent = message;
  attachmentStatus.classList.toggle("error", isError);
}

function updateAttachmentAdditionCount(memoId, difference) {
  const next = Math.max(0, (pendingAttachmentAdditions.get(memoId) || 0) + difference);
  if (next) pendingAttachmentAdditions.set(memoId, next);
  else pendingAttachmentAdditions.delete(memoId);
}

function syncAttachmentAddControls(note = currentNote()) {
  const disabled = !note || Boolean(note.deletedAt) || pendingAttachmentAdditions.has(note.id);
  addAttachmentBtn.disabled = disabled;
  attachmentInput.disabled = disabled;
  attachmentDropZone.classList.toggle("disabled", disabled);
}

function revokeAttachmentObjectUrl(id) {
  const imageUrl = attachmentObjectUrls.get(id);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  attachmentObjectUrls.delete(id);
  const pdfUrl = pdfObjectUrls.get(id);
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfObjectUrls.delete(id);
  const timer = pdfObjectUrlTimers.get(id);
  if (timer) clearTimeout(timer);
  pdfObjectUrlTimers.delete(id);
}

function getOrCreateAttachmentObjectUrl(attachment) {
  let objectUrl = attachmentObjectUrls.get(attachment.id);
  if (!objectUrl) {
    objectUrl = URL.createObjectURL(attachment.blob);
    attachmentObjectUrls.set(attachment.id, objectUrl);
  }
  return objectUrl;
}

function hydrateInlineAttachmentImages() {
  preview.querySelectorAll(".inline-attachment-image").forEach((container) => {
    const attachment = currentAttachments.find((item) => item.id === container.dataset.attachmentId && item.kind === "image");
    if (!attachment) {
      container.classList.add("missing");
      container.textContent = container.dataset.alt
        ? `画像を表示できません: ${container.dataset.alt}`
        : "画像を表示できません";
      return;
    }

    try {
      const image = document.createElement("img");
      image.src = getOrCreateAttachmentObjectUrl(attachment);
      image.alt = container.dataset.alt || attachment.fileName || "添付画像";
      image.loading = "lazy";
      container.classList.remove("missing");
      container.replaceChildren(image);
    } catch (error) {
      console.error("Inline attachment image failed", error);
      container.classList.add("missing");
      container.textContent = "画像を表示できません";
    }
  });
}

function currentImageBlock(element) {
  const figure = element.closest(".image-block");
  const index = Number(figure && figure.dataset.imageBlockIndex);
  const segment = splitImageBlocks(editor.value)[index];
  return segment && segment.type === "image" ? segment : null;
}

function commitImageBlockChange(block, images, caption, { throwOnError = false } = {}) {
  if (!block) return false;
  try {
    const nextBody = replaceImageBlock(editor.value, block, images, caption);
    captureUndoSnapshot({ inputType: "insertText" });
    editor.value = nextBody;
    renderPreview();
    scheduleSave({ render: false });
    return true;
  } catch (error) {
    if (throwOnError) throw error;
    alert(error.message || String(error));
    renderPreview();
    return false;
  }
}

function setImageBlockMenuOpen(figure, open) {
  const toggle = figure && figure.querySelector(".image-block-menu-toggle");
  const menu = figure && figure.querySelector(".image-block-actions");
  if (!toggle || !menu) return;
  toggle.setAttribute("aria-expanded", String(Boolean(open)));
  menu.hidden = !open;
  figure.classList.toggle("menu-open", Boolean(open));
}

function setImageCaptionEditing(figure, editorPanel, editing) {
  const menuShell = figure && figure.querySelector(".image-block-menu-shell");
  if (!figure || !menuShell) return;
  figure.classList.toggle("editing", Boolean(editing));
  menuShell.hidden = Boolean(editing);
  if (!editing && editorPanel) editorPanel.remove();
}

function bindImageBlockControls() {
  preview.querySelectorAll(".image-block").forEach((figure) => {
    figure.addEventListener("click", () => figure.classList.add("menu-visible"));
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setImageBlockMenuOpen(figure, false);
        figure.classList.remove("menu-visible");
        return;
      }
      if (event.target === figure && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        figure.classList.add("menu-visible");
        setImageBlockMenuOpen(figure, true);
      }
    });
  });

  preview.querySelectorAll(".image-block-menu-toggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const figure = button.closest(".image-block");
      setImageBlockMenuOpen(figure, button.getAttribute("aria-expanded") !== "true");
    });
  });

  preview.querySelectorAll(".image-block-open").forEach((button) => {
    button.addEventListener("click", () => {
      const attachment = currentAttachments.find((item) => item.id === button.dataset.imageId && item.kind === "image");
      if (attachment) openImagePreview(attachment);
    });
  });

  preview.querySelectorAll(".image-block-add").forEach((button) => {
    button.addEventListener("click", () => {
      const block = currentImageBlock(button);
      if (!block || block.images.length >= 2 || !imageBlockInput) return;
      pendingImageBlockTarget = {
        memoId: currentId,
        start: block.start,
        raw: block.raw,
        imageIds: block.images.map((image) => image.id)
      };
      imageBlockInput.click();
    });
  });

  preview.querySelectorAll(".image-block-swap").forEach((button) => {
    button.addEventListener("click", () => {
      const block = currentImageBlock(button);
      if (!block || block.images.length !== 2) return;
      commitImageBlockChange(block, [...block.images].reverse(), block.caption);
    });
  });

  preview.querySelectorAll(".image-block-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const block = currentImageBlock(button);
      const imageIndex = Number(button.dataset.imageIndex);
      if (!block || !block.images[imageIndex]) return;
      if (!confirm(`画像${imageIndex + 1}を本文の画像ブロックから外しますか？\n添付ファイル欄の元データは削除されません。`)) return;
      commitImageBlockChange(block, block.images.filter((_, index) => index !== imageIndex), block.caption);
    });
  });

  preview.querySelectorAll(".image-block-edit-caption").forEach((button) => {
    button.addEventListener("click", () => openImageCaptionEditor(button));
  });
}

function openImageCaptionEditor(button) {
  const block = currentImageBlock(button);
  const figure = button.closest(".image-block");
  if (!block || !figure || figure.querySelector(".image-caption-editor")) return;
  const editorPanel = document.createElement("div");
  editorPanel.className = "image-caption-editor";
  const textarea = document.createElement("textarea");
  textarea.value = block.caption;
  textarea.rows = 5;
  textarea.placeholder = "画像ブロック全体の説明文（改行、太字、斜体、インラインコード、リンク、箇条書きに対応）";
  textarea.setAttribute("aria-label", "画像ブロックの説明文");
  const actions = document.createElement("div");
  actions.className = "image-caption-editor-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "説明文を保存";
  cancel.addEventListener("click", () => {
    setImageCaptionEditing(figure, editorPanel, false);
    const toggle = figure.querySelector(".image-block-menu-toggle");
    if (toggle) toggle.focus();
  });
  save.addEventListener("click", () => commitImageBlockChange(block, block.images, textarea.value));
  actions.append(cancel, save);
  editorPanel.append(textarea, actions);
  figure.appendChild(editorPanel);
  setImageBlockMenuOpen(figure, false);
  setImageCaptionEditing(figure, editorPanel, true);
  textarea.focus();
}

function findPendingImageBlock(target) {
  if (!target || target.memoId !== currentId) return null;
  return splitImageBlocks(editor.value).find((segment) => segment.type === "image"
    && segment.start === target.start
    && segment.raw === target.raw
    && segment.images.map((image) => image.id).join("\n") === target.imageIds.join("\n"));
}

function validatePendingImageBlock(target) {
  const block = findPendingImageBlock(target);
  if (!block || block.images.length >= 2) {
    throw new Error("画像ブロックが変更されたため2枚目を追加できませんでした");
  }
  return block;
}

function insertStoredImageIntoBlock(attachments, target) {
  const block = validatePendingImageBlock(target);
  const image = attachments.find((attachment) => attachment.kind === "image");
  if (!image) throw new Error("追加する画像を確認できませんでした");
  commitImageBlockChange(
    block,
    [...block.images, { id: image.id, alt: image.fileName }],
    block.caption,
    { throwOnError: true }
  );
}

async function rollbackImageBlockAttachments(attachments) {
  const ids = attachments.map((attachment) => attachment.id);
  await deleteAttachmentRecords(ids);
  ids.forEach(revokeAttachmentObjectUrl);
  currentAttachments = currentAttachments.filter((attachment) => !ids.includes(attachment.id));
  if (currentNote()) {
    renderAttachmentList();
    renderPreview();
  }
}

function cleanupAttachmentObjectUrls() {
  [...attachmentObjectUrls.keys(), ...pdfObjectUrls.keys()].forEach(revokeAttachmentObjectUrl);
  if (imagePreviewDialog.open) imagePreviewDialog.close();
  imagePreview.removeAttribute("src");
}

async function renderAttachmentsForCurrentNote() {
  const note = currentNote();
  const token = ++attachmentRenderToken;
  cleanupAttachmentObjectUrls();
  currentAttachments = [];
  attachmentList.innerHTML = "";
  attachmentCount.textContent = "0件";
  attachmentUsage.textContent = `使用容量 0 B / ${formatAttachmentBytes(MAX_ATTACHMENT_TOTAL_BYTES)}`;
  syncAttachmentAddControls(note);
  if (!note) return;

  setAttachmentStatus("添付ファイルを読み込み中...");
  try {
    const items = await getAttachmentsForMemo(note.id);
    if (token !== attachmentRenderToken || currentId !== note.id) return;
    currentAttachments = items;
    renderAttachmentList();
    hydrateInlineAttachmentImages();
    setAttachmentStatus(note.deletedAt
      ? "ゴミ箱内のメモには添付を追加できません。復元後に追加してください。"
      : pendingAttachmentAdditions.has(note.id) ? "添付ファイルを処理しています..." : "");
  } catch (error) {
    console.error("Attachment load failed", error);
    if (token === attachmentRenderToken) setAttachmentStatus(`添付ファイルを読み込めませんでした: ${error.message || error}`, true);
  }
}

function renderAttachmentList() {
  attachmentList.innerHTML = "";
  attachmentCount.textContent = `${currentAttachments.length}件`;
  attachmentUsage.textContent = `使用容量 ${formatAttachmentBytes(attachmentTotalSize())} / ${formatAttachmentBytes(MAX_ATTACHMENT_TOTAL_BYTES)}`;
  if (!currentAttachments.length) {
    const empty = document.createElement("p");
    empty.className = "attachment-empty";
    empty.textContent = "添付ファイルはありません。";
    attachmentList.appendChild(empty);
    return;
  }

  currentAttachments.forEach((attachment) => {
    const card = document.createElement("article");
    card.className = `attachment-card attachment-${attachment.kind}`;
    card.dataset.attachmentId = attachment.id;
    const details = document.createElement("div");
    details.className = "attachment-details";
    const name = document.createElement("div");
    name.className = "attachment-file-name";
    name.textContent = attachment.fileName;
    name.title = attachment.fileName;
    const size = document.createElement("div");
    size.className = "attachment-file-size";
    size.textContent = formatAttachmentBytes(attachment.size);
    details.append(name, size);

    if (attachment.kind === "image") {
      try {
        const objectUrl = getOrCreateAttachmentObjectUrl(attachment);
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "attachment-thumbnail-button";
        openButton.setAttribute("aria-label", `${attachment.fileName}を拡大表示`);
        const image = document.createElement("img");
        image.src = objectUrl;
        image.alt = `${attachment.fileName}のサムネイル`;
        image.loading = "lazy";
        openButton.appendChild(image);
        openButton.addEventListener("click", () => openImagePreview(attachment));
        card.appendChild(openButton);
      } catch (error) {
        console.error("Image URL creation failed", error);
        card.appendChild(document.createTextNode("画像を表示できません"));
      }
    } else {
      const icon = document.createElement("div");
      icon.className = "attachment-pdf-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "PDF";
      card.appendChild(icon);
    }

    const actions = document.createElement("div");
    actions.className = "attachment-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "開く";
    openButton.setAttribute("aria-label", `${attachment.fileName}を開く`);
    openButton.addEventListener("click", () => attachment.kind === "image" ? openImagePreview(attachment) : openPdfAttachment(attachment));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "削除";
    deleteButton.setAttribute("aria-label", `${attachment.fileName}を削除`);
    deleteButton.addEventListener("click", () => deleteAttachment(attachment));
    actions.append(openButton, deleteButton);
    card.append(details, actions);
    attachmentList.appendChild(card);
  });
}

function openImagePreview(attachment) {
  const objectUrl = attachmentObjectUrls.get(attachment.id);
  if (!objectUrl) {
    setAttachmentStatus(`「${attachment.fileName}」を表示できませんでした。`, true);
    return;
  }
  imagePreviewTitle.textContent = attachment.fileName;
  imagePreview.alt = attachment.fileName;
  imagePreview.src = objectUrl;
  imagePreviewDialog.showModal();
  closeImagePreviewBtn.focus();
}

function openPdfAttachment(attachment) {
  try {
    revokeAttachmentObjectUrl(attachment.id);
    const objectUrl = URL.createObjectURL(attachment.blob);
    pdfObjectUrls.set(attachment.id, objectUrl);
    const opened = window.open(objectUrl, "_blank");
    if (!opened) {
      revokeAttachmentObjectUrl(attachment.id);
      throw new Error("ポップアップがブロックされました");
    }
    opened.opener = null;
    pdfObjectUrlTimers.set(attachment.id, setTimeout(() => revokeAttachmentObjectUrl(attachment.id), 5 * 60 * 1000));
  } catch (error) {
    console.error("PDF open failed", error);
    setAttachmentStatus(`PDFを開けませんでした: ${error.message || error}`, true);
  }
}

async function deleteAttachment(attachment) {
  const note = currentNote();
  const isReferenced = attachment.kind === "image"
    && extractAttachmentReferenceIds(note && note.id === currentId ? editor.value : note?.body).has(attachment.id);
  const message = isReferenced
    ? `「${attachment.fileName}」は本文内で参照されています。\n削除後は本文の参照位置に「画像を表示できません」と表示されます。\n\n削除しますか？`
    : `「${attachment.fileName}」を削除しますか？`;
  if (!confirm(message)) return;
  try {
    await deleteAttachmentRecord(attachment.id);
    revokeAttachmentObjectUrl(attachment.id);
    currentAttachments = currentAttachments.filter((item) => item.id !== attachment.id);
    renderAttachmentList();
    renderPreview();
    setAttachmentStatus(`「${attachment.fileName}」を削除しました。`);
  } catch (error) {
    console.error("Attachment delete failed", error);
    setAttachmentStatus(`添付ファイルを削除できませんでした: ${error.message || error}`, true);
  }
}

async function handleAttachmentFiles(fileList, options = {}) {
  const note = currentNote();
  const files = Array.from(fileList || []);
  if (!note || note.deletedAt || !files.length) return [];
  updateAttachmentAdditionCount(note.id, 1);
  syncAttachmentAddControls();
  if (currentId === note.id) setAttachmentStatus(`${files.length}件の添付ファイルを確認しています...`);
  return enqueueAttachmentAddition(note.id, () => addAttachmentFilesForNote(note, files, options))
    .finally(() => {
      updateAttachmentAdditionCount(note.id, -1);
      syncAttachmentAddControls();
    });
}

async function addAttachmentFilesForNote(note, files, options) {
  try {
    if (options.imageBlockTarget) validatePendingImageBlock(options.imageBlockTarget);
    const prepared = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const kind = classifyAttachment(file);
      if (currentId === note.id) setAttachmentStatus(`${files.length}件中${index + 1}件を処理しています...`);
      prepared.push(await prepareAttachmentFile(file, kind, note.id));
    }

    const existing = await getAttachmentsForMemo(note.id);
    const currentBytes = attachmentTotalSize(existing);
    const additionalBytes = attachmentTotalSize(prepared);
    const capacity = attachmentCapacity(currentBytes, additionalBytes);
    if (!capacity.allowed) {
      throw new Error([
        "添付できません。",
        `添付後の合計容量が${formatAttachmentBytes(capacity.total)}となり、上限${formatAttachmentBytes(capacity.limit)}を超えます。`,
        `現在の使用量: ${formatAttachmentBytes(capacity.current)}`,
        `追加ファイル: ${formatAttachmentBytes(capacity.additional)}`,
        `超過容量: ${formatAttachmentBytes(capacity.exceededBy)}`
      ].join("\n"));
    }

    if (options.imageBlockTarget) {
      await saveAttachmentAdditionWithRollback({
        attachments: prepared,
        validate: () => validatePendingImageBlock(options.imageBlockTarget),
        save: putAttachments,
        apply: (items) => {
          currentAttachments = [
            ...currentAttachments.filter((attachment) => !items.some((item) => item.id === attachment.id)),
            ...items
          ];
          renderAttachmentList();
          insertStoredImageIntoBlock(items, options.imageBlockTarget);
        },
        rollback: rollbackImageBlockAttachments
      });
    } else {
      await putAttachments(prepared);
      if (currentId === note.id) {
        await renderAttachmentsForCurrentNote();
      }
    }
    if (currentId === note.id) {
      if (options.insertIntoEditor && !options.imageBlockTarget) {
        await insertStoredImageReferences(prepared, options);
      }
      setAttachmentStatus(`${prepared.length}件の添付ファイルを追加しました。`);
    }
    return prepared;
  } catch (error) {
    console.error("Attachment add failed", error);
    const rollbackMessage = error.rollbackError ? "（追加画像のロールバックにも失敗しました）" : "";
    if (currentId === note.id) setAttachmentStatus(`${error.message || String(error)}${rollbackMessage}`, true);
    return [];
  }
}

async function insertStoredImageReferences(attachments, options) {
  const result = insertAttachmentReferences(
    editor.value,
    options.selectionStart,
    options.selectionEnd,
    attachments
  );
  if (!result.insertedText) return;
  captureUndoSnapshot({ inputType: options.inputType || "insertFromPaste" });
  editor.value = result.value;
  editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  scheduleSave();
  await flushSave();
}

async function prepareAttachmentFile(file, kind, memoId) {
  const now = new Date().toISOString();
  if (kind === "pdf") {
    await validatePdfBlob(file);
    return {
      id: crypto.randomUUID(),
      memoId,
      kind,
      fileName: file.name,
      mimeType: "application/pdf",
      size: file.size,
      blob: file.slice(0, file.size, "application/pdf"),
      createdAt: now
    };
  }

  const compressed = await compressAttachmentImage(file);
  return {
    id: crypto.randomUUID(),
    memoId,
    kind,
    fileName: file.name,
    mimeType: compressed.blob.type || file.type,
    size: compressed.blob.size,
    originalSize: file.size,
    blob: compressed.blob,
    width: compressed.width,
    height: compressed.height,
    createdAt: now
  };
}

async function validatePdfBlob(file) {
  const headerBytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const header = new TextDecoder("latin1").decode(headerBytes);
  if (!header.includes("%PDF-")) throw new Error(`「${file.name}」は有効なPDFとして認識できません`);
}

async function compressAttachmentImage(file) {
  let decoded;
  try {
    decoded = await decodeAttachmentImage(file);
    const scale = Math.min(1, MAX_ATTACHMENT_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: file.type !== "image/jpeg" });
    if (!context) throw new Error("画像処理用Canvasを利用できません");
    context.drawImage(decoded.source, 0, 0, width, height);
    const candidate = await canvasToBlob(canvas, file.type, file.type === "image/png" ? undefined : ATTACHMENT_IMAGE_QUALITY);
    if (!candidate || !candidate.size) throw new Error("画像の圧縮結果を生成できません");
    if (candidate.type !== file.type) throw new Error(`${file.type}形式で圧縮できません`);
    const blob = scale < 1 || candidate.size < file.size
      ? candidate
      : file.slice(0, file.size, file.type);
    return { blob, width, height };
  } catch (error) {
    throw new Error(`「${file.name}」の画像圧縮に失敗しました: ${error.message || error}`);
  } finally {
    if (decoded && typeof decoded.close === "function") decoded.close();
  }
}

async function decodeAttachmentImage(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new Error("画像サイズを取得できません");
    }
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("画像を読み込めません"));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("画像サイズを取得できません");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像をBlobへ変換できません")), type, quality);
  });
}

function handleClipboardAttachmentPaste(event) {
  const clipboardData = event.clipboardData;
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  const imageItems = Array.from(clipboardData && clipboardData.items || [])
    .filter((item) => item.kind === "file" && supportedTypes.includes(item.type));
  const clipboardFiles = Array.from(clipboardData && clipboardData.files || [])
    .filter((file) => supportedTypes.includes(file.type));
  const plainText = clipboardData ? clipboardData.getData("text/plain").trim() : "";
  if (!imageItems.length && !clipboardFiles.length) {
    if (plainText.startsWith("blob:")) {
      event.preventDefault();
      setAttachmentStatus("一時的なblob URLは本文へ貼り付けられません。画像データをコピーし直してください。", true);
      return true;
    }
    return false;
  }
  const note = currentNote();
  if (!note || note.deletedAt) return false;
  event.preventDefault();
  const selectionStart = editor.selectionStart;
  const selectionEnd = editor.selectionEnd;
  const itemFiles = imageItems.map((item, index) => {
    const blob = item.getAsFile();
    if (!blob) return null;
    const extension = item.type === "image/jpeg" ? "jpg" : item.type.split("/")[1];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new File([blob], `clipboard-${stamp}-${index + 1}.${extension}`, { type: item.type });
  }).filter(Boolean);
  const files = itemFiles.length ? itemFiles : clipboardFiles;
  if (!files.length) {
    setAttachmentStatus("クリップボードから画像データを取得できませんでした。画像をコピーし直してください。", true);
    return true;
  }
  handleAttachmentFiles(files, {
    insertIntoEditor: true,
    inputType: "insertFromPaste",
    selectionStart,
    selectionEnd
  });
  return true;
}

function restoreTablePasteEditorContext(pending) {
  if (!pending || currentId !== pending.noteId) return;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(pending.selectionStart, pending.selectionEnd);
}

function closeTablePasteDialog({ restoreFocus = true } = {}) {
  const pending = pendingTablePaste;
  pendingTablePaste = null;
  if (tablePasteDialog?.open) tablePasteDialog.close();
  if (restoreFocus) requestAnimationFrame(() => restoreTablePasteEditorContext(pending));
}

function openTablePasteDialog(detected, selectionStart, selectionEnd) {
  const note = currentNote();
  if (!note || note.deletedAt || !tablePasteDialog) return;
  const size = validatePastedTableSize(detected.rows);
  pendingTablePaste = {
    noteId: note.id,
    editorValue: editor.value,
    selectionStart,
    selectionEnd,
    detected,
    size
  };
  const exceedsLimit = !size.allowed;
  tablePasteTitle.textContent = exceedsLimit ? "貼り付ける表が上限を超えています" : "表として貼り付けますか？";
  tablePasteSummary.textContent = exceedsLimit
    ? `検出したサイズ：${size.rowCount}行 × ${size.columnCount}列（${size.cellCount}セル）`
    : `${size.rowCount}行 × ${size.columnCount}列のデータを検出しました。`;
  tablePasteFormat.textContent = `検出形式：${detected.formatLabel}`;
  const warnings = [];
  if (exceedsLimit) {
    warnings.push(
      `貼り付け可能な上限：${TABLE_PASTE_LIMITS.rows}行 × ${TABLE_PASTE_LIMITS.columns}列（${TABLE_PASTE_LIMITS.cells}セル）`,
      "データは変更されていません。"
    );
  } else if (detected.hasMergedCells) {
    warnings.push("結合セルは左上セルへ値を置き、残りを空セルとして変換します。元の結合表示は完全には再現されません。");
  }
  tablePasteWarning.textContent = warnings.join("\n");
  tablePasteWarning.hidden = warnings.length === 0;
  tablePasteHeaderOption.hidden = exceedsLimit;
  tablePasteHeaderCheckbox.checked = detected.hasHeader !== false;
  confirmTablePasteBtn.hidden = exceedsLimit;
  tablePasteDialog.showModal();
  (exceedsLimit ? pasteTableAsTextBtn : confirmTablePasteBtn).focus();
}

function pendingTablePasteIsCurrent(pending) {
  return Boolean(pending)
    && currentId === pending.noteId
    && editor.value === pending.editorValue
    && currentNote()
    && !currentNote().deletedAt;
}

function insertPastedPlainText() {
  const pending = pendingTablePaste;
  if (!pendingTablePasteIsCurrent(pending)) {
    closeTablePasteDialog({ restoreFocus: false });
    alert("貼り付け先のメモが変更されたため、貼り付けをキャンセルしました。");
    return;
  }
  const text = pending.detected.plainText;
  captureUndoSnapshot({ inputType: "insertFromPaste" });
  editor.value = `${editor.value.slice(0, pending.selectionStart)}${text}${editor.value.slice(pending.selectionEnd)}`;
  const nextPosition = pending.selectionStart + text.length;
  closeTablePasteDialog({ restoreFocus: false });
  renderTableBlockEditors();
  renderPreview();
  scheduleSave({ render: false });
  editor.focus();
  editor.setSelectionRange(nextPosition, nextPosition);
}

function insertPastedTable() {
  const pending = pendingTablePaste;
  if (!pendingTablePasteIsCurrent(pending) || !pending.size.allowed) {
    closeTablePasteDialog({ restoreFocus: false });
    alert("貼り付け先のメモが変更されたため、貼り付けをキャンセルしました。");
    return;
  }
  const tableId = crypto.randomUUID();
  const table = normalizeTableBlock({
    ...createTableBlock(tableId),
    rows: pending.detected.rows,
    hasHeader: tablePasteHeaderCheckbox.checked,
    alignments: pending.detected.alignments
  }, tableId);
  const result = insertTableBlock(
    editor.value,
    pending.selectionStart,
    pending.selectionEnd,
    table
  );
  captureUndoSnapshot({ inputType: "insertFromPaste" });
  editor.value = result.value;
  editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  tableAxisSelections.delete(table.id);
  closeTablePasteDialog({ restoreFocus: false });
  renderTableBlockEditors();
  renderPreview();
  scheduleSave({ render: false });
  focusTableCell(table.id, 0, 0);
}

function editorSelectionIsInsideCodeFence() {
  const lines = editor.value.slice(0, editor.selectionStart).replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;
  lines.forEach((line) => {
    if (/^\s*```/.test(line)) inCodeFence = !inCodeFence;
  });
  return inCodeFence;
}

function handleEditorPaste(event) {
  if (handleClipboardAttachmentPaste(event)) return;
  const clipboardData = event.clipboardData;
  if (!clipboardData || editorSelectionIsInsideCodeFence()) return;
  const detected = detectPastedTable({
    html: clipboardData.getData("text/html"),
    text: clipboardData.getData("text/plain")
  });
  if (!detected) return;
  const note = currentNote();
  if (!note || note.deletedAt) return;
  event.preventDefault();
  openTablePasteDialog(detected, editor.selectionStart, editor.selectionEnd);
}

function editorDropHasFiles(event) {
  const dataTransfer = event.dataTransfer;
  return Boolean(dataTransfer) && (
    Array.from(dataTransfer.files || []).length > 0
    || Array.from(dataTransfer.types || []).includes("Files")
  );
}

function handleEditorAttachmentDrop(event) {
  if (!editorDropHasFiles(event)) return;
  const note = currentNote();
  if (!note || note.deletedAt) return;
  event.preventDefault();
  event.stopPropagation();
  const files = Array.from(event.dataTransfer.files || []);
  if (!files.length) return;
  handleAttachmentFiles(files, {
    insertIntoEditor: true,
    inputType: "insertFromDrop",
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd
  });
}

function renderPreviewHtml(body, noteId = "preview", renderGeneration = 0) {
  let codeBlockIndex = 0;
  let tableBlockIndex = 0;
  const html = splitImageBlocks(body)
    .map((segment, imageBlockIndex) => {
      if (segment.type === "image") return renderImageBlock(segment, imageBlockIndex);
      return splitTableBlocks(segment.text).map((tableSegment) => {
        if (tableSegment.type === "table") {
          const rendered = renderTableBlock(tableSegment.table, tableBlockIndex);
          tableBlockIndex += 1;
          return rendered;
        }
        return splitFencedBlocks(tableSegment.text).map((block) => {
          if (block.type !== "code") {
            return splitMathAndCalculationBlocks(block.text).map((richBlock) => {
              if (richBlock.type === "math") return renderMathBlock(richBlock.source);
              if (richBlock.type === "calculation") return renderCalculationBlock(richBlock.source);
              return renderTextBlock(richBlock.text);
            }).join("");
          }
          const rendered = block.language.toLowerCase() === "mermaid"
            ? renderMermaidBlock(block.code, noteId, renderGeneration, codeBlockIndex)
            : renderCodeBlock(block.code, block.language);
          codeBlockIndex += 1;
          return rendered;
        }).join("");
      }).join("");
    })
    .filter(Boolean)
    .join("");

  return html || `<p class="empty">本文を書くとカード表示されます。</p>`;
}

function renderTableBlock(tableValue, blockIndex) {
  const table = normalizeTableBlock(tableValue, `table-${blockIndex + 1}`);
  const headerRows = table.hasHeader ? table.rows.slice(0, 1) : [];
  const bodyRows = table.hasHeader ? table.rows.slice(1) : table.rows;
  const renderRows = (rows, cellTag) => rows.map((row) => `<tr>${row
    .map((cell, columnIndex) => {
      const alignment = tableColumnAlignment(table, columnIndex);
      const style = alignment ? ` style="text-align: ${alignment}"` : "";
      return `<${cellTag}${style}>${escapeHtml(cell)}</${cellTag}>`;
    })
    .join("")}</tr>`).join("");
  const caption = table.caption
    ? `<figcaption class="table-block-caption">${escapeHtml(table.caption)}</figcaption>`
    : "";
  const note = table.note
    ? `<p class="table-block-note">${escapeHtml(table.note)}</p>`
    : "";
  const thead = headerRows.length ? `<thead>${renderRows(headerRows, "th")}</thead>` : "";
  const tbody = `<tbody>${renderRows(bodyRows, "td")}</tbody>`;
  const label = table.caption.trim() || `表ブロック${blockIndex + 1}`;
  return `
    <figure class="table-block" data-table-id="${escapeAttr(table.id)}">
      ${caption}
      <div class="table-block-scroll" tabindex="0" role="region" aria-label="${escapeAttr(label)}">
        <table aria-label="${escapeAttr(label)}">${thead}${tbody}</table>
      </div>
      ${note}
    </figure>
  `;
}

function renderImageBlock(block, blockIndex) {
  const count = block.images.length;
  const images = block.images.map((image) => `
    <div class="image-block-item">
      <button class="image-block-open" type="button" data-image-id="${escapeAttr(image.id)}" aria-label="${escapeAttr(image.alt || "添付画像")}を拡大表示">
        <span class="inline-attachment-image" data-attachment-id="${escapeAttr(image.id)}" data-alt="${escapeAttr(image.alt)}" role="img" aria-label="${escapeAttr(image.alt || "添付画像")}">画像を読み込み中...</span>
      </button>
    </div>
  `).join("");
  const caption = block.caption
    ? `<figcaption class="image-block-caption">${renderImageCaptionMarkdown(block.caption)}</figcaption>`
    : "";
  return `
    <figure class="image-block image-count-${count} image-size-${imageBlockSize}${block.caption ? " has-caption" : ""}" data-image-block-index="${blockIndex}" tabindex="0">
      <div class="image-block-media">${images}</div>
      ${caption}
      <div class="image-block-menu-shell">
        <button class="image-block-menu-toggle" type="button" aria-label="画像ブロック操作メニュー" aria-expanded="false" aria-controls="image-block-menu-${blockIndex}">…</button>
        <div id="image-block-menu-${blockIndex}" class="image-block-actions" aria-label="画像ブロック操作" hidden>
          ${count < 2 ? '<button class="image-block-add" type="button">画像を追加</button>' : ""}
          ${count === 2 ? '<button class="image-block-swap" type="button">左右を入れ替える</button>' : ""}
          <button class="image-block-edit-caption" type="button">${block.caption ? "説明文を編集" : "説明文を追加"}</button>
          ${block.images.map((_, imageIndex) => `<button class="image-block-remove" type="button" data-image-index="${imageIndex}">画像${imageIndex + 1}を外す</button>`).join("")}
        </div>
      </div>
    </figure>
  `;
}

function splitFencedBlocks(body) {
  const lines = String(body).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let textLines = [];
  let codeLines = [];
  let language = "";
  let inCode = false;

  lines.forEach((line) => {
    const fence = line.match(/^```\s*([^\s`]*)\s*$/);
    if (fence) {
      if (inCode) {
        blocks.push({ type: "code", code: codeLines.join("\n"), language });
        codeLines = [];
        language = "";
        inCode = false;
        return;
      }

      if (textLines.length) {
        blocks.push({ type: "text", text: textLines.join("\n") });
        textLines = [];
      }
      language = fence[1] || "";
      inCode = true;
      return;
    }

    if (inCode) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  });

  if (inCode) {
    blocks.push({ type: "code", code: codeLines.join("\n"), language });
  } else if (textLines.length) {
    blocks.push({ type: "text", text: textLines.join("\n") });
  }

  return blocks;
}

function splitMathAndCalculationBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let textLines = [];
  let index = 0;

  const flushText = () => {
    if (!textLines.length) return;
    blocks.push({ type: "text", text: textLines.join("\n") });
    textLines = [];
  };

  while (index < lines.length) {
    const marker = lines[index].trim();
    const type = marker === "$$" ? "math" : (marker === ":::calc" ? "calculation" : "");
    if (!type) {
      textLines.push(lines[index]);
      index += 1;
      continue;
    }

    const closingMarker = type === "math" ? "$$" : ":::";
    let closingIndex = index + 1;
    while (closingIndex < lines.length && lines[closingIndex].trim() !== closingMarker) {
      closingIndex += 1;
    }

    if (closingIndex >= lines.length) {
      textLines.push(lines[index]);
      index += 1;
      continue;
    }

    flushText();
    blocks.push({
      type,
      source: lines.slice(index + 1, closingIndex).join("\n").trim()
    });
    index = closingIndex + 1;
  }

  flushText();
  return blocks;
}

function renderMathBlock(source) {
  return `<div class="math-block" data-math-source="${escapeAttr(source)}" data-math-display="block">${escapeHtml(source)}</div>`;
}

function renderCalculationBlock(source) {
  const expression = String(source || "").trim();
  const nonEmptyLines = expression.split("\n").filter((line) => line.trim());
  const engine = typeof window === "object" ? window.MemoCalculationEngine : null;
  const evaluator = typeof window === "object" && window.math ? window.math.evaluate.bind(window.math) : null;

  try {
    if (nonEmptyLines.length !== 1) {
      throw new Error(nonEmptyLines.length ? "複数行計算には対応していません" : "式を入力してください");
    }
    if (!engine) throw new Error("計算エンジンを利用できません");
    const calculation = engine.evaluateExpression(nonEmptyLines[0].trim(), evaluator);
    return `
      <section class="calculation-block" aria-label="計算結果">
        <span class="calculation-label">計算</span>
        <div class="calculation-expression">${escapeHtml(calculation.displayExpression)}</div>
        <div class="calculation-result"><span aria-hidden="true">=</span> ${escapeHtml(calculation.result)}</div>
      </section>
    `;
  } catch (error) {
    console.error("Calculation block failed", { expression, error });
    return `
      <section class="calculation-block calculation-error" aria-label="計算エラー">
        <span class="calculation-label">計算</span>
        <strong>計算できません</strong>
        <code>${escapeHtml(expression)}</code>
      </section>
    `;
  }
}

function hydrateMathExpressions() {
  preview.querySelectorAll("[data-math-source]").forEach((element) => {
    const source = element.dataset.mathSource || "";
    const displayMode = element.dataset.mathDisplay === "block";
    try {
      if (!window.katex) throw new Error("KaTeXを利用できません");
      window.katex.render(source, element, {
        displayMode,
        throwOnError: true,
        strict: "warn",
        trust: false,
        output: "htmlAndMathml"
      });
    } catch (error) {
      console.error("KaTeX render failed", { source, error });
      element.textContent = "";
      element.classList.add("math-error", displayMode ? "math-error-block" : "math-error-inline");
      const message = document.createElement("strong");
      message.textContent = "数式を表示できません";
      const original = document.createElement("code");
      original.textContent = source;
      element.append(message, original);
    }
  });
}

function renderTextBlock(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  return renderMarkdownLines(lines);
}

function renderMarkdownLines(lines) {
  const html = [];
  let paragraphLines = [];
  let index = 0;

  const flushParagraph = () => {
    const paragraph = paragraphLines.join("\n").trim();
    if (paragraph) {
      html.push(`<p>${renderMarkdownInline(paragraph)}</p>`);
    }
    paragraphLines = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${renderMarkdownInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      flushParagraph();
      const listLines = [];
      while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      html.push(renderListBlock(listLines));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const listLines = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      html.push(renderOrderedListBlock(listLines));
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim());
        index += 1;
      }
      html.push(renderQuoteOrCalloutBlock(quoteLines));
      continue;
    }

    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushParagraph();
      html.push("<hr>");
      index += 1;
      continue;
    }

    paragraphLines.push(line.trimEnd());
    index += 1;
  }

  flushParagraph();
  return html.join("");
}

function renderListBlock(lines) {
  return `<ul>${lines.map((line) => {
    const content = line.replace(/^-\s+/, "");
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (!task) return `<li>${renderMarkdownInline(content)}</li>`;
    const taskIndex = nextChecklistIndex();
    const checked = task[1].toLowerCase() === "x";
    return `<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-task-index="${taskIndex}"${checked ? " checked" : ""} aria-label="${checked ? "完了" : "未完了"}"><span>${renderMarkdownInline(task[2])}</span></li>`;
  }).join("")}</ul>`;
}

function normalizeExplanations(note) {
  if (!Array.isArray(note.explanations)) note.explanations = [];
  return note.explanations;
}

const saveExplanationCollapsedState = createExplanationCollapsedStateSaver({
  getNote: (noteId) => notes.find((note) => note.id === noteId),
  putNote,
  now: () => Date.now(),
  afterSave: async () => { notes = await getAllNotes(); }
});

function hydrateExplanationCards(note, body) {
  const explanations = normalizeExplanations(note);
  hydrateExplanationCardsIntoDom(preview, body, explanations, {
    onMarkerActivate: (explanation) => document.getElementById(`explanation-card-${explanation.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    onPersistCollapsed: (explanation, collapsed) => saveExplanationCollapsedState(note.id, explanation.id, collapsed),
    onEdit: (explanation) => openExplanationDialog(explanation),
    onDelete: (id) => deleteExplanation(id)
  });
}

function bindChecklistControls(note) {
  const entries = checklistEntries(editor.value);
  preview.querySelectorAll(".task-list-checkbox").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const targetIndex = Number(checkbox.dataset.taskIndex);
    const entry = entries[targetIndex];
    if (!entry) return;
    const nextBody = updateChecklistAt(editor.value, entry.markerStart, checkbox.checked);
    if (nextBody !== editor.value && note.id === currentId) {
      captureUndoSnapshot();
      editor.value = nextBody;
      scheduleSave();
    }
  }));
}

let checklistRenderIndex = 0;
function nextChecklistIndex() { const index = checklistRenderIndex; checklistRenderIndex += 1; return index; }

function renderOrderedListBlock(lines) {
  const firstItem = lines[0]?.match(/^(\d+)\.\s+/);
  const start = firstItem ? Number.parseInt(firstItem[1], 10) : 1;
  const startAttribute = start > 1 ? ` start="${start}"` : "";
  return `<ol${startAttribute}>${lines.map((line) => `<li>${renderMarkdownInline(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
}

function renderQuoteOrCalloutBlock(lines) {
  const rawLines = lines.map((line) => line.replace(/^>\s?/, ""));
  const callout = rawLines[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*$/i);
  if (callout) {
    const type = callout[1].toUpperCase();
    const icons = { NOTE: "ℹ", TIP: "✦", IMPORTANT: "❗", WARNING: "⚠" };
    const content = rawLines.slice(1).map(renderMarkdownInline).join("<br>");
    return `<aside class="callout callout-${type.toLowerCase()}" role="note"><strong class="callout-title"><span aria-hidden="true">${icons[type]}</span> ${type}</strong><div>${content}</div></aside>`;
  }
  const content = lines
    .map((line) => renderMarkdownInline(line.replace(/^>\s?/, "")))
    .join("<br>");
  return `<blockquote>${content}</blockquote>`;
}

function renderAutomaticTermText(text, automaticTerms) {
  const matches = findAutomaticTermMatches(text, automaticTerms);
  if (!matches.length) return escapeHtml(text);

  let html = "";
  let index = 0;
  matches.forEach((match) => {
    html += escapeHtml(text.slice(index, match.start));
    html += renderWikiButton(match.term, "automatic");
    index = match.end;
  });
  return html + escapeHtml(text.slice(index));
}

function renderMarkdownInline(text, { automaticTerms = previewAutomaticTerms, automaticEnabled = true } = {}) {
  const renderPlainText = (value) => automaticEnabled ? renderAutomaticTermText(value, automaticTerms) : escapeHtml(value);
  let html = "";
  let index = 0;

  while (index < text.length) {
    const token = findNextInlineToken(text, index);
    if (!token) {
      html += renderPlainText(text.slice(index));
      break;
    }

    html += renderPlainText(text.slice(index, token.start));
    if (token.type === "code") {
      html += `<code class="inline-code">${escapeHtml(token.content)}</code>`;
    } else if (token.type === "wiki") {
      html += renderWikiButton(token.content);
    } else if (token.type === "bold") {
      html += `<strong>${renderMarkdownInline(token.content, { automaticTerms, automaticEnabled })}</strong>`;
    } else if (token.type === "italic") {
      html += `<em>${renderMarkdownInline(token.content, { automaticTerms, automaticEnabled })}</em>`;
    } else if (token.type === "strike") {
      html += `<del>${renderMarkdownInline(token.content, { automaticTerms, automaticEnabled })}</del>`;
    } else if (token.type === "link") {
      html += `<a class="markdown-link" href="${escapeAttr(token.href)}" target="_blank" rel="noopener noreferrer">${renderMarkdownInline(token.content, { automaticTerms, automaticEnabled: false })}</a>`;
    } else if (token.type === "image") {
      html += `<span class="markdown-image-alt" role="img" aria-label="${escapeAttr(token.alt || "画像")}">${renderMarkdownInline(token.alt || "画像", { automaticTerms, automaticEnabled: false })}</span>`;
    } else if (token.type === "attachment") {
      html += `<span class="inline-attachment-image" data-attachment-id="${escapeAttr(token.id)}" data-alt="${escapeAttr(token.alt)}" role="img" aria-label="${escapeAttr(token.alt || "添付画像")}">画像を読み込み中...</span>`;
    } else if (token.type === "math") {
      html += `<span class="math-inline" data-math-source="${escapeAttr(token.content)}">${escapeHtml(token.content)}</span>`;
    }
    index = token.end;
  }

  return html;
}

function findNextInlineToken(text, fromIndex) {
  const tokens = [];

  const attachmentReference = findAttachmentReference(text, fromIndex);
  if (attachmentReference) {
    tokens.push({
      type: "attachment",
      start: attachmentReference.start,
      end: attachmentReference.end,
      alt: attachmentReference.alt,
      id: attachmentReference.id
    });
  }

  const codeStart = text.indexOf("`", fromIndex);
  if (codeStart !== -1) {
    const codeEnd = text.indexOf("`", codeStart + 1);
    if (codeEnd !== -1) {
      tokens.push({
        type: "code",
        start: codeStart,
        end: codeEnd + 1,
        content: text.slice(codeStart + 1, codeEnd)
      });
    }
  }

  const mathToken = findInlineMathToken(text, fromIndex);
  if (mathToken) tokens.push(mathToken);

  const wikiPattern = /\[\[([^\]]+)\]\]/g;
  wikiPattern.lastIndex = fromIndex;
  const wikiMatch = wikiPattern.exec(text);
  if (wikiMatch) {
    tokens.push({
      type: "wiki",
      start: wikiMatch.index,
      end: wikiPattern.lastIndex,
      content: wikiMatch[1]
    });
  }

  const linkPattern = /(?<!!)\[([^\]]+)\]\(([^\s)]+)\)/g;
  linkPattern.lastIndex = fromIndex;
  const linkMatch = linkPattern.exec(text);
  if (linkMatch && safeExternalUrl(linkMatch[2])) {
    tokens.push({ type: "link", start: linkMatch.index, end: linkPattern.lastIndex, content: linkMatch[1], href: linkMatch[2] });
  }

  const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)\)/g;
  imagePattern.lastIndex = fromIndex;
  const imageMatch = imagePattern.exec(text);
  if (imageMatch && safeExternalUrl(imageMatch[2])) {
    tokens.push({ type: "image", start: imageMatch.index, end: imagePattern.lastIndex, alt: imageMatch[1] });
  }

  const boldStart = text.indexOf("**", fromIndex);
  if (boldStart !== -1) {
    const boldEnd = text.indexOf("**", boldStart + 2);
    if (boldEnd !== -1) {
      tokens.push({
        type: "bold",
        start: boldStart,
        end: boldEnd + 2,
        content: text.slice(boldStart + 2, boldEnd)
      });
    }
  }

  const strike = findDelimitedInlineToken(text, fromIndex, "~~", "strike");
  if (strike) tokens.push(strike);
  const italicStar = findDelimitedInlineToken(text, fromIndex, "*", "italic", { rejectDouble: true });
  const italicUnderscore = findDelimitedInlineToken(text, fromIndex, "_", "italic", { wordBoundary: true });
  if (italicStar) tokens.push(italicStar);
  if (italicUnderscore) tokens.push(italicUnderscore);

  return tokens.sort((a, b) => a.start - b.start || a.end - b.end)[0] || null;
}

function findDelimitedInlineToken(text, fromIndex, delimiter, type, options = {}) {
  for (let start = text.indexOf(delimiter, fromIndex); start !== -1; start = text.indexOf(delimiter, start + delimiter.length)) {
    if (isEscapedMarkdownCharacter(text, start)) continue;
    if (options.rejectDouble && (text[start - 1] === "*" || text[start + 1] === "*")) continue;
    if (options.wordBoundary && /[\p{L}\p{N}]/u.test(text[start - 1] || "")) continue;
    const end = text.indexOf(delimiter, start + delimiter.length);
    if (end === -1 || isEscapedMarkdownCharacter(text, end)) continue;
    if (options.rejectDouble && (text[end - 1] === "*" || text[end + 1] === "*")) continue;
    if (options.wordBoundary && /[\p{L}\p{N}]/u.test(text[end + 1] || "")) continue;
    const content = text.slice(start + delimiter.length, end);
    if (content.trim()) return { type, start, end: end + delimiter.length, content };
  }
  return null;
}

function isEscapedMarkdownCharacter(text, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

function findInlineMathToken(text, fromIndex) {
  const isEscaped = (index) => {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashCount += 1;
    return slashCount % 2 === 1;
  };

  for (let start = fromIndex; start < text.length; start += 1) {
    if (text[start] !== "$" || isEscaped(start) || text[start + 1] === "$" || text[start - 1] === "$") continue;
    for (let end = start + 1; end < text.length; end += 1) {
      if (text[end] === "\n") break;
      if (text[end] !== "$" || isEscaped(end) || text[end + 1] === "$") continue;
      const content = text.slice(start + 1, end);
      if (!content.trim()) break;
      return { type: "math", start, end: end + 1, content };
    }
  }
  return null;
}

function renderCodeBlock(code, language) {
  const normalizedLanguage = normalizeHighlightLanguage(language);
  const languageClass = normalizedLanguage ? ` language-${escapeAttr(normalizedLanguage)}` : "";
  const languageLabel = language ? ` data-language="${escapeAttr(language)}"` : "";
  return `<pre class="code-block"${languageLabel}><code class="code-content${languageClass}">${escapeHtml(code)}</code></pre>`;
}

function normalizeHighlightLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase();
  return HIGHLIGHT_LANGUAGE_ALIASES[normalized] || normalized;
}

function highlightCodeBlocks() {
  preview.querySelectorAll("pre.code-block > code.code-content").forEach((codeElement) => {
    highlightCodeBlock(codeElement);
  });
}

function highlightCodeBlock(codeElement) {
  const code = codeElement.textContent;
  if (!code || !window.hljs) return;

  const languageClass = [...codeElement.classList]
    .find((className) => className.startsWith("language-"));
  const language = languageClass ? languageClass.slice("language-".length) : "";

  try {
    if (language) {
      if (!window.hljs.getLanguage(language)) return;
      const result = window.hljs.highlight(code, {
        language,
        ignoreIllegals: true
      });
      applyHighlightResult(codeElement, result.value, language);
      return;
    }

    const result = window.hljs.highlightAuto(code);
    if (!result.language || result.relevance < HIGHLIGHT_AUTO_MIN_RELEVANCE) return;
    applyHighlightResult(codeElement, result.value, result.language);
  } catch (error) {
    console.warn("Code highlight failed; showing plain code", error);
    codeElement.textContent = code;
    codeElement.classList.remove("hljs");
  }
}

function applyHighlightResult(codeElement, highlightedHtml, language) {
  codeElement.innerHTML = highlightedHtml;
  codeElement.classList.add("hljs");
  codeElement.dataset.highlightedLanguage = language;
}

function renderMermaidBlock(code, noteId, renderGeneration, index) {
  const diagramId = mermaidDiagramDomId(noteId, renderGeneration, index);
  return `
    <div class="mermaid-block">
      <div class="mermaid-diagram" id="${diagramId}">${escapeHtml(code)}</div>
      <pre class="mermaid-source" hidden><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function mermaidDiagramDomId(noteId, renderGeneration, index) {
  return `mermaid-diagram-${stableMermaidIdPart(noteId)}-g${renderGeneration}-b${index}`;
}

function stableMermaidIdPart(value) {
  const text = String(value ?? "preview");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getMermaidConfig(theme = currentTheme()) {
  const isDarkMode = theme === "dark";
  const fontFamily = '"Yu Gothic UI", "Hiragino Sans", Meiryo, system-ui, sans-serif';
  return {
    startOnLoad: false,
    theme: isDarkMode ? "dark" : "default",
    darkMode: isDarkMode,
    securityLevel: "strict",
    fontFamily,
    markdownAutoWrap: true,
    flowchart: {
      htmlLabels: false,
      wrappingWidth: 200
    },
    themeVariables: {
      fontFamily,
      fontSize: "16px"
    }
  };
}

function configureMermaidForTheme(mermaid, theme, configuredTheme) {
  if (configuredTheme === theme) return configuredTheme;
  mermaid.initialize(getMermaidConfig(theme));
  return theme;
}

function prepareMermaidSource(source) {
  const text = String(source ?? "");
  if (!/^\s*(?:flowchart|graph)\b/i.test(text)) return text;

  const wrapLongLabel = (match, prefix, label, suffix) => (
    label.trim().length >= 20 ? `${prefix}\`${label}\`${suffix}` : match
  );
  const quotedLabel = /([A-Za-z0-9_-]+\s*[\[{]\s*")([^"`<>\r\n]+)("\s*[\]}])/g;
  const plainLabel = /([A-Za-z0-9_-]+\s*[\[{]\s*)(?!["`])([^"`<>\r\n]+?)(\s*[\]}])/g;
  return text
    .replace(quotedLabel, wrapLongLabel)
    .replace(plainLabel, (match, prefix, label, suffix) => (
      label.trim().length >= 20 ? `${prefix}"\`${label.trim()}\`"${suffix}` : match
    ));
}

async function renderMermaidDiagrams(previewRoot, renderGeneration) {
  const renderTask = mermaidRenderQueue.then(async () => {
    if (!isCurrentMermaidPreview(previewRoot, renderGeneration) || !window.mermaid) return;

    const diagrams = Array.from(previewRoot.querySelectorAll(".mermaid-diagram"));
    if (!diagrams.length) return;

    mermaidConfiguredTheme = configureMermaidForTheme(
      window.mermaid,
      currentTheme(),
      mermaidConfiguredTheme
    );

    await renderMermaidGeneration({
      diagrams,
      mermaid: window.mermaid,
      isCurrent: () => isCurrentMermaidPreview(previewRoot, renderGeneration),
      createRenderHost: createMermaidRenderHost,
      nextRenderId: (index) => nextMermaidSvgRenderId(renderGeneration, index),
      prepareSource: prepareMermaidSource,
      namespaceSvgIds: namespaceMermaidSvgIds,
      onError: (block, error) => {
        console.error("Mermaid render failed", error);
        showMermaidError(block);
      }
    });
  });

  try {
    mermaidRenderQueue = renderTask.catch(() => {});
    await renderTask;
  } catch (error) {
    console.error("Mermaid render failed", error);
    if (!isCurrentMermaidPreview(previewRoot, renderGeneration)) return;
    previewRoot.querySelectorAll(".mermaid-diagram").forEach((diagram) => {
      if (!diagram.querySelector("svg")) {
        showMermaidError(diagram.closest(".mermaid-block"));
      }
    });
  }
}

async function renderMermaidGeneration({
  diagrams,
  mermaid,
  isCurrent,
  createRenderHost,
  nextRenderId,
  prepareSource = (source) => source,
  namespaceSvgIds = () => {},
  onError
}) {
  for (const [index, diagram] of diagrams.entries()) {
    if (!isCurrent()) return;

    const block = diagram.closest(".mermaid-block");
    const source = prepareSource(diagram.textContent);
    const renderId = nextRenderId(index);
    const renderHost = createRenderHost(renderId);

    try {
      const { svg, bindFunctions } = await mermaid.render(renderId, source, renderHost);
      if (!isCurrent()) return;

      diagram.innerHTML = svg;
      if (diagram.querySelectorAll("svg").length !== 1) {
        diagram.innerHTML = "";
        throw new Error("Mermaid must render exactly one SVG per block");
      }
      namespaceSvgIds(diagram.querySelector("svg"), renderId);
      if (bindFunctions) bindFunctions(diagram);
    } catch (error) {
      if (isCurrent()) onError(block, error);
    } finally {
      renderHost.remove();
    }
  }
}

function namespaceMermaidSvgIds(svg, namespace) {
  if (!svg) return;

  const idMap = new Map();
  const idCounts = new Map();
  svg.querySelectorAll("[id]").forEach((element) => {
    const oldId = element.id;
    const count = (idCounts.get(oldId) || 0) + 1;
    idCounts.set(oldId, count);
    const newId = `${namespace}-${oldId}${count > 1 ? `-${count}` : ""}`;
    if (!idMap.has(oldId)) idMap.set(oldId, newId);
    element.id = newId;
  });

  const replaceReferences = (value, attributeName) => {
    let nextValue = value;
    idMap.forEach((newId, oldId) => {
      nextValue = nextValue.split(`url(#${oldId})`).join(`url(#${newId})`);
      if (nextValue === `#${oldId}`) nextValue = `#${newId}`;
    });
    if (attributeName === "aria-labelledby" || attributeName === "aria-describedby") {
      nextValue = nextValue.split(/\s+/).map((id) => idMap.get(id) || id).join(" ");
    }
    return nextValue;
  };

  [svg, ...svg.querySelectorAll("*")].forEach((element) => {
    Array.from(element.attributes || []).forEach((attribute) => {
      if (attribute.name === "id") return;
      const nextValue = replaceReferences(attribute.value, attribute.name);
      if (nextValue !== attribute.value) element.setAttribute(attribute.name, nextValue);
    });
  });

  svg.querySelectorAll("style").forEach((style) => {
    style.textContent = replaceReferences(style.textContent, "style");
  });
}

function createMermaidRenderHost(renderId) {
  const renderHost = document.createElement("div");
  renderHost.id = `mermaid-render-host-${renderId}`;
  renderHost.setAttribute("aria-hidden", "true");
  renderHost.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;";
  document.body.append(renderHost);
  return renderHost;
}

function nextMermaidSvgRenderId(renderGeneration, index) {
  mermaidSvgRenderSequence += 1;
  return `mermaid-svg-g${renderGeneration}-b${index}-r${mermaidSvgRenderSequence}`;
}

function isCurrentMermaidPreview(previewRoot, renderGeneration) {
  return previewRoot === preview && renderGeneration === mermaidRenderGeneration;
}

function showMermaidError(block) {
  if (!block) return;

  block.classList.add("mermaid-error-block");
  const diagram = block.querySelector(".mermaid-diagram");
  if (diagram) diagram.hidden = true;
  if (!block.querySelector(".mermaid-error")) {
    const message = document.createElement("div");
    message.className = "mermaid-error";
    message.textContent = "Mermaid構文エラー";
    block.prepend(message);
  }

  const source = block.querySelector(".mermaid-source");
  if (source) {
    source.hidden = false;
  }
}

function countPhraseOccurrences(text, phrase, registeredTerms) {
  return findTermCountMatches(text, phrase, registeredTerms).length;
}

function collectLinkStats() {
  const current = currentNote();
  const effectiveNotes = activeNotes().map((note) => {
    if (!current || note.id !== current.id) return note;
    return {
      ...note,
      title: titleInput.value || titleFromBody(editor.value) || "無題メモ",
      body: editor.value
    };
  });

  const titleSet = new Set(effectiveNotes.map((note) => note.title.trim()));
  const candidateTitles = new Set();
  effectiveNotes.forEach((note) => {
    extractLinks(note.body).forEach((rawTitle) => {
      const title = rawTitle.trim();
      if (title) candidateTitles.add(title);
    });
  });
  // 候補は本文中の [[...]] のみとする（既存タイトルは missing 判定にのみ使う）

  const stats = new Map();
  effectiveNotes.forEach((note) => {
    const seenInNote = new Set();
    candidateTitles.forEach((title) => {
      const count = countPhraseOccurrences(note.body, title, candidateTitles);
      if (!count) return;

      const entry = stats.get(title) || { title, count: 0, noteCount: 0, missing: false };
      entry.count += count;
      if (!seenInNote.has(title)) {
        entry.noteCount += 1;
        seenInNote.add(title);
      }
      stats.set(title, entry);
    });
  });

  return [...stats.values()]
    .map((item) => ({
      ...item,
      missing: !titleSet.has(item.title)
    }))
    .sort((a, b) => b.count - a.count || b.noteCount - a.noteCount || a.title.localeCompare(b.title));
}

function renderLinkStats() {
  if (!linkStatsPanel) return;
  if (!linkStatsVisible) {
    linkStatsPanel.innerHTML = "";
    return;
  }

  const stats = collectLinkStats();
  if (!stats.length) {
    linkStatsPanel.innerHTML = `<div class="empty">[[語句]] の統計はまだありません。</div>`;
    return;
  }

  linkStatsPanel.innerHTML = `
    <div class="link-stats-header">
      <strong>語句統計</strong>
      <button id="closeLinkStatsBtn" class="link-stats-close" title="閉じる">×</button>
    </div>
    <div class="link-stats-table">
      <div class="link-stats-row link-stats-heading">
        <span>語句</span>
        <span>使用回数</span>
        <span>使用メモ数</span>
        <span>状態</span>
      </div>
      ${stats
        .map(
          (item) => `
        <div class="link-stats-row">
          <span>${escapeHtml(item.title)}</span>
          <span>${item.count}</span>
          <span>${item.noteCount}</span>
          <span>${item.missing ? "未作成" : "既存"}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  const closeButton = $("closeLinkStatsBtn");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      linkStatsVisible = false;
      if (linkStatsBtn) linkStatsBtn.classList.remove("active");
      renderLinkStats();
    });
  }
}

function toggleLinkStats() {
  linkStatsVisible = !linkStatsVisible;
  if (linkStatsBtn) linkStatsBtn.classList.toggle("active", linkStatsVisible);
  renderLinkStats();
}
function renderLinkList() {
  const note = currentNote();
  const linkList = $("linkList");
  if (!note) {
    linkList.innerHTML = "";
    return;
  }

  const body = (note.id === currentId ? editor.value : note.body);
  const explicitTerms = [...new Set(extractExplicitTerms(body))];
  const indexed = currentTermRelationIndex().byNoteId.get(note.id);
  const automaticTerms = indexed ? indexed.automaticTerms.filter((term) => !explicitTerms.includes(term)) : [];
  const terms = [
    ...explicitTerms.map((term) => ({ term, source: "explicit", color: termColor(term) })),
    ...automaticTerms.map((term) => ({ term, source: "automatic", color: termColor(term) }))
  ];
  linkList.innerHTML = terms.length
    ? `
      <div class="link-list-header">[[語句一覧]]</div>
      <div class="link-chip-list">
        ${terms.map(({ term, source, color }) => `<button class="link-chip term-link-chip" data-title="${escapeAttr(term)}" data-term-source="${source}" style="--term-color:${color}">${escapeHtml(term)}</button>`).join("")}
      </div>
    `
    : `<div class="empty">[[語句]]を本文に書くと、ここに一覧が表示されます。</div>`;

  linkList.querySelectorAll(".link-chip").forEach((button) => {
    button.addEventListener("click", () => openOrCreateLinkedNote(button.dataset.title));
  });
}

// 本文をHTMLに変換します。通常文字はエスケープし、[[...]]だけボタン化します。
function renderRichText(text) {
  let html = "";
  let lastIndex = 0;
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = pattern.exec(text))) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    html += renderWikiButton(match[1]);
    lastIndex = pattern.lastIndex;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html;
}

// Wikiリンク1個分のHTMLを作ります。未作成リンクは色を変えるためmissingを付けます。
function renderWikiButton(rawTitle, source = "explicit") {
  const title = rawTitle.trim();
  const exists = activeNotes().some((note) => note.title === title);
  const className = `${exists ? "wiki-link" : "wiki-link missing"} term-wiki-link ${source === "automatic" ? "automatic-term-link" : "explicit-term-link"}`;
  return `<button class="${className}" data-title="${escapeAttr(title)}" data-term-source="${source}" style="--term-color:${escapeAttr(termColor(title))}">${escapeHtml(title)}</button>`;
}

// Wikiリンクをクリックしたとき、既存メモがあれば開き、なければ新規作成します。
async function openOrCreateLinkedNote(title) {
  const existing = activeNotes().find((note) => note.title === title);
  if (existing) {
    openNote(existing.id);
    return;
  }

  const note = await createNote(title, "");
  notes = await getAllNotes();
  lastDiscovery = `新発見「${title}」がカード化`;
  renderAll();
  openNote(note.id);
}

function isRelatedDrawerOpen() {
  return document.body.classList.contains("related-open");
}

function setRelatedDrawerOpen(open, options = {}) {
  const wasOpen = isRelatedDrawerOpen();
  document.body.classList.toggle("related-open", open);
  auxiliaryPanel.setAttribute("aria-hidden", String(!open));
  auxiliaryPanel.inert = !open;
  relatedBackdrop.setAttribute("aria-hidden", String(!open));
  relatedToggleBtn.setAttribute("aria-expanded", String(open));
  relatedToggleBtn.setAttribute("aria-label", open ? "関連メモパネルを閉じる" : "関連メモパネルを開く");

  if (open) {
    closeRelatedPanelBtn.focus();
  } else if (wasOpen && options.restoreFocus !== false) {
    relatedToggleBtn.focus();
  }
}

function restoreAiSettings() {
  try {
    const stored = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    aiSettings = normalizeAiSettings(stored ? JSON.parse(stored) : null);
  } catch (error) {
    console.warn("AI settings restore failed", error);
    aiSettings = normalizeAiSettings(null);
  }
  aiSettingsDraft = { ...aiSettings };
  aiModels = [];
  aiModelsEndpoint = "";
  aiVerifiedModelId = "";
  aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
  aiDraftConnectionMessage = "";
  aiAssistantState.generation = aiSettings.enabled
    ? AI_GENERATION_STATES.DISCONNECTED
    : AI_GENERATION_STATES.DISABLED;
}

function readAiSettingsForm() {
  const provider = aiProviderSelect.value;
  const providerSettings = withAiProviderSettings(aiSettingsDraft, provider, {
    baseUrl: aiBaseUrlInput.value,
    apiKey: aiGeminiApiKeyInput.value,
    selectedModel: aiModelSelect.value
  });
  return normalizeAiSettings({
    ...providerSettings,
    enabled: aiEnabledInput.checked,
    provider,
    timeoutMs: Number(aiTimeoutInput.value) * 1000,
    systemInstruction: aiSystemInstructionInput.value
  });
}

function createAiAdapter(settings) {
  return settings.provider === "gemini"
    ? new GeminiAdapter({ geminiApiKey: settings.geminiApiKey, timeoutMs: settings.timeoutMs })
    : new OllamaAdapter(settings);
}

function aiProviderConnectionKey(settings) {
  return settings.provider === "gemini" ? "gemini" : settings.baseUrl;
}

function saveAiSettings() {
  const verifiedEndpoint = aiModelsEndpoint;
  const draftConnection = aiDraftConnection;
  const verifiedModels = [...aiModels];
  const draftSettings = readAiSettingsForm();
  const savedState = resolveSavedAiState({
    draftSettings,
    modelsEndpoint: verifiedEndpoint,
    draftConnection,
    models: verifiedModels,
    verifiedModelId: aiVerifiedModelId
  });
  aiSettingsDraft = draftSettings;
  aiSettings = { ...draftSettings };
  try {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(aiSettings));
    aiDraftConnectionMessage = "AI設定を保存しました。";
    aiSettingsConnectionStatus.textContent = aiDraftConnectionMessage;
  } catch (error) {
    console.warn("AI settings save failed", error);
    aiDraftConnectionMessage = "設定を保存できませんでした。このタブでは現在の設定を使用します。";
    aiSettingsConnectionStatus.textContent = aiDraftConnectionMessage;
  }
  if (!aiSettings.enabled) {
    aiAssistantState.requestId += 1;
    stopAiGeneration();
  }
  aiAssistantState.connection = savedState.connection;
  aiAssistantState.generation = savedState.generation;
  if (savedState.preserveModels) {
    aiModels = verifiedModels;
    aiModelsEndpoint = verifiedEndpoint;
    aiDraftConnection = AI_CONNECTION_STATES.CONNECTED;
  } else {
    aiModels = [];
    aiModelsEndpoint = "";
    aiVerifiedModelId = "";
    aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
  }
  renderAiSettings();
  renderAiUi();
}

function renderAiSettings() {
  aiEnabledInput.checked = aiSettingsDraft.enabled;
  aiProviderSelect.value = aiSettingsDraft.provider;
  aiBaseUrlInput.value = aiSettingsDraft.baseUrl;
  aiGeminiApiKeyInput.value = aiSettingsDraft.geminiApiKey;
  aiTimeoutInput.value = String(Math.round(aiSettingsDraft.timeoutMs / 1000));
  aiSystemInstructionInput.value = aiSettingsDraft.systemInstruction;
  const gemini = aiSettingsDraft.provider === "gemini";
  aiBaseUrlField.hidden = gemini;
  aiExternalUrlWarning.hidden = gemini || isLoopbackBaseUrl(aiBaseUrlInput.value);
  aiGeminiApiKeyField.hidden = !gemini;
  aiGeminiPrivacyNote.hidden = !gemini;
  aiProviderDescription.textContent = gemini
    ? "Gemini APIはクラウドAIです。質問・指示、選択したメモ本文・文章、AI用参照コンテキスト、会話履歴はGoogle Gemini APIへ送信されます。"
    : "初期状態は無効です。OllamaはAPIキー不要で、入力内容は設定したOllamaサーバーへ送信されます。";
  aiModelHelp.textContent = gemini
    ? "接続確認で、このAPIキーで利用できるテキスト生成モデルを取得します。"
    : "Qwen・Phi・Granite系は確認済み候補として表示します。他のモデルも選択できますが動作未確認です。";
  renderAiModelOptions();
  aiCheckConnectionBtn.disabled = aiDraftConnection === AI_CONNECTION_STATES.CHECKING;
  aiRefreshModelsBtn.disabled = aiDraftConnection === AI_CONNECTION_STATES.CHECKING;
  if (aiDraftConnectionMessage) aiSettingsConnectionStatus.textContent = aiDraftConnectionMessage;
}

function renderAiModelOptions() {
  const selected = aiSettingsDraft.selectedModel;
  const groups = groupModels(aiModels);
  aiModelSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = aiModels.length ? "モデルを選択" : "モデル一覧を更新してください";
  aiModelSelect.appendChild(placeholder);
  const appendGroup = (label, models) => {
    if (!models.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.displayName;
      group.appendChild(option);
    });
    aiModelSelect.appendChild(group);
  };
  if (aiSettingsDraft.provider === "gemini") {
    const geminiGroups = groupGeminiModels(aiModels);
    appendGroup("利用可能なGeminiモデル", geminiGroups.stable);
    appendGroup("Preview", geminiGroups.preview);
    appendGroup("Experimental", geminiGroups.experimental);
  } else {
    appendGroup("確認済みモデル系統", groups.verified);
    appendGroup("その他（動作未確認）", groups.other);
  }
  if (selected && !aiModels.some((model) => model.id === selected)) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = aiSettingsDraft.provider === "gemini" ? `${selected.replace(/^models\//, "")}（生成未検証）` : `${selected}（未確認）`;
    aiModelSelect.appendChild(option);
  }
  aiModelSelect.value = selected;
}

async function checkAiConnection({ useForm = true } = {}) {
  const sessionId = aiSettingsSessionId;
  const requestId = ++aiConnectionRequestId;
  aiConnectionAbortController?.abort();
  const abortController = new AbortController();
  aiConnectionAbortController = abortController;
  const candidate = normalizeAiSettings(useForm ? readAiSettingsForm() : aiSettingsDraft);
  aiSettingsDraft = candidate;
  aiDraftConnection = AI_CONNECTION_STATES.CHECKING;
  aiDraftConnectionMessage = candidate.provider === "gemini" ? "Gemini APIへ接続しています…" : "Ollamaへ接続しています…";
  renderAiSettings();
  try {
    const adapter = createAiAdapter(candidate);
    const result = await adapter.checkConnection({ signal: abortController.signal, model: candidate.selectedModel });
    if (requestId !== aiConnectionRequestId || sessionId !== aiSettingsSessionId) return;
    aiModels = result.models;
    aiModelsEndpoint = aiProviderConnectionKey(candidate);
    aiDraftConnection = result.hasModels ? AI_CONNECTION_STATES.CONNECTED : AI_CONNECTION_STATES.NO_MODELS;
    aiVerifiedModelId = candidate.provider === "gemini" && result.modelVerified ? result.verifiedModelId : "";
    aiDraftConnectionMessage = result.hasModels
      ? candidate.provider === "gemini" && candidate.selectedModel ? `接続しました。${result.models.length}モデルを利用でき、選択モデルの生成を確認しました。` : `接続しました。${result.models.length}モデルを利用できます。`
      : candidate.provider === "gemini" ? "Gemini APIへ接続しましたが、利用できるモデルがありません。" : "Ollamaへ接続しましたが、利用できるモデルがありません。";
    if (candidate.selectedModel && !aiModels.some((model) => model.id === candidate.selectedModel)) {
      aiSettingsDraft = withAiProviderSettings(candidate, candidate.provider, { selectedModel: "" });
    }
    renderAiSettings();
  } catch (error) {
    if (requestId !== aiConnectionRequestId || sessionId !== aiSettingsSessionId) return;
    aiModels = error?.models || aiModels;
    aiModelsEndpoint = aiProviderConnectionKey(candidate);
    aiDraftConnection = AI_CONNECTION_STATES.UNAVAILABLE;
    aiVerifiedModelId = "";
    aiDraftConnectionMessage = friendlyAiError(error);
    renderAiSettings();
  } finally {
    if (requestId === aiConnectionRequestId) {
      aiConnectionAbortController = null;
      if (sessionId === aiSettingsSessionId && aiDraftConnection === AI_CONNECTION_STATES.CHECKING) {
        aiDraftConnection = AI_CONNECTION_STATES.UNAVAILABLE;
        aiDraftConnectionMessage = "接続確認を完了できませんでした。";
        renderAiSettings();
      }
    }
  }
}

function beginAiSettingsSession() {
  aiSettingsSessionId += 1;
  aiConnectionRequestId += 1;
  aiConnectionAbortController?.abort();
  aiConnectionAbortController = null;
  aiSettingsDraft = { ...aiSettings };
  aiModels = [];
  aiModelsEndpoint = "";
  aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
  aiDraftConnectionMessage = "";
}

function snapshotCurrentNoteReference() {
  const note = currentNote();
  if (!note || note.deletedAt) return emptyAiReference();
  return createAiReferenceContext({
    mode: AI_REFERENCE_MODES.CURRENT_NOTE,
    noteId: note.id,
    noteTitle: titleInput.value || note.title,
    content: editor.value
  });
}

function snapshotSelectedTextReference() {
  const note = currentNote();
  const content = aiAssistantState.selectedTextSnapshot
    || editor.value.slice(editor.selectionStart, editor.selectionEnd);
  return createAiReferenceContext({
    mode: AI_REFERENCE_MODES.SELECTED_TEXT,
    noteId: note?.id,
    noteTitle: titleInput.value || note?.title,
    content
  });
}

function snapshotSpecifiedNoteReference(noteId) {
  const note = activeNotes().find((item) => item.id === noteId);
  return note ? createAiReferenceContext({
    mode: AI_REFERENCE_MODES.SPECIFIED_NOTE,
    noteId: note.id,
    noteTitle: note.title,
    content: note.body
  }) : emptyAiReference();
}

function aiReferenceNoteSnapshot(note) {
  const current = note.id === currentId ? { ...note, title: titleInput.value || note.title, body: editor.value } : note;
  const collectionId = normalizedCollectionId(current);
  const collection = collections.find((item) => item.id === collectionId);
  return {
    id: current.id,
    title: current.title,
    collectionId,
    collectionName: collection?.name || "未分類",
    content: current.body || ""
  };
}

function snapshotAllNotesReference() {
  return createAiReferenceContext({
    mode: AI_REFERENCE_MODES.ALL_NOTES,
    notes: selectAllReferenceNotes(notes).map(aiReferenceNoteSnapshot)
  });
}

function snapshotCollectionReference(collectionId) {
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection || collection.id === "trash") return createAiReferenceContext({ mode: AI_REFERENCE_MODES.COLLECTION, notes: [] });
  return createAiReferenceContext({
    mode: AI_REFERENCE_MODES.COLLECTION,
    collectionId: collection.id,
    collectionName: collection.name,
    notes: selectCollectionReferenceNotes(notes, collections, collection.id).map(aiReferenceNoteSnapshot)
  });
}

function setAiReferenceMode(mode) {
  aiAssistantState.referenceMode = mode;
  aiAssistantState.error = "";
  aiAssistantState.specifiedNoteId = mode === AI_REFERENCE_MODES.SPECIFIED_NOTE
    ? aiAssistantState.specifiedNoteId
    : null;
  aiAssistantState.collectionId = mode === AI_REFERENCE_MODES.COLLECTION
    ? aiAssistantState.collectionId
    : null;
  if (mode === AI_REFERENCE_MODES.CURRENT_NOTE) aiAssistantState.reference = snapshotCurrentNoteReference();
  else if (mode === AI_REFERENCE_MODES.SELECTED_TEXT) aiAssistantState.reference = snapshotSelectedTextReference();
  else if (mode === AI_REFERENCE_MODES.SPECIFIED_NOTE) {
    aiAssistantState.reference = snapshotSpecifiedNoteReference(aiAssistantState.specifiedNoteId);
  } else if (mode === AI_REFERENCE_MODES.ALL_NOTES) {
    aiAssistantState.reference = snapshotAllNotesReference();
  } else if (mode === AI_REFERENCE_MODES.COLLECTION) {
    aiAssistantState.reference = snapshotCollectionReference(aiAssistantState.collectionId);
  } else aiAssistantState.reference = emptyAiReference();
  if (aiAssistantState.reference.mode === AI_REFERENCE_MODES.NONE && mode !== AI_REFERENCE_MODES.NONE) {
    aiAssistantState.error = mode === AI_REFERENCE_MODES.SELECTED_TEXT
      ? "本文で文章を選択してから、もう一度選んでください。"
      : mode === AI_REFERENCE_MODES.SPECIFIED_NOTE ? "参照するメモを選択してください。"
        : mode === AI_REFERENCE_MODES.COLLECTION ? "参照するコレクションを選択してください。" : "現在のメモがありません。";
  } else if ((mode === AI_REFERENCE_MODES.ALL_NOTES || mode === AI_REFERENCE_MODES.COLLECTION)
      && aiAssistantState.reference.noteCount === 0) {
    aiAssistantState.error = mode === AI_REFERENCE_MODES.ALL_NOTES
      ? "参照できる有効なメモがありません。"
      : "選択したコレクションに対象メモがありません。";
  }
  renderAiUi();
}

function openAiAssistant(options = {}) {
  const resume = options.resume === true;
  const mode = options.mode || AI_REFERENCE_MODES.NONE;
  if (!resume) {
    aiAssistantState.selectedTextSnapshot = mode === AI_REFERENCE_MODES.SELECTED_TEXT
      ? editor.value.slice(editor.selectionStart, editor.selectionEnd)
      : "";
    aiPurposeSelect.value = options.purpose || "question";
    if (options.prompt !== undefined) aiInstructionInput.value = options.prompt;
    setAiReferenceMode(mode);
  }
  setAiPanelOpen(true, { launchMode: resume ? "resume" : options.mode ? mode : null });
}

function resetAiAssistantConversation() {
  aiAssistantState = {
    ...aiAssistantState,
    generation: aiSettings.enabled ? AI_GENERATION_STATES.DISCONNECTED : AI_GENERATION_STATES.DISABLED,
    answer: "",
    error: "",
    requestId: aiAssistantState.requestId + 1,
    requestNoteId: null,
    requestNoteTitle: "",
    requestPurpose: "question",
    referenceMode: AI_REFERENCE_MODES.NONE,
    reference: emptyAiReference(),
    selectedTextSnapshot: "",
    specifiedNoteId: null,
    collectionId: null,
    history: []
  };
  aiPurposeSelect.value = "question";
  aiInstructionInput.value = "";
}

function setAiPanelOpen(open, { restoreFocus = true, launchMode = null } = {}) {
  const wasOpen = aiAssistantState.panelOpen;
  if (open && !wasOpen && launchMode === null) {
    resetAiAssistantConversation();
  }
  if (open) setContextPanelTab("ai", { focus: false });
  else if (contextPanelTab === "ai") setContextPanelTab("collection", { focus: false });
  else setAiAssistantPanelActive(false);
  if (aiAssistantState.panelOpen) {
    setRelatedDrawerOpen(false, { restoreFocus: false });
    if (mobileCardOpen) setCardPaneOpen(false, { restoreFocus: false });
    closeAiPanelBtn.focus();
  } else {
    updateResponsiveLayoutUi();
    if (wasOpen && restoreFocus) aiRobotBtn.focus();
  }
  renderAiUi();
}

function aiStatusText() {
  const state = aiAssistantState.generation;
  if (state === AI_GENERATION_STATES.STREAMING) return "生成中";
  if (state === AI_GENERATION_STATES.COMPLETED) return "回答完了";
  if (state === AI_GENERATION_STATES.STOPPED) return "停止済み";
  if (state === AI_GENERATION_STATES.ERROR) return "エラー";
  if (state === AI_GENERATION_STATES.DISABLED) return "AI無効";
  if (state === AI_GENERATION_STATES.MODEL_REQUIRED) return "モデル未選択";
  if (state === AI_GENERATION_STATES.DISCONNECTED) return "未接続";
  return "待機中";
}

function connectionStatusText() {
  const state = aiAssistantState.connection;
  if (state === AI_CONNECTION_STATES.CHECKING) return "接続確認中";
  if (state === AI_CONNECTION_STATES.CONNECTED) return "接続済み";
  if (state === AI_CONNECTION_STATES.NO_MODELS) return "モデルなし";
  if (state === AI_CONNECTION_STATES.UNAVAILABLE || state === AI_CONNECTION_STATES.ERROR) return "接続エラー";
  return "未確認";
}

function aiPurposeRequiresReference(purpose) {
  const preset = AI_PROMPTS[purpose] || AI_PROMPTS.question;
  return preset.id !== "question";
}

function renderAiUi() {
  const state = aiAssistantState.generation;
  const streaming = state === AI_GENERATION_STATES.STREAMING;
  const hasAnswer = Boolean(aiAssistantState.answer.trim());
  const reference = createAiReferenceContext(aiAssistantState.reference);
  const purposeNeedsReference = aiPurposeRequiresReference(aiPurposeSelect.value);
  aiRobotBtn.dataset.state = state;
  aiRobotStatus.textContent = aiStatusText();
  aiConnectionBadge.dataset.state = aiAssistantState.connection;
  aiConnectionBadge.textContent = connectionStatusText();
  aiActiveModel.textContent = aiSettings.selectedModel || "モデル未選択";
  aiGenerationStatus.dataset.state = state;
  aiGenerationStatus.textContent = aiAssistantState.error || (purposeNeedsReference && reference.mode === AI_REFERENCE_MODES.NONE
    ? "この用途には参照範囲の選択が必要です。"
    : ({
    [AI_GENERATION_STATES.DISABLED]: "設定でAI機能を有効にしてください。",
    [AI_GENERATION_STATES.DISCONNECTED]: `設定から${aiSettings.provider === "gemini" ? "Gemini API" : "Ollama"}への接続を確認してください。`,
    [AI_GENERATION_STATES.MODEL_REQUIRED]: "設定で使用モデルを選択してください。",
    [AI_GENERATION_STATES.IDLE]: "入力待ちです。AI回答はメモへ自動反映されません。",
    [AI_GENERATION_STATES.STREAMING]: "回答を生成しています…",
    [AI_GENERATION_STATES.STOPPED]: "生成を停止しました。途中までの回答は確認できます。",
    [AI_GENERATION_STATES.COMPLETED]: "回答が完了しました。内容を確認してから利用してください。",
    [AI_GENERATION_STATES.ERROR]: "AI処理でエラーが発生しました。"
  }[state] || "入力待ちです。"));
  aiAnswer.textContent = hasAnswer ? aiAssistantState.answer : "回答はここに表示されます。";
  aiSendBtn.disabled = streaming || !aiSettings.enabled || !aiSettings.selectedModel
    || (aiSettings.provider === "gemini" && (!aiSettings.geminiApiKey || aiVerifiedModelId !== aiSettings.selectedModel));
  aiStopBtn.disabled = !streaming;
  aiCopyBtn.disabled = !hasAnswer;
  aiAppendBtn.disabled = !hasAnswer || !currentNote() || Boolean(currentNote()?.deletedAt);
  aiSaveNewBtn.disabled = !hasAnswer;
  aiTranslationRow.hidden = aiPurposeSelect.value !== "translate";
  renderAiReferenceUi();
  renderAiChatHistory();
  updateAiTargetPreview();
}

function renderAiReferenceUi() {
  const reference = createAiReferenceContext(aiAssistantState.reference);
  aiTargetSelect.value = aiAssistantState.referenceMode;
  aiChatModeTitle.textContent = reference.mode === AI_REFERENCE_MODES.NONE ? "自由チャット" : "メモアシスタント";
  aiReferenceBadge.textContent = reference.mode === AI_REFERENCE_MODES.NONE
    ? "メモは参照していません"
    : aiReferenceLabel(reference);
  aiReferenceBadge.dataset.mode = reference.mode;
  aiClearReferenceBtn.hidden = reference.mode === AI_REFERENCE_MODES.NONE;
  aiSpecifiedNotePicker.hidden = aiTargetSelect.value !== AI_REFERENCE_MODES.SPECIFIED_NOTE;
  aiCollectionPicker.hidden = aiTargetSelect.value !== AI_REFERENCE_MODES.COLLECTION;
  renderAiSpecifiedNoteList();
  renderAiCollectionList();
}

function renderAiCollectionList() {
  if (aiCollectionPicker.hidden) return;
  const query = aiCollectionSearch.value.trim().toLocaleLowerCase();
  const matches = collections
    .filter((collection) => collection.id !== "trash")
    .filter((collection) => !query || collection.name.toLocaleLowerCase().includes(query))
    .sort(compareCollections);
  aiCollectionList.replaceChildren();
  matches.forEach((collection) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-specified-note-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(collection.id === aiAssistantState.collectionId));
    const depth = collectionDepth(collection.id);
    button.textContent = `${"　".repeat(Math.max(0, depth - 1))}${collection.name}`;
    button.addEventListener("click", () => {
      aiAssistantState.collectionId = collection.id;
      aiAssistantState.reference = snapshotCollectionReference(collection.id);
      aiAssistantState.error = aiAssistantState.reference.noteCount
        ? "" : "選択したコレクションに対象メモがありません。";
      renderAiUi();
    });
    aiCollectionList.appendChild(button);
  });
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "ai-chat-empty";
    empty.textContent = "一致するコレクションがありません。";
    aiCollectionList.appendChild(empty);
  }
}

function renderAiSpecifiedNoteList() {
  if (aiSpecifiedNotePicker.hidden) return;
  const query = aiSpecifiedNoteSearch.value.trim().toLocaleLowerCase();
  const matches = activeNotes().filter((note) => !query || note.title.toLocaleLowerCase().includes(query)).slice(0, 30);
  aiSpecifiedNoteList.replaceChildren();
  matches.forEach((note) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-specified-note-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(note.id === aiAssistantState.specifiedNoteId));
    button.textContent = note.title;
    button.addEventListener("click", () => {
      aiAssistantState.specifiedNoteId = note.id;
      aiAssistantState.reference = snapshotSpecifiedNoteReference(note.id);
      aiAssistantState.error = "";
      renderAiUi();
    });
    aiSpecifiedNoteList.appendChild(button);
  });
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "ai-chat-empty";
    empty.textContent = "一致するメモがありません。";
    aiSpecifiedNoteList.appendChild(empty);
  }
}

function renderAiChatHistory() {
  aiChatHistory.replaceChildren();
  if (!aiAssistantState.history.length) {
    const empty = document.createElement("p");
    empty.className = "ai-chat-empty";
    empty.textContent = "質問を入力して会話を始められます。";
    aiChatHistory.appendChild(empty);
    return;
  }
  aiAssistantState.history.forEach((message) => {
    const article = document.createElement("article");
    article.className = `ai-chat-message ${message.role}`;
    const meta = document.createElement("div");
    meta.className = "ai-chat-message-meta";
    meta.textContent = message.role === "user"
      ? `あなた · ${aiReferenceLabel(message.reference)}`
      : "AI";
    const content = document.createElement("pre");
    content.textContent = message.content || (message.role === "assistant" ? "生成中…" : "");
    article.append(meta, content);
    if (message.role === "assistant" && message.content) {
      const actions = document.createElement("div");
      actions.className = "ai-chat-message-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "コピー";
      copy.addEventListener("click", async () => {
        try { await writeTextToClipboard(message.content, { fallbackCopyText }); }
        catch (_error) { aiGenerationStatus.textContent = "コピーできませんでした。"; }
      });
      actions.appendChild(copy);
      article.appendChild(actions);
    }
    aiChatHistory.appendChild(article);
  });
  aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
}

function updateAiTargetPreview() {
  const reference = createAiReferenceContext(aiAssistantState.reference);
  const noReferenceText = aiPurposeRequiresReference(aiPurposeSelect.value)
    ? "この用途には参照範囲の選択が必要です。"
    : "送信データにメモのタイトル・本文・選択文章は含まれません。";
  aiTargetPreview.textContent = reference.mode === AI_REFERENCE_MODES.NONE
    ? noReferenceText
    : `${aiReferenceLabel(reference)}を送信時の参照内容として保持しています。${(reference.mode === AI_REFERENCE_MODES.ALL_NOTES || reference.mode === AI_REFERENCE_MODES.COLLECTION) && reference.totalCharacters > AI_REFERENCE_MAX_CHARS ? ` 上限（${AI_REFERENCE_MAX_CHARS.toLocaleString("ja-JP")}文字）を超えているため送信できません。` : ""}`;
}

async function startAiGeneration() {
  if (aiAssistantState.generation === AI_GENERATION_STATES.STREAMING) return;
  if (!aiSettings.enabled) {
    aiAssistantState.generation = AI_GENERATION_STATES.DISABLED;
    renderAiUi();
    return;
  }
  if (!aiSettings.selectedModel) {
    aiAssistantState.generation = AI_GENERATION_STATES.MODEL_REQUIRED;
    renderAiUi();
    return;
  }
  const note = currentNote();
  const reference = createAiReferenceContext(aiAssistantState.reference);
  if (aiTargetSelect.value !== AI_REFERENCE_MODES.NONE && reference.mode === AI_REFERENCE_MODES.NONE) {
    aiAssistantState.error = aiTargetSelect.value === AI_REFERENCE_MODES.SELECTED_TEXT
      ? "選択文章を取得できませんでした。本文で文章を選択してください。"
      : "参照対象を選択してください。";
    aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
    renderAiUi();
    return;
  }
  if ((reference.mode === AI_REFERENCE_MODES.CURRENT_NOTE || reference.mode === AI_REFERENCE_MODES.SPECIFIED_NOTE)
      && !activeNotes().some((item) => item.id === reference.noteId)) {
    aiAssistantState.error = "参照対象のメモが削除されたため送信できません。参照範囲を選び直してください。";
    aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
    renderAiUi();
    return;
  }
  if (reference.mode === AI_REFERENCE_MODES.ALL_NOTES || reference.mode === AI_REFERENCE_MODES.COLLECTION) {
    if (!reference.noteCount) {
      aiAssistantState.error = reference.mode === AI_REFERENCE_MODES.ALL_NOTES
        ? "参照できる有効なメモがありません。"
        : "選択したコレクションに対象メモがありません。";
      aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
      renderAiUi();
      return;
    }
    if (!isAiReferenceWithinLimit(reference, AI_REFERENCE_MAX_CHARS)) {
      aiAssistantState.error = `参照本文が上限を超えています（${reference.totalCharacters.toLocaleString("ja-JP")} / ${AI_REFERENCE_MAX_CHARS.toLocaleString("ja-JP")}文字）。送信を停止しました。`;
      aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
      renderAiUi();
      return;
    }
  }
  const question = aiInstructionInput.value.trim();
  let messages;
  try {
    messages = buildAiMessages({
      purpose: aiPurposeSelect.value,
      reference,
      userInstruction: question,
      translationLanguage: aiTranslationSelect.value,
      systemInstruction: aiSettings.systemInstruction,
      history: aiAssistantState.history.filter((message) => message.content).map(({ role, content }) => ({ role, content }))
    });
  } catch (error) {
    aiAssistantState.error = error.message;
    aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
    renderAiUi();
    return;
  }
  if (note) await flushSave();
  const requestId = aiAssistantState.requestId + 1;
  const referenceSnapshot = aiReferenceSnapshot(reference);
  const userMessage = { role: "user", content: question, reference: referenceSnapshot, sentAt: Date.now() };
  const assistantMessage = { role: "assistant", content: "", reference: referenceSnapshot, sentAt: Date.now() };
  aiAbortController = new AbortController();
  aiAssistantState = {
    ...aiAssistantState,
    generation: AI_GENERATION_STATES.STREAMING,
    answer: "",
    error: "",
    requestId,
    requestNoteId: note?.id || null,
    requestNoteTitle: reference.noteTitle || note?.title || "自由チャット",
    requestPurpose: aiPurposeSelect.value,
    history: [...aiAssistantState.history, userMessage, assistantMessage]
  };
  aiInstructionInput.value = "";
  renderAiUi();
  try {
    const adapter = createAiAdapter(aiSettings);
    for await (const event of adapter.generate({
      model: aiSettings.selectedModel,
      messages,
      signal: aiAbortController.signal,
      timeoutMs: aiSettings.timeoutMs
    })) {
      if (requestId !== aiAssistantState.requestId) return;
      if (event.type === "text") {
        aiAssistantState.connection = AI_CONNECTION_STATES.CONNECTED;
        aiAssistantState.answer += event.content;
        aiAssistantState.history.at(-1).content = aiAssistantState.answer;
        renderAiUi();
      }
    }
    if (requestId === aiAssistantState.requestId) {
      aiAssistantState.connection = AI_CONNECTION_STATES.CONNECTED;
      aiAssistantState.generation = AI_GENERATION_STATES.COMPLETED;
      renderAiUi();
    }
  } catch (error) {
    if (requestId !== aiAssistantState.requestId) return;
    aiAssistantState.generation = error?.code === "aborted" ? AI_GENERATION_STATES.STOPPED : AI_GENERATION_STATES.ERROR;
    aiAssistantState.error = error?.code === "aborted" ? "" : friendlyAiError(error);
    if (error?.code === "connection") aiAssistantState.connection = AI_CONNECTION_STATES.UNAVAILABLE;
    renderAiUi();
  } finally {
    if (requestId === aiAssistantState.requestId) aiAbortController = null;
  }
}

function stopAiGeneration() {
  if (aiAbortController) aiAbortController.abort();
}

async function copyAiAnswer() {
  if (!aiAssistantState.answer.trim()) return;
  try {
    await writeTextToClipboard(aiAssistantState.answer, { fallbackCopyText });
    aiGenerationStatus.textContent = "AI回答をコピーしました。";
  } catch (error) {
    aiGenerationStatus.textContent = "コピーできませんでした。回答を選択してコピーしてください。";
  }
}

async function appendAiAnswerToCurrentNote() {
  const answer = aiAssistantState.answer.trim();
  if (!answer) return;
  const note = currentNote();
  if (!note || note.deletedAt) {
    aiAssistantState.error = "現在のメモが存在しないため挿入できません。";
    aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
    renderAiUi();
    return;
  }
  const insertion = prompt(`AI回答を「${titleInput.value || "無題メモ"}」へ挿入します。\n1: カーソル位置\n2: 本文末尾`, "2");
  if (insertion !== "1" && insertion !== "2") return;
  pushUndoSnapshot({ noteId: currentId, title: titleInput.value, body: editor.value, savedAt: Date.now() });
  if (insertion === "1") {
    const position = editor.selectionStart;
    editor.value = `${editor.value.slice(0, position)}${answer}${editor.value.slice(position)}`;
    editor.setSelectionRange(position + answer.length, position + answer.length);
  } else {
    editor.value += aiAppendMarkdown(answer);
  }
  renderTableBlockEditors();
  scheduleSave();
  aiGenerationStatus.textContent = "AI回答を現在のメモへ挿入しました。";
}

async function saveAiAnswerAsNewNote() {
  const answer = aiAssistantState.answer.trim();
  if (!answer) return;
  const title = aiMemoTitle(aiAssistantState.requestPurpose, aiAssistantState.requestNoteTitle || "自由チャット");
  const note = await createNote(title, answer);
  notes = await getAllNotes();
  renderAll();
  openNote(note.id);
  aiGenerationStatus.textContent = "AI回答を新規メモとして保存しました。";
}

function updateRelatedToggle(count) {
  relatedCount.textContent = String(count);
  relatedToggleBtn.title = `関連メモ ${count}件`;
}

// 右ドロワー内の関連メモ一覧を描画します。
function renderRelated() {
  const note = currentNote();
  relatedList.innerHTML = "";
  relatedLimitNotice.hidden = true;
  relatedLimitNotice.textContent = "";

  if (!note) {
    updateRelatedToggle(0);
    relatedList.innerHTML = `<div class="empty related-empty"><strong>メモを選択すると関連メモが表示されます。</strong><span>メモを開くと、本文リンク・逆リンク・共通リンク・共通語句から関連するメモを探します。</span></div>`;
    return;
  }

  const allRelated = findRelated(note);
  const related = allRelated.slice(0, 8);
  updateRelatedToggle(allRelated.length);
  if (allRelated.length > related.length) {
    relatedLimitNotice.textContent = `${allRelated.length}件中、${related.length}件表示`;
    relatedLimitNotice.hidden = false;
  }
  if (!related.length) {
    relatedList.innerHTML = `<div class="empty related-empty"><strong>関連メモはありません。</strong><span>本文中に [[メモ名]] の形式でリンクを書くと、本文リンク・逆リンク・共通リンク・共通語句から関連するメモが表示されます。</span></div>`;
    return;
  }

  related.forEach(({ note: item, reason }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "related-item";
    button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(reason)}</span>`;
    button.addEventListener("click", () => openNote(item.id));
    relatedList.appendChild(button);
  });
}

// 関連メモをスコア計算します。直接リンク、逆リンク、共通リンク、共通語句を見ています。
function findRelated(source) {
  const sourceLinks = new Set(extractLinks(source.body));
  const sourceWords = new Set(tokenize(`${source.title} ${source.body}`));

  return activeNotes()
    .filter((note) => note.id !== source.id)
    .map((note) => {
      const links = extractLinks(note.body);
      let score = 0;
      const reasons = [];

      if (sourceLinks.has(note.title)) {
        score += 6;
        reasons.push("本文リンク");
      }

      if (links.includes(source.title)) {
        score += 6;
        reasons.push("逆リンク");
      }

      const sharedLinks = links.filter((link) => sourceLinks.has(link));
      if (sharedLinks.length) {
        score += sharedLinks.length * 3;
        reasons.push(`共通: ${sharedLinks.slice(0, 2).join(" / ")}`);
      }

      const sharedWords = tokenize(`${note.title} ${note.body}`).filter((word) => sourceWords.has(word));
      if (sharedWords.length) {
        score += Math.min(sharedWords.length, 4);
        reasons.push(`語句: ${sharedWords.slice(0, 2).join(" / ")}`);
      }

      return { note, score, reason: reasons.join("、") || "近い語句" };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}

// 日本語・英数字のまとまりを簡易的な検索語として切り出します。
function tokenize(text) {
  const matches = text.match(/[一-龥ぁ-んァ-ンA-Za-z0-9]{2,}/g) || [];
  const stop = new Set(["これ", "それ", "ため", "こと", "もの", "今日メモ", "新規メモ"]);
  return [...new Set(matches.filter((word) => !stop.has(word)))];
}

// 本文中の[[...]]からリンク先タイトルだけを取り出します。
function extractLinks(body) {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

// 全メモから「どのメモから、どのタイトルへリンクしているか」を集めます。
function collectLinks(items) {
  return items.flatMap((note) => extractLinks(note.body).map((to) => ({ from: note.title, to })));
}

// RPG感の「新発見」欄を描画します。
function renderDiscovery() {
  discoveryPanel.innerHTML = lastDiscovery
    ? `<strong>新発見</strong><br>${escapeHtml(lastDiscovery)}`
    : `<strong>新発見</strong><br>[[太平記]] と [[足利尊氏]] のように書くと接続が増えます。`;
}

// リンクが増えたときに表示する発見メッセージを作ります。
function buildDiscoveryMessage(note) {
  const links = extractLinks(note.body);
  const latest = links[links.length - 1];
  return latest ? `「${note.title}」と「${latest}」が初接続` : "";
}

// 全メモをMarkdownファイルに変換し、ZIPとしてダウンロードします。
async function downloadMarkdownZip() {
  try {
    await flushSave();
    const files = await buildCollectionZipFiles();
    console.log("ZIP backup", {
      fileCount: files.length,
      fileNames: files.map((file) => file.name)
    });
    const blob = await makeZip(files);
    downloadBlob(blob, `memo-nexus-${todayStamp()}.zip`);
  } catch (error) {
    console.error("ZIP backup failed", error);
    alert(`ZIPバックアップに失敗しました: ${error.message || error}`);
  }
}

// 追加ライブラリなしでZIPを作る処理です。各Markdownを無圧縮のZIPエントリにします。
async function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = await exportFileBytes(file.content, encoder);
    const crc = crc32(data);
    const utf8Flag = 0x0800;
    const { dosTime, dosDate } = zipDosDateTime(file.updatedAt);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(utf8Flag), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    ]);
    const central = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(utf8Flag), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  ]);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function exportFileBytes(content, encoder = new TextEncoder()) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  return encoder.encode(String(content == null ? "" : content));
}

// ZIP形式で必要になるCRC32チェックサムを計算します。
function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// CRC32計算を速くするための事前計算テーブルです。
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

// 16bit整数をZIP仕様のリトルエンディアン形式にします。
function u16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

// 32bit整数をZIP仕様のリトルエンディアン形式にします。
function u32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ]);
}

// Uint8Arrayを複数つなげて、ひとつのバイナリ配列にします。
function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

// 必要なときだけ開く簡易グラフをcanvasへ描画します。
function drawGraph() {
  const context = graphCanvas.getContext("2d");
  const width = graphCanvas.width;
  const height = graphCanvas.height;
  context.clearRect(0, 0, width, height);

  const visibleNotes = activeNotes();
  const links = collectLinks(visibleNotes);
  const names = [...new Set([...visibleNotes.map((note) => note.title), ...links.map((link) => link.to)])];
  const radius = Math.min(width, height) * 0.38;
  const centerX = width / 2;
  const centerY = height / 2;
  const points = new Map();

  names.forEach((name, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(names.length, 1) - Math.PI / 2;
    points.set(name, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  });

  context.lineWidth = 1.5;
  context.strokeStyle = "#9ab9bd";
  links.forEach((link) => {
    const from = points.get(link.from);
    const to = points.get(link.to);
    if (!from || !to) return;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  });

  names.forEach((name) => {
    const point = points.get(name);
    const exists = visibleNotes.some((note) => note.title === name);
    context.beginPath();
    context.fillStyle = exists ? "#236c73" : "#a66b1f";
    context.arc(point.x, point.y, exists ? 8 : 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#222522";
    context.font = "14px sans-serif";
    context.fillText(name, point.x + 10, point.y + 5);
  });
}

// Markdownやコレクション名をWindowsでも安全な名前へ変換します。
function safeFileName(name) {
  return sanitizeWindowsName(name, "untitled");
}

// 同名タイトルや置換後に同名になるファイルへ連番を付けます。
function uniqueZipFileNames(items) {
  const usedNames = new Set();

  return items.map((item) => {
    const extensionIndex = item.name.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? item.name.slice(0, extensionIndex) : item.name;
    const extension = extensionIndex > 0 ? item.name.slice(extensionIndex) : "";
    let name = item.name;
    let suffix = 2;

    while (usedNames.has(name.toLocaleLowerCase())) {
      name = `${baseName}-${suffix}${extension}`;
      suffix += 1;
    }

    usedNames.add(name.toLocaleLowerCase());
    return { ...item, name };
  });
}

// JavaScriptの日時をZIPヘッダーで使うDOS日時へ変換します。
function zipDosDateTime(value) {
  const date = new Date(value);
  const safe = value == null || Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safe.getFullYear());
  const dosTime = (safe.getHours() << 11) | (safe.getMinutes() << 5) | Math.floor(safe.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((safe.getMonth() + 1) << 5) | safe.getDate();
  return { dosTime, dosDate };
}

// タイトル右側に、作成日と本文の最終変更日時を表示します。
function renderNoteMeta() {
  const note = currentNote();
  if (!note) {
    noteMeta.textContent = "";
    return;
  }

  noteMeta.innerHTML = `
    <div>作成: ${escapeHtml(formatDateTime(note.createdAt))}</div>
    <div>変更: ${escapeHtml(formatDateTime(note.bodyUpdatedAt || note.updatedAt))}</div>
  `;
}

function formatDateTime(value) {
  const date = new Date(value || Date.now());
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function setSaveStatus(state, savedAt = saveStatusTime) {
  saveStatusState = state;
  if (state === "saved") {
    saveStatusTime = savedAt || Date.now();
  }
  renderSaveStatus();
}

function renderSaveStatus() {
  if (saveStatusState === "editing") {
    saveStatus.textContent = "編集中...";
    return;
  }

  if (saveStatusState === "saving") {
    saveStatus.textContent = "保存中...";
    return;
  }

  if (saveStatusState === "error") {
    saveStatus.textContent = "保存エラー";
    return;
  }

  saveStatus.textContent = isCompactSaveStatus()
    ? `保存済み ${formatSavedTime(saveStatusTime)}`
    : `保存済み: ${formatSavedDateTime(saveStatusTime)}`;
}

function isCompactSaveStatus() {
  return window.matchMedia("(max-width: 1039px)").matches;
}

function formatSavedDateTime(value) {
  const date = new Date(value || Date.now());
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${formatSavedTime(date)}`;
}

function formatSavedTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

// バックアップZIP名に使う日付文字列を作ります。
function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function todayStampDashed() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function openSettingsDialog() {
  restoreTheme();
  prepareFontSettingsDialog();
  beginAiSettingsSession();
  renderAiSettings();
  renderAiUi();
  await renderStorageStatus();
  settingsDialog.showModal();
}

function restoreGlobalFontSettings() {
  try {
    const stored = localStorage.getItem(FONT_SETTINGS_STORAGE_KEY);
    globalFontSettings = normalizeFontSettings(stored ? JSON.parse(stored) : null);
  } catch (error) {
    console.warn("Font settings restore failed", error);
    globalFontSettings = normalizeFontSettings(null);
  }
}

function consumeReturnedFontSelection() {
  const hasFontReturn = new URLSearchParams(location.search).has("fontSource");
  if (!hasFontReturn) return;

  try {
    pendingFontSelection = readFontSelection(location.search);
    if (!pendingFontSelection) {
      fontSelectionMessage = "フォント選択の送信元を確認できませんでした。";
    }
  } catch (error) {
    pendingFontSelection = null;
    fontSelectionMessage = error.message || "フォント選択を読み込めませんでした。";
  } finally {
    history.replaceState(history.state, "", withoutFontSelectionParams(location.href));
  }
}

function validatePendingFontSelectionMemo() {
  if (!pendingFontSelection || pendingFontSelection.scope !== "note") return;
  const matchingNote = notes.find((note) => note.id === pendingFontSelection.memoId && !note.deletedAt);
  if (matchingNote) return;
  pendingFontSelection = null;
  fontSelectionMessage = "対象メモを確認できないため、受け取ったフォントは適用していません。";
}

function populateFontSettingOptions() {
  const fontSelects = [
    globalTitleFontSelect,
    globalBodyFontSelect,
    globalHeadingFontSelect,
    globalCodeFontSelect,
    noteTitleFontSelect,
    noteBodyFontSelect,
    noteHeadingFontSelect,
    noteCodeFontSelect
  ];
  fontSelects.forEach((select) => {
    if (!select || select.options.length) return;
    FONT_OPTIONS.forEach((font) => select.add(new Option(font.label, font.id)));
  });

  [
    [globalTitleFontSizeSelect, TITLE_FONT_SIZES],
    [noteTitleFontSizeSelect, TITLE_FONT_SIZES],
    [globalBodyFontSizeSelect, BODY_FONT_SIZES],
    [noteBodyFontSizeSelect, BODY_FONT_SIZES],
    [globalCodeFontSizeSelect, CODE_FONT_SIZES],
    [noteCodeFontSizeSelect, CODE_FONT_SIZES]
  ].forEach(([select, sizes]) => {
    if (!select || select.options.length) return;
    sizes.forEach((size) => select.add(new Option(String(size), String(size))));
  });
}

function setFontSettingFields(prefix, settings) {
  const normalized = normalizeFontSettings(settings);
  const fields = prefix === "note"
    ? {
        titleFont: noteTitleFontSelect,
        titleSize: noteTitleFontSizeSelect,
        bodyFont: noteBodyFontSelect,
        bodySize: noteBodyFontSizeSelect,
        headingFont: noteHeadingFontSelect,
        codeFont: noteCodeFontSelect,
        codeSize: noteCodeFontSizeSelect
      }
    : {
        titleFont: globalTitleFontSelect,
        titleSize: globalTitleFontSizeSelect,
        bodyFont: globalBodyFontSelect,
        bodySize: globalBodyFontSizeSelect,
        headingFont: globalHeadingFontSelect,
        codeFont: globalCodeFontSelect,
        codeSize: globalCodeFontSizeSelect
      };
  fields.titleFont.value = normalized.titleFontId;
  fields.titleSize.value = String(normalized.titleFontSize);
  fields.bodyFont.value = normalized.bodyFontId;
  fields.bodySize.value = String(normalized.bodyFontSize);
  fields.headingFont.value = normalized.headingFontId;
  fields.codeFont.value = normalized.codeFontId;
  fields.codeSize.value = String(normalized.codeFontSize);
}

function readFontSettingFields(prefix) {
  const noteFields = prefix === "note";
  return normalizeFontSettings({
    titleFontId: (noteFields ? noteTitleFontSelect : globalTitleFontSelect).value,
    titleFontSize: (noteFields ? noteTitleFontSizeSelect : globalTitleFontSizeSelect).value,
    bodyFontId: (noteFields ? noteBodyFontSelect : globalBodyFontSelect).value,
    bodyFontSize: (noteFields ? noteBodyFontSizeSelect : globalBodyFontSizeSelect).value,
    headingFontId: (noteFields ? noteHeadingFontSelect : globalHeadingFontSelect).value,
    codeFontId: (noteFields ? noteCodeFontSelect : globalCodeFontSelect).value,
    codeFontSize: (noteFields ? noteCodeFontSizeSelect : globalCodeFontSizeSelect).value
  });
}

function prepareFontSettingsDialog() {
  populateFontSettingOptions();
  const noteSettings = normalizeNoteFontSettings(currentNote()?.fontSettings);
  fontSettingsDraft = {
    global: normalizeFontSettings(globalFontSettings),
    note: normalizeFontSettings(noteSettings || globalFontSettings),
    noteEnabled: Boolean(noteSettings)
  };
  setFontSettingFields("global", fontSettingsDraft.global);
  setFontSettingFields("note", fontSettingsDraft.note);
  noteFontOverrideEnabled.checked = fontSettingsDraft.noteEnabled;
  noteFontSettingsGroup.disabled = !fontSettingsDraft.noteEnabled;
  renderPendingFontSelection();
  fontSettingsStatus.textContent = fontSelectionMessage;
  updateFontSettingsPreview();
}

function currentFontDraft() {
  if (!fontSettingsDraft) prepareFontSettingsDialog();
  fontSettingsDraft.global = readFontSettingFields("global");
  fontSettingsDraft.note = readFontSettingFields("note");
  fontSettingsDraft.noteEnabled = noteFontOverrideEnabled.checked;
  return fontSettingsDraft;
}

function setFontVariables(element, settings) {
  if (!element) return;
  const normalized = normalizeFontSettings(settings);
  element.style.setProperty("--memo-title-font-family", fontOption(normalized.titleFontId).cssFamily);
  element.style.setProperty("--memo-title-font-size", `${normalized.titleFontSize}px`);
  element.style.setProperty("--memo-body-font-family", fontOption(normalized.bodyFontId).cssFamily);
  element.style.setProperty("--memo-body-font-size", `${normalized.bodyFontSize}px`);
  element.style.setProperty("--memo-heading-font-family", fontOption(normalized.headingFontId).cssFamily);
  element.style.setProperty("--memo-code-font-family", fontOption(normalized.codeFontId).cssFamily);
  element.style.setProperty("--memo-code-font-size", `${normalized.codeFontSize}px`);
}

function applyEffectiveFontSettings() {
  const settings = effectiveFontSettings(globalFontSettings, currentNote()?.fontSettings);
  setFontVariables(editorCard, settings);
  setFontVariables(previewCard, settings);
}

function updateFontSettingsPreview() {
  const draft = currentFontDraft();
  const settings = draft.noteEnabled ? draft.note : draft.global;
  setFontVariables(fontSettingsPreview, settings);
}

function renderPendingFontSelection() {
  if (!pendingFontSelection) {
    receivedFontSelection.hidden = true;
    receivedFontSelectionDetails.textContent = "";
    return;
  }
  const targetLabels = { body: "本文", heading: "見出し", code: "コード" };
  const scopeLabel = pendingFontSelection.scope === "note" ? "このメモ" : "全体設定";
  receivedFontSelectionDetails.textContent = `${scopeLabel}の${targetLabels[pendingFontSelection.target]}: ${pendingFontSelection.label}`;
  receivedFontSelection.hidden = false;
}

function applyPendingFontSelectionToDraft() {
  if (!pendingFontSelection) return;
  const selectMap = {
    global: {
      body: globalBodyFontSelect,
      heading: globalHeadingFontSelect,
      code: globalCodeFontSelect
    },
    note: {
      body: noteBodyFontSelect,
      heading: noteHeadingFontSelect,
      code: noteCodeFontSelect
    }
  };
  if (pendingFontSelection.scope === "note") {
    noteFontOverrideEnabled.checked = true;
    noteFontSettingsGroup.disabled = false;
  }
  selectMap[pendingFontSelection.scope][pendingFontSelection.target].value = pendingFontSelection.fontId;
  pendingFontSelection = null;
  fontSelectionMessage = "選択をプレビューへ反映しました。保存すると確定します。";
  fontSettingsStatus.textContent = fontSelectionMessage;
  renderPendingFontSelection();
  updateFontSettingsPreview();
}

function discardPendingFontSelection() {
  pendingFontSelection = null;
  fontSelectionMessage = "受け取ったフォント選択をキャンセルしました。";
  fontSettingsStatus.textContent = fontSelectionMessage;
  renderPendingFontSelection();
}

function openFontComparison(event) {
  const button = event.currentTarget;
  const target = button.dataset.fontTarget;
  const scope = button.dataset.fontScope;
  const draft = currentFontDraft();
  const settings = scope === "note" ? draft.note : draft.global;
  const currentFontId = target === "heading"
    ? settings.headingFontId
    : target === "code"
      ? settings.codeFontId
      : settings.bodyFontId;
  const returnPath = withoutFontSelectionParams(location.href);
  const url = buildFontComparisonUrl({
    target,
    scope,
    currentFontId,
    returnUrl: new URL(returnPath, location.origin).toString(),
    sample: comparisonSample(fontComparisonSample.value, editor.value, target),
    memoId: scope === "note" ? currentId : ""
  });
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
  else fontSettingsStatus.textContent = "新しいタブを開けませんでした。ブラウザのポップアップ設定を確認してください。";
}

async function saveFontSettings() {
  const draft = currentFontDraft();
  globalFontSettings = normalizeFontSettings(draft.global);
  localStorage.setItem(FONT_SETTINGS_STORAGE_KEY, JSON.stringify(globalFontSettings));

  const note = currentNote();
  if (note) {
    const previousNoteSettings = normalizeNoteFontSettings(note.fontSettings);
    const nextNoteSettings = draft.noteEnabled
      ? { enabled: true, ...normalizeFontSettings(draft.note) }
      : null;
    if (!noteFontSettingsEqual(previousNoteSettings, nextNoteSettings)) {
      if (nextNoteSettings) note.fontSettings = nextNoteSettings;
      else delete note.fontSettings;
      note.updatedAt = Date.now();
      await putNote(note);
      notes = await getAllNotes();
      currentId = note.id;
    }
  }
  applyEffectiveFontSettings();
  renderPreview();
  fontSelectionMessage = "フォント設定を保存しました。";
  fontSettingsStatus.textContent = fontSelectionMessage;
}

async function resetFontSettings() {
  if (!confirm("全体と各メモのフォント設定を初期設定へ戻しますか？")) return;
  localStorage.removeItem(FONT_SETTINGS_STORAGE_KEY);
  globalFontSettings = normalizeFontSettings(null);
  const updatedNotes = notes.map((note) => {
    if (!Object.prototype.hasOwnProperty.call(note, "fontSettings")) return note;
    const updated = { ...note };
    delete updated.fontSettings;
    return updated;
  });
  await updateNotesTransaction(updatedNotes);
  notes = await getAllNotes();
  prepareFontSettingsDialog();
  applyEffectiveFontSettings();
  renderPreview();
  fontSelectionMessage = "フォント設定を初期設定へ戻しました。";
  fontSettingsStatus.textContent = fontSelectionMessage;
}

async function renderStorageStatus() {
  if (!storageStatusDetails || !storageEstimateMessage) return;

  const rows = [
    ["保存方式", "IndexedDB"],
    ["DB名", DB_NAME],
    ["ストア名", `${STORE_NAME} / ${COLLECTION_STORE_NAME} / ${ATTACHMENT_STORE_NAME}`],
    ["メモ件数", `${activeNotes().length}件`],
    ["使用容量", "取得未対応"],
    ["上限目安", "取得未対応"],
    ["使用率", "取得未対応"],
    ["アプリバージョン", `v${APP_VERSION} "${APP_LABEL}" (${APP_BUILD})`],
    ["現在のURL", location.href]
  ];

  storageEstimateMessage.textContent = "";

  if (navigator.storage && typeof navigator.storage.estimate === "function") {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      rows[4][1] = `${formatMegabytes(usage)} MB`;
      rows[5][1] = quota ? `${formatMegabytes(quota)} MB` : "不明";
      rows[6][1] = quota ? `${((usage / quota) * 100).toFixed(2)}%` : "不明";
    } catch (error) {
      console.warn("Storage estimate failed", error);
      storageEstimateMessage.textContent = "保存容量を取得できませんでした";
    }
  } else {
    storageEstimateMessage.textContent = "このブラウザでは保存容量の取得に対応していません";
  }

  storageStatusDetails.innerHTML = rows.map(([label, value]) => `
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}</dd>
  `).join("");
}

function formatMegabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function toggleCollectionExplorer(force) {
  const open = typeof force === "boolean" ? force : contextPanelTab !== "collection" || !contextPanelOpen;
  if (open) {
    closeLayoutOverlays({ restoreFocus: false });
    setContextPanelTab("collection", { focus: false });
    collectionTree.focus();
  } else {
    setContextPanelOpen(false, { restoreFocus: false });
    closeCollectionMenus();
  }
}

function renderCollectionExplorer() {
  if (!collectionTree) return;
  const countMap = buildCollectionCountMap();
  const roots = collections.filter((collection) => collection.parentId === null && !collection.isSystem).sort(compareCollections);
  collectionTree.innerHTML = "";
  roots.forEach((collection) => collectionTree.appendChild(renderCollectionNode(collection, 1, countMap)));

  const unclassified = collections.find((collection) => collection.id === UNCLASSIFIED_COLLECTION_ID);
  if (unclassified) collectionTree.appendChild(renderCollectionNode(unclassified, 1, countMap));
  collectionTree.appendChild(renderTrashNode());
  renderSelectionBar();

  if (editingCollectionId) {
    requestAnimationFrame(() => {
      const input = collectionTree.querySelector(`[data-edit-collection-id="${CSS.escape(editingCollectionId)}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    });
  }
}

function buildCollectionCountMap() {
  const counts = new Map(collections.map((collection) => [collection.id, 0]));
  activeNotes().forEach((note) => {
    let id = collectionExists(note.collectionId) ? note.collectionId : UNCLASSIFIED_COLLECTION_ID;
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      counts.set(id, (counts.get(id) || 0) + 1);
      id = collections.find((collection) => collection.id === id)?.parentId || null;
    }
  });
  return counts;
}

function renderCollectionNode(collection, depth, countMap) {
  const node = document.createElement("div");
  node.className = "collection-node";
  node.dataset.collectionId = collection.id;
  const children = childCollections(collection.id);
  const directNotes = sortCollectionMemos(
    activeNotes().filter((note) => normalizedCollectionId(note) === collection.id)
  );
  const expanded = expandedCollectionIds.has(collection.id);
  const row = document.createElement("div");
  row.className = "collection-row";
  row.draggable = !collection.isSystem;
  row.tabIndex = 0;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth));
  row.setAttribute("aria-expanded", String(expanded));
  row.setAttribute("aria-selected", String(selectedCollectionId === collection.id));
  row.style.paddingLeft = `${Math.max(4, (depth - 1) * 18 + 4)}px`;
  row.innerHTML = `
    <span class="collection-toggle" aria-hidden="true">${expanded ? "▼" : "▶"}</span>
    <span class="collection-icon" aria-hidden="true">▱</span>
    <span class="collection-label">${editingCollectionId === collection.id
      ? `<input class="collection-inline-name" data-edit-collection-id="${escapeAttr(collection.id)}" value="${escapeAttr(collection.name)}" aria-label="コレクション名">`
      : escapeHtml(collection.name)}</span>
    <span class="collection-count">(${countMap.get(collection.id) || 0})</span>
    ${collection.isSystem ? "" : `<button class="collection-more" type="button" aria-label="${escapeAttr(collection.name)}の操作">…</button>`}
  `;

  const toggle = row.querySelector(".collection-toggle");
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCollectionExpanded(collection.id);
  });
  row.addEventListener("click", (event) => {
    if (event.target.closest("button,input")) return;
    selectedCollectionId = collection.id;
    selectedMemoIds.clear();
    renderList();
    renderCollectionExplorer();
  });
  row.addEventListener("dblclick", () => toggleCollectionExpanded(collection.id));
  row.addEventListener("keydown", (event) => handleCollectionRowKeydown(event, collection.id));
  const more = row.querySelector(".collection-more");
  if (more) more.addEventListener("click", (event) => showCollectionMenu(event, collection.id));
  if (!collection.isSystem) row.addEventListener("contextmenu", (event) => showCollectionMenu(event, collection.id));
  wireCollectionDrag(row, collection);
  node.appendChild(row);

  const input = row.querySelector(".collection-inline-name");
  if (input) wireInlineCollectionName(input, collection);

  if (expanded) {
    directNotes.forEach((note) => node.appendChild(renderCollectionMemo(note, depth + 1)));
    children.forEach((child) => node.appendChild(renderCollectionNode(child, depth + 1, countMap)));
  }
  return node;
}

function sortCollectionMemos(memos) {
  return [...memos].sort(compareCollectionMemos);
}

function compareCollectionMemos(a, b) {
  const aCreatedAt = collectionMemoCreatedAt(a);
  const bCreatedAt = collectionMemoCreatedAt(b);

  if (aCreatedAt === null && bCreatedAt !== null) return 1;
  if (aCreatedAt !== null && bCreatedAt === null) return -1;

  if (aCreatedAt !== null && bCreatedAt !== null && aCreatedAt !== bCreatedAt) {
    return collectionSortOrder === "oldest"
      ? aCreatedAt - bCreatedAt
      : bCreatedAt - aCreatedAt;
  }

  return String(a.id).localeCompare(String(b.id));
}

function collectionMemoCreatedAt(note) {
  const value = note.createdAt;
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function renderTrashNode() {
  const node = document.createElement("div");
  node.className = "collection-node collection-trash-separator";
  const deleted = notes.filter((note) => note.deletedAt);
  const expanded = expandedCollectionIds.has("trash");
  const row = document.createElement("div");
  row.className = "collection-row";
  row.tabIndex = 0;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", "1");
  row.setAttribute("aria-expanded", String(expanded));
  row.setAttribute("aria-selected", String(selectedCollectionId === "trash"));
  row.innerHTML = `<span class="collection-toggle">${expanded ? "▼" : "▶"}</span><span class="collection-icon">♲</span><span class="collection-label">ゴミ箱</span><span class="collection-count">(${deleted.length})</span>`;
  row.addEventListener("click", () => {
    selectedCollectionId = "trash";
    selectedMemoIds.clear();
    renderList();
    toggleCollectionExpanded("trash", true);
  });
  row.addEventListener("keydown", (event) => handleCollectionRowKeydown(event, "trash"));
  node.appendChild(row);
  if (expanded) deleted.forEach((note) => node.appendChild(renderCollectionMemo(note, 2, true)));
  return node;
}

function renderCollectionMemo(note, depth, isDeleted = false) {
  const row = document.createElement("div");
  row.className = "collection-memo-row";
  row.dataset.memoId = note.id;
  row.draggable = !isDeleted;
  row.tabIndex = 0;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth));
  row.setAttribute("aria-selected", String(selectedMemoIds.has(note.id)));
  const created = formatExplorerDate(note.createdAt);
  row.innerHTML = `<span class="collection-memo-main"><span class="collection-memo-title">${escapeHtml(note.title)}</span><span class="collection-memo-date">${created ? `作成 ${created}` : "作成日不明"}</span></span><button class="collection-memo-more" type="button" aria-label="${escapeAttr(note.title)}の操作">…</button>`;
  row.addEventListener("click", (event) => handleMemoSelection(event, note.id, isDeleted));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openNote(note.id);
    if (event.key === " ") {
      event.preventDefault();
      handleMemoSelection(event, note.id, isDeleted);
    }
  });
  row.querySelector(".collection-memo-more").addEventListener("click", (event) => {
    event.stopPropagation();
    showMemoMenu(event, note, isDeleted);
  });
  if (!isDeleted) wireMemoDrag(row, note.id);
  return row;
}

function formatExplorerDate(value) {
  if (value == null || Number.isNaN(new Date(value).getTime())) return "";
  const date = new Date(value);
  return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
}

function normalizedCollectionId(note) {
  return collectionExists(note.collectionId) ? note.collectionId : UNCLASSIFIED_COLLECTION_ID;
}

function childCollections(parentId) {
  return collections.filter((collection) => collection.parentId === parentId && !collection.isSystem).sort(compareCollections);
}

function toggleCollectionExpanded(id, forceOpen = false) {
  if (forceOpen || !expandedCollectionIds.has(id)) expandedCollectionIds.add(id);
  else expandedCollectionIds.delete(id);
  renderCollectionExplorer();
}

function handleCollectionRowKeydown(event, id) {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    expandedCollectionIds.add(id);
    renderCollectionExplorer();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    expandedCollectionIds.delete(id);
    renderCollectionExplorer();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectedCollectionId = id;
    renderList();
    renderCollectionExplorer();
  } else if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && id !== "trash" && id !== UNCLASSIFIED_COLLECTION_ID) {
    event.preventDefault();
    showCollectionMenu(event, id);
  }
}

function handleMemoSelection(event, id, isDeleted) {
  const visibleIds = getVisibleMemoIds(isDeleted);
  if (event.shiftKey && selectionAnchorId && visibleIds.includes(selectionAnchorId)) {
    const start = visibleIds.indexOf(selectionAnchorId);
    const end = visibleIds.indexOf(id);
    const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    if (!event.ctrlKey && !event.metaKey) selectedMemoIds.clear();
    range.forEach((memoId) => selectedMemoIds.add(memoId));
  } else if (event.ctrlKey || event.metaKey) {
    if (selectedMemoIds.has(id)) selectedMemoIds.delete(id);
    else selectedMemoIds.add(id);
    selectionAnchorId = id;
  } else {
    selectedMemoIds.clear();
    selectedMemoIds.add(id);
    selectionAnchorId = id;
    openNote(id);
  }
  renderCollectionExplorer();
}

function getVisibleMemoIds(deletedOnly = false) {
  return [...collectionTree.querySelectorAll(".collection-memo-row")]
    .map((row) => row.dataset.memoId)
    .filter((id) => Boolean(notes.find((note) => note.id === id)?.deletedAt) === deletedOnly);
}

function renderSelectionBar() {
  const selected = [...selectedMemoIds].filter((id) => notes.some((note) => note.id === id));
  selectedMemoIds = new Set(selected);
  if (!selected.length) {
    collectionSelectionBar.hidden = true;
    collectionSelectionBar.innerHTML = "";
    return;
  }
  const hasDeleted = selected.some((id) => notes.find((note) => note.id === id)?.deletedAt);
  collectionSelectionBar.hidden = false;
  collectionSelectionBar.innerHTML = `<strong>${selected.length}件選択中</strong>${hasDeleted ? "" : '<button type="button" data-action="move">移動</button><button type="button" data-action="delete">削除</button>'}<button type="button" data-action="clear">選択解除</button>`;
  collectionSelectionBar.querySelector('[data-action="move"]')?.addEventListener("click", () => openMemoMoveDialog(selected));
  collectionSelectionBar.querySelector('[data-action="delete"]')?.addEventListener("click", () => moveMemosToTrash(selected));
  collectionSelectionBar.querySelector('[data-action="clear"]').addEventListener("click", () => {
    selectedMemoIds.clear();
    renderCollectionExplorer();
  });
}

async function createCollection(parentId = defaultNewCollectionParent()) {
  if (parentId && (!collectionExists(parentId) || parentId === UNCLASSIFIED_COLLECTION_ID || collectionDepth(parentId) >= MAX_COLLECTION_DEPTH)) {
    showCollectionToast(parentId && collectionDepth(parentId) >= MAX_COLLECTION_DEPTH ? "コレクションは5階層まで作成できます" : "この場所には作成できません");
    return;
  }
  const siblings = collections.filter((collection) => collection.parentId === parentId);
  const now = new Date().toISOString();
  const collection = {
    id: crypto.randomUUID(),
    name: uniqueCollectionName("新しいコレクション", parentId),
    parentId,
    sortOrder: Math.max(0, ...siblings.map((item) => Number(item.sortOrder || 0))) + 10,
    isSystem: false,
    createdAt: now,
    updatedAt: now
  };
  await putCollection(collection);
  collections = await getAllCollections();
  if (parentId) expandedCollectionIds.add(parentId);
  editingCollectionId = collection.id;
  selectedCollectionId = collection.id;
  renderCollectionExplorer();
}

function defaultNewCollectionParent() {
  return selectedCollectionId && collectionExists(selectedCollectionId) && selectedCollectionId !== UNCLASSIFIED_COLLECTION_ID
    ? selectedCollectionId
    : null;
}

function uniqueCollectionName(base, parentId, exceptId = null) {
  const names = new Set(collections.filter((collection) => collection.parentId === parentId && collection.id !== exceptId).map((collection) => collection.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

function wireInlineCollectionName(input, collection) {
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const name = input.value.trim();
    if (!name) {
      showCollectionToast("コレクション名を入力してください");
      editingCollectionId = collection.id;
      renderCollectionExplorer();
      return;
    }
    const duplicate = collections.some((item) => item.id !== collection.id && item.parentId === collection.parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) {
      showCollectionToast("同じ場所に同名のコレクションがあります");
      editingCollectionId = collection.id;
      renderCollectionExplorer();
      return;
    }
    collection.name = name;
    collection.updatedAt = new Date().toISOString();
    await putCollection(collection);
    collections = await getAllCollections();
    editingCollectionId = null;
    renderCollectionExplorer();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") commit().catch(showCollectionError);
    if (event.key === "Escape") {
      committed = true;
      editingCollectionId = null;
      renderCollectionExplorer();
    }
  });
  input.addEventListener("blur", () => commit().catch(showCollectionError));
}

function showCollectionMenu(event, collectionId) {
  event.preventDefault();
  event.stopPropagation();
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection || collection.isSystem) return;
  selectedCollectionId = collectionId;
  collectionMenu.innerHTML = `
    <button type="button" data-action="child">子コレクションを作成</button>
    <button type="button" data-action="rename">名前を変更</button>
    <button type="button" data-action="move">移動</button>
    <button type="button" data-action="export">エクスポート</button>
    <button type="button" data-action="delete" class="danger-button">削除</button>`;
  positionPopup(collectionMenu, event);
  collectionMenu.querySelector('[data-action="child"]').disabled = collectionDepth(collectionId) >= MAX_COLLECTION_DEPTH;
  collectionMenu.querySelector('[data-action="child"]').addEventListener("click", () => runMenuAction(() => createCollection(collectionId)));
  collectionMenu.querySelector('[data-action="rename"]').addEventListener("click", () => {
    editingCollectionId = collectionId;
    closeCollectionMenus();
    renderCollectionExplorer();
  });
  collectionMenu.querySelector('[data-action="move"]').addEventListener("click", () => {
    closeCollectionMenus();
    openCollectionMoveDialog(collectionId);
  });
  collectionMenu.querySelector('[data-action="export"]').addEventListener("click", () => {
    closeCollectionMenus();
    openCollectionExportDialog(collectionId);
  });
  collectionMenu.querySelector('[data-action="delete"]').addEventListener("click", () => runMenuAction(() => deleteCollectionSafely(collectionId)));
}

function showMemoMenu(event, note, isDeleted) {
  collectionMenu.innerHTML = isDeleted
    ? '<button type="button" data-action="restore">元のコレクションへ復元</button><button type="button" data-action="permanent" class="danger-button">完全に削除</button>'
    : '<button type="button" data-action="move">コレクションへ移動</button><button type="button" data-action="trash" class="danger-button">ゴミ箱へ移動</button>';
  positionPopup(collectionMenu, event);
  if (isDeleted) {
    collectionMenu.querySelector('[data-action="restore"]').addEventListener("click", () => runMenuAction(() => restoreMemos([note.id])));
    collectionMenu.querySelector('[data-action="permanent"]').addEventListener("click", () => runMenuAction(() => permanentlyDeleteMemos([note.id])));
  } else {
    const ids = selectedMemoIds.has(note.id) ? [...selectedMemoIds] : [note.id];
    collectionMenu.querySelector('[data-action="move"]').addEventListener("click", () => {
      closeCollectionMenus();
      openMemoMoveDialog(ids);
    });
    collectionMenu.querySelector('[data-action="trash"]').addEventListener("click", () => runMenuAction(() => moveMemosToTrash(ids)));
  }
}

function positionPopup(menu, event) {
  closeCollectionMenus();
  menu.hidden = false;
  const x = Math.min(event.clientX || 20, window.innerWidth - 230);
  const y = Math.min(event.clientY || 60, window.innerHeight - 260);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

function closeCollectionMenus() {
  collectionMenu.hidden = true;
  collectionAddMenu.hidden = true;
}

function runMenuAction(action) {
  closeCollectionMenus();
  Promise.resolve(action()).catch(showCollectionError);
}

function showCollectionError(error) {
  console.error("Collection operation failed", error);
  showCollectionToast(`操作に失敗しました: ${error.message || error}`);
}

function showCollectionToast(message) {
  clearTimeout(collectionToastTimer);
  collectionToast.textContent = message;
  collectionToast.hidden = false;
  collectionToastTimer = setTimeout(() => { collectionToast.hidden = true; }, 3500);
}

function collectionDepth(id) {
  let depth = 0;
  let current = collections.find((collection) => collection.id === id);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = collections.find((collection) => collection.id === current.parentId);
  }
  return depth;
}

function subtreeHeight(id) {
  const children = childCollections(id);
  return children.length ? 1 + Math.max(...children.map((child) => subtreeHeight(child.id))) : 1;
}

function descendantCollectionIds(id) {
  const result = [];
  const visit = (parentId) => childCollections(parentId).forEach((child) => {
    result.push(child.id);
    visit(child.id);
  });
  visit(id);
  return result;
}

function validateCollectionMove(id, parentId) {
  const collection = collections.find((item) => item.id === id);
  if (!collection || collection.isSystem) return "このコレクションは移動できません";
  if (parentId === id || descendantCollectionIds(id).includes(parentId)) return "自分自身や子孫へは移動できません";
  if (parentId === UNCLASSIFIED_COLLECTION_ID || parentId === "trash" || (parentId && !collectionExists(parentId))) return "この場所へは移動できません";
  const baseDepth = parentId ? collectionDepth(parentId) : 0;
  if (baseDepth + subtreeHeight(id) > MAX_COLLECTION_DEPTH) return "コレクションは5階層まで作成できます";
  return "";
}

async function moveCollection(id, parentId, beforeId = null, afterId = null) {
  const error = validateCollectionMove(id, parentId);
  if (error) {
    showCollectionToast(error);
    return false;
  }
  const moving = collections.find((collection) => collection.id === id);
  const siblings = collections.filter((collection) => collection.parentId === parentId && !collection.isSystem && collection.id !== id).sort(compareCollections);
  let index = siblings.length;
  if (beforeId) index = Math.max(0, siblings.findIndex((item) => item.id === beforeId));
  if (afterId) index = Math.max(0, siblings.findIndex((item) => item.id === afterId) + 1);
  siblings.splice(index, 0, moving);
  const now = new Date().toISOString();
  siblings.forEach((item, order) => {
    item.parentId = parentId;
    item.sortOrder = (order + 1) * 10;
    item.updatedAt = now;
  });
  await updateCollectionsTransaction(siblings);
  collections = await getAllCollections();
  if (parentId) expandedCollectionIds.add(parentId);
  renderCollectionExplorer();
  showCollectionToast(`「${moving.name}」を移動しました`);
  return true;
}

function updateCollectionsTransaction(items) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COLLECTION_STORE_NAME, "readwrite");
    const store = transaction.objectStore(COLLECTION_STORE_NAME);
    items.forEach((item) => store.put(item));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function moveMemosToCollection(memoIds, collectionId) {
  if (!collectionExists(collectionId)) throw new Error("移動先コレクションが存在しません");
  const targets = [...new Set(memoIds)].map((id) => notes.find((note) => note.id === id)).filter((note) => note && !note.deletedAt);
  if (!targets.length) return;
  if (targets.some((note) => note.id === currentId)) {
    await flushSave();
  }
  const now = Date.now();
  const updated = targets.map((note) => ({ ...note, collectionId, updatedAt: now }));
  await updateNotesTransaction(updated);
  notes = await getAllNotes();
  selectedMemoIds = new Set(updated.map((note) => note.id));
  expandedCollectionIds.add(collectionId);
  renderAll();
  showCollectionToast(`${updated.length}件を「${collections.find((item) => item.id === collectionId).name}」へ移動しました`);
}

async function moveMemosToTrash(memoIds) {
  const targets = [...new Set(memoIds)].map((id) => notes.find((note) => note.id === id)).filter((note) => note && !note.deletedAt);
  if (!targets.length || !confirm(`${targets.length}件をゴミ箱へ移動しますか？`)) return;
  if (targets.some((note) => note.id === currentId)) {
    await flushSave();
  }
  const deletedAt = new Date().toISOString();
  await updateNotesTransaction(targets.map((note) => ({ ...note, deletedAt, updatedAt: Date.now() })));
  targets.forEach((note) => removeDraftMirrorForNote(note.id));
  notes = await getAllNotes();
  invalidateTermRelationIndex();
  selectedMemoIds.clear();
  if (targets.some((note) => note.id === currentId)) {
    const next = activeNotes()[0] || await createNote("新規メモ", "");
    notes = await getAllNotes();
    openNote(next.id);
  }
  renderAll();
  showCollectionToast(`${targets.length}件をゴミ箱へ移動しました`);
}

async function restoreMemos(memoIds) {
  const targets = memoIds.map((id) => notes.find((note) => note.id === id)).filter((note) => note?.deletedAt);
  const updated = targets.map((note) => ({ ...note, collectionId: collectionExists(note.collectionId) ? note.collectionId : UNCLASSIFIED_COLLECTION_ID, deletedAt: null, updatedAt: Date.now() }));
  await updateNotesTransaction(updated);
  notes = await getAllNotes();
  invalidateTermRelationIndex();
  selectedMemoIds.clear();
  renderAll();
  if (updated[0]) openNote(updated[0].id);
  showCollectionToast(`${updated.length}件を復元しました`);
}

async function permanentlyDeleteMemos(memoIds) {
  const targets = memoIds.map((id) => notes.find((note) => note.id === id)).filter((note) => note?.deletedAt);
  if (!targets.length || !confirm(`${targets.length}件を完全に削除しますか？\nこの操作は元に戻せません。`)) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, ATTACHMENT_STORE_NAME], "readwrite");
    const noteStore = transaction.objectStore(STORE_NAME);
    const attachmentIndex = transaction.objectStore(ATTACHMENT_STORE_NAME).index("memoId");
    targets.forEach((note) => {
      noteStore.delete(note.id);
      const request = attachmentIndex.openKeyCursor(IDBKeyRange.only(note.id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        transaction.objectStore(ATTACHMENT_STORE_NAME).delete(cursor.primaryKey);
        cursor.continue();
      };
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  targets.forEach((note) => removeDraftMirrorForNote(note.id));
  notes = await getAllNotes();
  invalidateTermRelationIndex();
  selectedMemoIds.clear();
  if (targets.some((note) => note.id === currentId)) {
    let next = activeNotes()[0];
    if (!next) {
      next = await createNote("新規メモ", "");
      notes = await getAllNotes();
    }
    openNote(next.id);
  }
  renderAll();
  showCollectionToast(`${targets.length}件を完全に削除しました`);
}

async function deleteCollectionSafely(id) {
  const collection = collections.find((item) => item.id === id);
  if (!collection || collection.isSystem) return;
  const subtreeIds = [id, ...descendantCollectionIds(id)];
  const affected = activeNotes().filter((note) => subtreeIds.includes(normalizedCollectionId(note)));
  if (!confirm(`「${collection.name}」と子コレクションを削除しますか？\n配下のメモ ${affected.length}件は未分類へ移動します。メモ本体は削除されません。`)) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, COLLECTION_STORE_NAME], "readwrite");
    const noteStore = transaction.objectStore(STORE_NAME);
    const collectionStore = transaction.objectStore(COLLECTION_STORE_NAME);
    affected.forEach((note) => noteStore.put({ ...note, collectionId: UNCLASSIFIED_COLLECTION_ID, updatedAt: Date.now() }));
    subtreeIds.forEach((collectionId) => collectionStore.delete(collectionId));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  collections = await getAllCollections();
  notes = await getAllNotes();
  selectedCollectionId = UNCLASSIFIED_COLLECTION_ID;
  expandedCollectionIds.add(UNCLASSIFIED_COLLECTION_ID);
  renderAll();
  showCollectionToast(`「${collection.name}」を削除し、メモを未分類へ移動しました`);
}

function openMemoMoveDialog(ids) {
  pendingMoveMemoIds = ids;
  pendingMoveCollectionId = null;
  collectionMoveTitle.textContent = `${ids.length}件をコレクションへ移動`;
  fillCollectionMoveSelect();
  collectionMoveDialog.showModal();
}

function openCollectionMoveDialog(id) {
  pendingMoveMemoIds = [];
  pendingMoveCollectionId = id;
  collectionMoveTitle.textContent = "コレクションを移動";
  fillCollectionMoveSelect(id, true);
  collectionMoveDialog.showModal();
}

function fillCollectionMoveSelect(excludeId = null, allowRoot = false) {
  const excluded = new Set(excludeId ? [excludeId, ...descendantCollectionIds(excludeId)] : []);
  const options = [];
  if (allowRoot) options.push('<option value="">ルート</option>');
  collectionOptions().forEach(({ collection, depth }) => {
    if (!collection.isSystem && !excluded.has(collection.id)) options.push(`<option value="${escapeAttr(collection.id)}">${escapeHtml(`${"　".repeat(depth - 1)}${collection.name}`)}</option>`);
    if (!allowRoot && collection.id === UNCLASSIFIED_COLLECTION_ID) options.push(`<option value="${escapeAttr(collection.id)}">${escapeHtml(collection.name)}</option>`);
  });
  collectionMoveSelect.innerHTML = options.join("");
}

function collectionOptions() {
  const result = [];
  const visit = (parentId, depth) => childCollections(parentId).forEach((collection) => {
    result.push({ collection, depth });
    visit(collection.id, depth + 1);
  });
  visit(null, 1);
  const unclassified = collections.find((collection) => collection.id === UNCLASSIFIED_COLLECTION_ID);
  if (unclassified) result.push({ collection: unclassified, depth: 1 });
  return result;
}

async function runPendingMove() {
  const destination = collectionMoveSelect.value || null;
  if (pendingMoveCollectionId) await moveCollection(pendingMoveCollectionId, destination);
  else await moveMemosToCollection(pendingMoveMemoIds, destination);
  collectionMoveDialog.close();
}

function wireMemoDrag(row, noteId) {
  row.addEventListener("dragstart", (event) => {
    draggedMemoIds = selectedMemoIds.has(noteId) ? [...selectedMemoIds] : [noteId];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedMemoIds.join(","));
    row.style.opacity = "0.5";
  });
  row.addEventListener("dragend", () => {
    row.style.opacity = "";
    draggedMemoIds = [];
    clearDropIndicators();
  });
}

function wireCollectionDrag(row, collection) {
  if (!collection.isSystem) {
    row.addEventListener("dragstart", (event) => {
      if (event.target.closest("button,input")) {
        event.preventDefault();
        return;
      }
      draggedCollectionId = collection.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", collection.id);
      row.style.opacity = "0.5";
    });
    row.addEventListener("dragend", () => {
      row.style.opacity = "";
      draggedCollectionId = null;
      clearDropIndicators();
    });
  }
  row.addEventListener("dragover", (event) => {
    if (collection.isSystem || (!draggedCollectionId && !draggedMemoIds.length)) return;
    event.preventDefault();
    clearDropIndicators();
    const rect = row.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    row.classList.add(draggedMemoIds.length ? "drop-inside" : ratio < 0.25 ? "drop-before" : ratio > 0.75 ? "drop-after" : "drop-inside");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-inside", "drop-before", "drop-after"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const before = row.classList.contains("drop-before");
    const after = row.classList.contains("drop-after");
    clearDropIndicators();
    if (draggedMemoIds.length) {
      moveMemosToCollection(draggedMemoIds, collection.id).catch(showCollectionError);
      return;
    }
    if (!draggedCollectionId) return;
    const parentId = before || after ? collection.parentId : collection.id;
    moveCollection(draggedCollectionId, parentId, before ? collection.id : null, after ? collection.id : null).catch(showCollectionError);
  });
}

function clearDropIndicators() {
  collectionTree.querySelectorAll(".drop-inside,.drop-before,.drop-after").forEach((row) => row.classList.remove("drop-inside", "drop-before", "drop-after"));
}

function collectionPath(id, includeSelf = true) {
  const path = [];
  let current = collections.find((collection) => collection.id === id);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (includeSelf || current.id !== id) path.unshift(safeFileName(current.name));
    current = collections.find((collection) => collection.id === current.parentId);
  }
  return path;
}

async function buildCollectionZipFiles(rootCollectionId = null, options = {}) {
  const allowedIds = rootCollectionId ? new Set([rootCollectionId, ...descendantCollectionIds(rootCollectionId)]) : null;
  const rootPath = rootCollectionId
    ? (options.relativeToRoot ? collectionPath(rootCollectionId) : collectionPath(rootCollectionId).slice(0, -1))
    : [];
  const items = activeNotes().filter((note) => !allowedIds || allowedIds.has(normalizedCollectionId(note))).map((note) => {
    let path = collectionPath(normalizedCollectionId(note));
    if (rootPath.length) path = path.slice(rootPath.length);
    return {
      memoId: note.id,
      name: [...path, `${safeFileName(note.title)}.md`].join("/"),
      content: `# ${note.title}\n\n${note.body}\n`,
      updatedAt: note.bodyUpdatedAt || note.updatedAt || note.createdAt || Date.now()
    };
  });
  const uniqueItems = uniqueZipFileNames(items);
  const reservedDirectoryPaths = new Set(collections.map((collection) => {
    let path = collectionPath(collection.id);
    if (rootPath.length) path = path.slice(rootPath.length);
    return path.join("/").toLocaleLowerCase();
  }).filter(Boolean));
  const files = [];
  for (const item of uniqueItems) {
    const attachments = await getAttachmentsForMemo(item.memoId);
    const bundle = buildMemoExportBundle({
      markdownPath: item.name,
      markdownContent: item.content,
      attachments,
      reservedDirectoryPaths
    });
    if (bundle.folderPath) reservedDirectoryPaths.add(bundle.folderPath.toLocaleLowerCase());
    bundle.files.forEach((file) => files.push({ ...file, updatedAt: file.updatedAt || item.updatedAt }));
  }
  return files;
}

async function buildSingleNoteExportBundle(note) {
  const attachments = await getAttachmentsForMemo(note.id);
  const bundle = buildMemoExportBundle({
    markdownPath: `${sanitizeWindowsName(note.title, "無題のメモ")}.md`,
    markdownContent: note.body,
    attachments
  });
  return {
    ...bundle,
    files: bundle.files.map((file) => ({
      ...file,
      updatedAt: file.updatedAt || note.bodyUpdatedAt || note.updatedAt || note.createdAt || Date.now()
    }))
  };
}

async function downloadCollectionZip(id) {
  const collection = collections.find((item) => item.id === id);
  if (!collection) throw new Error("コレクションが存在しません");
  await flushSave();
  const files = await buildCollectionZipFiles(id);
  const blob = await makeZip(files);
  downloadBlob(blob, `Memo-Nexus_${safeFileName(collection.name)}_${todayStampDashed()}.zip`);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clearExportResult() {
  exportStatus.textContent = "";
  exportStatus.classList.remove("error");
  exportFailures.innerHTML = "";
  exportFailures.hidden = true;
}

function showExportResult(message, failures = [], isError = false) {
  exportStatus.textContent = message;
  exportStatus.classList.toggle("error", isError);
  exportFailures.innerHTML = "";
  failures.forEach((failure) => {
    const item = document.createElement("li");
    item.textContent = failure;
    exportFailures.appendChild(item);
  });
  exportFailures.hidden = failures.length === 0;
}

function openNoteExportDialog() {
  const note = currentNote();
  if (!note) return;
  pendingExport = { type: "note", noteId: note.id, directoryHandle: null };
  exportDialogTitle.textContent = "このメモをエクスポート";
  exportDescription.textContent = "Markdown本文を変更せず保存します。添付がある場合は、Markdownと添付ファイルをまとめたZIPをダウンロードできます。";
  exportLocalNameRow.hidden = true;
  localExportBtn.hidden = !supportsDirectoryPicker();
  clearExportResult();
  exportDialog.showModal();
}

function openCollectionExportDialog(collectionId) {
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection) return;
  pendingExport = { type: "collection", collectionId, directoryHandle: null };
  exportDialogTitle.textContent = "コレクションをエクスポート";
  exportDescription.textContent = "ZIPをダウンロードするか、対応ブラウザでは階層をローカルフォルダへ書き出せます。ローカル書き出しは同期ではありません。";
  exportLocalName.value = sanitizeWindowsName(collection.name, "無題のコレクション");
  exportLocalNameRow.hidden = false;
  localExportBtn.hidden = !supportsDirectoryPicker();
  clearExportResult();
  exportDialog.showModal();
}

async function runDownloadExport() {
  if (!pendingExport) return;
  downloadExportBtn.disabled = true;
  try {
    if (pendingExport.type === "collection") {
      await downloadCollectionZip(pendingExport.collectionId);
    } else {
      await flushSave();
      const note = notes.find((item) => item.id === pendingExport.noteId);
      if (!note) throw new Error("メモが存在しません");
      const bundle = await buildSingleNoteExportBundle(note);
      const baseName = sanitizeWindowsName(note.title, "無題のメモ");
      if (!bundle.folderPath) {
        downloadBlob(new Blob([note.body], { type: "text/markdown;charset=utf-8" }), `${baseName}.md`);
      } else {
        downloadBlob(await makeZip(bundle.files), `${baseName}.zip`);
      }
    }
    exportDialog.close();
  } catch (error) {
    console.error("Export download failed", error);
    showExportResult(`ダウンロードに失敗しました: ${error.message || error}`, [], true);
  } finally {
    downloadExportBtn.disabled = false;
  }
}

function isPickerCancellation(error) {
  return error && error.name === "AbortError";
}

async function ensureDirectoryWritePermission(directoryHandle) {
  if (!directoryHandle.queryPermission || !directoryHandle.requestPermission) return true;
  const options = { mode: "readwrite" };
  if (await directoryHandle.queryPermission(options) === "granted") return true;
  return await directoryHandle.requestPermission(options) === "granted";
}

async function directoryEntryNames(directoryHandle) {
  const names = new Set();
  if (typeof directoryHandle.keys === "function") {
    for await (const name of directoryHandle.keys()) names.add(name.toLocaleLowerCase());
  }
  return names;
}

async function entryNameExists(directoryHandle, name) {
  const names = await directoryEntryNames(directoryHandle);
  if (names.size) return hasNameCollision(names, name);

  for (const getter of ["getDirectoryHandle", "getFileHandle"]) {
    try {
      await directoryHandle[getter](name);
      return true;
    } catch (error) {
      if (error.name !== "NotFoundError" && error.name !== "TypeMismatchError") throw error;
    }
  }
  return false;
}

async function availableFileName(directoryHandle, requestedName) {
  const usedNames = await directoryEntryNames(directoryHandle);
  if (usedNames.size) return uniqueFileName(requestedName, usedNames);
  if (!await entryNameExists(directoryHandle, requestedName)) return requestedName;

  const extensionIndex = requestedName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? requestedName.slice(0, extensionIndex) : requestedName;
  const extension = extensionIndex > 0 ? requestedName.slice(extensionIndex) : "";
  let suffix = 2;
  let candidate = `${baseName} (${suffix})${extension}`;
  while (await entryNameExists(directoryHandle, candidate)) {
    suffix += 1;
    candidate = `${baseName} (${suffix})${extension}`;
  }
  return candidate;
}

async function writeExportFile(directoryHandle, fileName, content) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function nestedDirectory(rootHandle, path) {
  let current = rootHandle;
  for (const name of path) current = await current.getDirectoryHandle(name, { create: true });
  return current;
}

async function chooseExportDirectory() {
  if (!pendingExport.directoryHandle) {
    pendingExport.directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  }
  const allowed = await ensureDirectoryWritePermission(pendingExport.directoryHandle);
  if (!allowed) throw new Error("保存先フォルダへの書き込み権限が許可されませんでした");
  return pendingExport.directoryHandle;
}

async function exportNoteToLocalDirectory() {
  const parentHandle = await chooseExportDirectory();
  await flushSave();
  const note = notes.find((item) => item.id === pendingExport.noteId);
  if (!note) throw new Error("メモが存在しません");
  const bundle = await buildSingleNoteExportBundle(note);
  const requestedName = `${sanitizeWindowsName(note.title, "無題のメモ")}.md`;
  if (!bundle.folderPath) {
    const fileName = await availableFileName(parentHandle, requestedName);
    await writeExportFile(parentHandle, fileName, note.body);
    showExportResult(`「${fileName}」を書き出しました。`);
    return;
  }

  const folderName = await availableFileName(parentHandle, bundle.folderPath);
  const rootHandle = await parentHandle.getDirectoryHandle(folderName, { create: true });
  for (const file of bundle.files) {
    const relativeParts = file.name.split("/").slice(1);
    const fileName = relativeParts.pop();
    const directoryHandle = await nestedDirectory(rootHandle, relativeParts);
    await writeExportFile(directoryHandle, fileName, file.content);
  }
  showExportResult(`「${folderName}」へ${bundle.files.length}件を書き出しました。`);
}

async function exportCollectionToLocalDirectory() {
  const collection = collections.find((item) => item.id === pendingExport.collectionId);
  if (!collection) throw new Error("コレクションが存在しません");
  const requestedName = exportLocalName.value;
  if (!requestedName.trim()) {
    showExportResult("ローカル保存名を入力してください。", [], true);
    exportLocalName.focus();
    return;
  }

  const localName = sanitizeWindowsName(requestedName, "無題のコレクション");
  exportLocalName.value = localName;
  const parentHandle = await chooseExportDirectory();
  if (await entryNameExists(parentHandle, localName)) {
    showExportResult(`「${localName}」というフォルダは既に存在します。\n別の保存名を指定してください。`, [], true);
    exportLocalName.focus();
    exportLocalName.select();
    return;
  }

  await flushSave();
  const plan = buildCollectionLocalPlan(collections, notes, collection.id);
  const exportFiles = await buildCollectionZipFiles(collection.id, { relativeToRoot: true });
  const rootHandle = await parentHandle.getDirectoryHandle(localName, { create: true });
  const directoryFailures = [];
  for (const path of plan.directories) {
    try {
      await nestedDirectory(rootHandle, path);
    } catch (error) {
      directoryFailures.push(`${path.join("/")}: ${error.message || error}`);
    }
  }

  let savedCount = 0;
  const fileFailures = [];
  for (const file of exportFiles) {
    const parts = file.name.split("/").filter(Boolean);
    const fileName = parts.pop();
    const relativeName = [...parts, fileName].join("/");
    try {
      const directoryHandle = await nestedDirectory(rootHandle, parts);
      await writeExportFile(directoryHandle, fileName, file.content);
      savedCount += 1;
    } catch (error) {
      fileFailures.push(`${relativeName}: ${error.message || error}`);
    }
  }

  const failures = [...directoryFailures, ...fileFailures];
  const resultLines = [`${exportFiles.length}件中${savedCount}件のファイルを書き出しました。`];
  if (fileFailures.length) resultLines.push(`${fileFailures.length}件のファイル保存に失敗しました。`);
  if (directoryFailures.length) resultLines.push(`${directoryFailures.length}件のフォルダ作成に失敗しました。`);
  const message = resultLines.join("\n");
  showExportResult(message, failures, failures.length > 0);
}

async function runLocalExport() {
  if (!pendingExport || !supportsDirectoryPicker()) return;
  localExportBtn.disabled = true;
  clearExportResult();
  try {
    if (pendingExport.type === "collection") await exportCollectionToLocalDirectory();
    else await exportNoteToLocalDirectory();
  } catch (error) {
    if (isPickerCancellation(error)) {
      showExportResult("フォルダの選択をキャンセルしました。");
      return;
    }
    console.error("Local export failed", error);
    showExportResult(`ローカル保存に失敗しました: ${error.message || error}`, [], true);
  } finally {
    localExportBtn.disabled = false;
  }
}

// ユーザー入力をHTMLへ混ぜる前に無害化します。
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// HTML属性値に入れる文字列を無害化します。
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function createSyntaxGuideCopyButton(item, statusElement = syntaxGuideStatus) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "syntax-guide-copy";
  button.textContent = "コピー";
  button.setAttribute("aria-label", `${item.name}の記法をコピー`);
  button.addEventListener("click", () => copySyntaxGuideItem(item, button, statusElement));
  return button;
}

function createMermaidTypeList() {
  const list = document.createElement("div");
  list.className = "mermaid-type-list";
  MERMAID_TEMPLATE_TYPES.forEach((templateType) => {
    const row = document.createElement("div");
    row.className = "mermaid-type-row";
    const name = document.createElement("span");
    name.textContent = templateType.name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-detail-button";
    button.textContent = "詳細";
    button.setAttribute("aria-label", `${templateType.name}のテンプレート詳細を開く`);
    button.setAttribute("aria-controls", "mermaidTemplateDialog");
    button.addEventListener("click", () => openMermaidTemplateDetails(templateType, button));
    row.append(name, button);
    list.append(row);
  });
  return list;
}

function renderMermaidTemplateDetails(templateType) {
  if (!mermaidTemplateBody || !mermaidTemplateTitle) return;
  mermaidTemplateTitle.textContent = `${templateType.name}のテンプレート`;
  mermaidTemplateBody.replaceChildren();
  const intro = document.createElement("p");
  intro.className = "mermaid-template-intro";
  intro.textContent = "完成したコードをコピーし、Memo Nexusの本文へそのまま貼り付けられます。";
  const items = document.createElement("div");
  items.className = "mermaid-template-items";
  MERMAID_TEMPLATE_ITEMS.filter((item) => item.type === templateType.type).forEach((item) => {
    items.append(createSyntaxGuideItem(item, mermaidTemplateStatus));
  });
  mermaidTemplateBody.append(intro, items);
}

function openMermaidTemplateDetails(templateType, trigger) {
  if (!mermaidTemplateDialog) return;
  mermaidTemplateTrigger = trigger;
  renderMermaidTemplateDetails(templateType);
  if (mermaidTemplateStatus) mermaidTemplateStatus.textContent = "";
  if (!mermaidTemplateDialog.open) mermaidTemplateDialog.showModal();
}

function closeMermaidTemplateDetails() {
  if (mermaidTemplateDialog?.open) mermaidTemplateDialog.close();
}

function createSyntaxGuideItem(item, statusElement = syntaxGuideStatus) {
  const article = document.createElement("article");
  article.className = "syntax-guide-item";

  const heading = document.createElement("div");
  heading.className = "syntax-guide-item-head";
  const name = document.createElement("h3");
  name.textContent = item.name;
  heading.append(name);
  if (item.copyable !== false) heading.append(createSyntaxGuideCopyButton(item, statusElement));

  const code = document.createElement("code");
  code.textContent = item.syntax;
  const pre = document.createElement("pre");
  pre.append(code);

  const description = document.createElement("p");
  description.textContent = item.description;
  const notes = document.createElement("p");
  notes.className = "syntax-guide-notes";
  notes.textContent = item.notes;
  article.append(heading, pre, description, notes);
  return article;
}

function renderSyntaxGuide() {
  if (!syntaxGuideBody || syntaxGuideRendered) return;
  const sectionDetails = [
    { category: "markdown", title: "Markdown", intro: "Memo Nexusのプレビューが現在対応している記法です。" },
    { category: "math", title: "数式", intro: "KaTeX記法を読みやすく表示します。数式の計算は行いません。" },
    { category: "calculation", title: "計算ブロック", intro: "Calculator Memoの現在のmainと同じ規則で、1つの独立した式を計算します。" },
    { category: "code", title: "コードブロック", intro: "バッククォート3個で囲んだ完成例です。" },
    { category: "table", title: "表ブロック", intro: "本文の任意位置へ、セルを直接編集できる構造化された表を挿入します。" },
    { category: "mermaid", title: "Mermaid", intro: "コードブロックの開始部分にmermaidと書くと図として表示します。" }
  ];

  sectionDetails.forEach(({ category, title, intro }) => {
    const section = document.createElement("section");
    section.className = `syntax-guide-section syntax-guide-${category}`;
    const heading = document.createElement("h2");
    heading.textContent = title;
    const lead = document.createElement("p");
    lead.className = "syntax-guide-lead";
    lead.textContent = intro;
    const items = category === "mermaid" ? createMermaidTypeList() : document.createElement("div");
    if (category !== "mermaid") {
      items.className = "syntax-guide-items";
      SYNTAX_GUIDE_ITEMS.filter((item) => item.category === category).forEach((item) => {
        items.append(createSyntaxGuideItem(item));
      });
    }
    section.append(heading, lead, items);

    if (category === "code") {
      const aliasHeading = document.createElement("h3");
      aliasHeading.className = "syntax-guide-alias-heading";
      aliasHeading.textContent = "言語の短縮名";
      const aliases = document.createElement("dl");
      aliases.className = "syntax-guide-aliases";
      Object.entries(HIGHLIGHT_LANGUAGE_ALIASES).forEach(([alias, language]) => {
        const term = document.createElement("dt");
        term.textContent = alias;
        const description = document.createElement("dd");
        description.textContent = language;
        aliases.append(term, description);
      });
      section.append(aliasHeading, aliases);
    }
    syntaxGuideBody.append(section);
  });
  syntaxGuideRendered = true;
}

function fallbackCopyText(text) {
  const previousActiveElement = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.className = "syntax-guide-copy-fallback";
  const copyContainer = mermaidTemplateDialog?.open
    ? mermaidTemplateDialog
    : (syntaxGuideDialog?.open ? syntaxGuideDialog : document.body);
  copyContainer.append(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (typeof textarea.setSelectionRange === "function") textarea.setSelectionRange(0, textarea.value.length);
    if (!document.execCommand("copy")) throw new Error("コピー操作が拒否されました");
  } finally {
    textarea.remove();
    if (previousActiveElement?.isConnected && typeof previousActiveElement.focus === "function") {
      try {
        previousActiveElement.focus({ preventScroll: true });
      } catch (error) {
        console.warn("Could not restore focus after fallback copy", error);
      }
    }
  }
}

async function writeSyntaxGuideText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn("Clipboard API failed; trying fallback", error);
    }
  }
  fallbackCopyText(text);
}

async function copySyntaxGuideItem(item, button, statusElement = syntaxGuideStatus) {
  const originalLabel = "コピー";
  const previousTimer = syntaxGuideCopyTimers.get(button);
  if (previousTimer) clearTimeout(previousTimer);
  if (statusElement) statusElement.textContent = "";
  try {
    await writeSyntaxGuideText(item.syntax);
    button.textContent = "コピーしました";
    const timer = setTimeout(() => {
      button.textContent = originalLabel;
      syntaxGuideCopyTimers.delete(button);
    }, 1800);
    syntaxGuideCopyTimers.set(button, timer);
  } catch (error) {
    console.error("Syntax guide copy failed", error);
    button.textContent = originalLabel;
    if (statusElement) statusElement.textContent = "コピーできませんでした。記法を選択してコピーしてください。";
  }
}

function openSyntaxGuide() {
  if (!syntaxGuideDialog || !syntaxGuideBtn) return;
  renderSyntaxGuide();
  if (syntaxGuideStatus) syntaxGuideStatus.textContent = "";
  syntaxGuideBtn.setAttribute("aria-expanded", "true");
  if (!syntaxGuideDialog.open) syntaxGuideDialog.showModal();
}

function closeSyntaxGuide() {
  if (syntaxGuideDialog?.open) syntaxGuideDialog.close();
}

function openCalculatorMemoFromSelection() {
  try {
    openCalculatorMemo(editor);
  } catch (error) {
    alert(error instanceof Error ? error.message : "Calculator Memoを開けませんでした");
  }
}

function insertCalloutAtSelection() {
  const type = calloutTypeSelect?.value || "NOTE";
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = buildCalloutMarkdown(editor.value.slice(start, end), type);
  captureUndoSnapshot();
  editor.setRangeText(value, start, end, "end");
  editor.focus();
  scheduleSave();
}

function openExplanationDialog(existing = null) {
  const note = currentNote();
  if (!note || !explanationDialog) return;
  if (existing) {
    pendingExplanation = { existing };
    explanationTypeSelect.value = existing.type || "補足";
    explanationBodyInput.value = existing.body || "";
    explanationTarget.textContent = `対象：${existing.target || "（対象箇所を確認してください）"}`;
  } else {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const target = editor.value.slice(start, end);
    if (!target.trim()) { alert("本文またはコードの解説したい範囲を選択してください。"); return; }
    pendingExplanation = { start, end, target, before: editor.value.slice(Math.max(0, start - 40), start), after: editor.value.slice(end, end + 40) };
    explanationTypeSelect.value = "用語解説";
    explanationBodyInput.value = "";
    explanationTarget.textContent = `対象：${target}`;
  }
  if (!explanationDialog.open) explanationDialog.showModal();
  explanationBodyInput.focus();
}

function saveExplanationFromDialog(event) {
  event.preventDefault();
  const note = currentNote();
  if (!note || !pendingExplanation || !explanationBodyInput.value.trim()) return;
  const explanations = normalizeExplanations(note);
  const base = pendingExplanation.existing || pendingExplanation;
  const explanation = {
    ...base,
    id: base.id || crypto.randomUUID(),
    type: explanationTypeSelect.value,
    body: explanationBodyInput.value.trim(),
    source: base.source || "manual",
    updatedAt: Date.now()
  };
  const index = explanations.findIndex((item) => item.id === explanation.id);
  if (index === -1) explanations.push(explanation); else explanations[index] = explanation;
  note.updatedAt = Date.now();
  void putNote(note).then(async () => { notes = await getAllNotes(); renderPreview(); });
  explanationDialog.close();
}

function deleteExplanation(id) {
  const note = currentNote();
  if (!note || !confirm("この解説カードを削除しますか？")) return;
  note.explanations = normalizeExplanations(note).filter((item) => item.id !== id);
  note.updatedAt = Date.now();
  void putNote(note).then(async () => { notes = await getAllNotes(); renderPreview(); });
}

// ここから下は、画面操作と処理を結びつけるイベント設定です。
newBtn.addEventListener("click", async () => {
  const note = await createNote("", "", { avoidDuplicateTitle: false });
  notes = await getAllNotes();
  renderAll();
  openNote(note.id);
});

if (collectionsBtn) collectionsBtn.addEventListener("click", () => setContextPanelTab("collection"));
if (contextCollectionTab) contextCollectionTab.addEventListener("click", () => setContextPanelTab("collection"));
if (contextAiTab) contextAiTab.addEventListener("click", () => {
  if (!aiAssistantState.panelOpen) openAiAssistant();
  else setContextPanelTab("ai");
});
if (contextMemoListTab) contextMemoListTab.addEventListener("click", () => setContextPanelTab("memo-list"));
if (closeContextPanelBtn) closeContextPanelBtn.addEventListener("click", () => setContextPanelOpen(false));
if (closeCollectionsBtn) closeCollectionsBtn.addEventListener("click", () => setContextPanelOpen(false));
if (collectionBackdrop) collectionBackdrop.addEventListener("click", () => toggleCollectionExplorer(false));
if (memoPaneBtn) memoPaneBtn.addEventListener("click", () => setMemoListPanelOpen(!(contextPanelOpen && contextPanelTab === "memo-list")));
if (closeMemoPaneBtn) closeMemoPaneBtn.addEventListener("click", () => setMemoListPanelOpen(false));
if (cardPaneBtn) cardPaneBtn.addEventListener("click", () => {
  const open = layoutMode === "compact" ? !compactCardVisible : !mobileCardOpen;
  setCardPaneOpen(open);
});
if (closeCardPaneBtn) closeCardPaneBtn.addEventListener("click", () => setCardPaneOpen(false));
if (layoutBackdrop) layoutBackdrop.addEventListener("click", () => closeLayoutOverlays());
if (addCollectionBtn) addCollectionBtn.addEventListener("click", () => createCollection().catch(showCollectionError));
if (collectionAddMenuBtn) {
  collectionAddMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const selectedCanContain = Boolean(defaultNewCollectionParent()) && collectionDepth(defaultNewCollectionParent()) < MAX_COLLECTION_DEPTH;
    collectionAddMenu.innerHTML = `<button type="button" data-place="root">ルートにコレクションを作成</button><button type="button" data-place="selected"${selectedCanContain ? "" : " disabled"}>選択中のコレクション内に作成</button>`;
    positionPopup(collectionAddMenu, event);
    collectionAddMenu.querySelector('[data-place="root"]').addEventListener("click", () => runMenuAction(() => createCollection(null)));
    collectionAddMenu.querySelector('[data-place="selected"]').addEventListener("click", () => runMenuAction(() => createCollection(defaultNewCollectionParent())));
  });
}
if (closeCollectionMoveBtn) closeCollectionMoveBtn.addEventListener("click", () => collectionMoveDialog.close());
if (cancelCollectionMoveBtn) cancelCollectionMoveBtn.addEventListener("click", () => collectionMoveDialog.close());
if (runCollectionMoveBtn) runCollectionMoveBtn.addEventListener("click", () => runPendingMove().catch(showCollectionError));
if (noteExportBtn) noteExportBtn.addEventListener("click", openNoteExportDialog);
if (closeExportBtn) closeExportBtn.addEventListener("click", () => exportDialog.close());
if (cancelExportBtn) cancelExportBtn.addEventListener("click", () => exportDialog.close());
if (downloadExportBtn) downloadExportBtn.addEventListener("click", runDownloadExport);
if (localExportBtn) localExportBtn.addEventListener("click", runLocalExport);
if (exportDialog) exportDialog.addEventListener("close", () => { pendingExport = null; });
if (addAttachmentBtn && attachmentInput) addAttachmentBtn.addEventListener("click", () => attachmentInput.click());
if (attachmentInput) attachmentInput.addEventListener("change", () => {
  handleAttachmentFiles(attachmentInput.files).finally(() => { attachmentInput.value = ""; });
});
if (imageBlockInput) imageBlockInput.addEventListener("change", () => {
  const [file] = imageBlockInput.files || [];
  const target = pendingImageBlockTarget;
  pendingImageBlockTarget = null;
  if (!file || !target) {
    imageBlockInput.value = "";
    return;
  }
  try {
    validatePendingImageBlock(target);
  } catch (error) {
    setAttachmentStatus(error.message || String(error), true);
    imageBlockInput.value = "";
    return;
  }
  handleAttachmentFiles([file], { imageBlockTarget: target }).finally(() => { imageBlockInput.value = ""; });
});
if (attachmentDropZone) {
  ["dragenter", "dragover"].forEach((type) => attachmentDropZone.addEventListener(type, (event) => {
    event.preventDefault();
    if (!attachmentDropZone.classList.contains("disabled")) attachmentDropZone.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach((type) => attachmentDropZone.addEventListener(type, (event) => {
    event.preventDefault();
    attachmentDropZone.classList.remove("drag-over");
  }));
  attachmentDropZone.addEventListener("drop", (event) => {
    if (!attachmentDropZone.classList.contains("disabled")) handleAttachmentFiles(event.dataTransfer.files);
  });
  attachmentDropZone.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !attachmentDropZone.classList.contains("disabled")) {
      event.preventDefault();
      attachmentInput.click();
    }
  });
}
if (closeImagePreviewBtn) closeImagePreviewBtn.addEventListener("click", () => imagePreviewDialog.close());
if (imagePreviewDialog) imagePreviewDialog.addEventListener("close", () => imagePreview.removeAttribute("src"));
if (syntaxGuideBtn && syntaxGuideDialog) syntaxGuideBtn.addEventListener("click", openSyntaxGuide);
if (insertTableBtn) insertTableBtn.addEventListener("click", insertTableAtSelection);
if (insertCalloutBtn) insertCalloutBtn.addEventListener("click", insertCalloutAtSelection);
if (addExplanationBtn) addExplanationBtn.addEventListener("click", () => openExplanationDialog());
if (explanationForm) explanationForm.addEventListener("submit", saveExplanationFromDialog);
if (closeExplanationDialogBtn) closeExplanationDialogBtn.addEventListener("click", () => explanationDialog.close());
if (cancelExplanationBtn) cancelExplanationBtn.addEventListener("click", () => explanationDialog.close());
if (explanationDialog) explanationDialog.addEventListener("close", () => { pendingExplanation = null; });
if (calculatorLinkBtn) calculatorLinkBtn.addEventListener("click", openCalculatorMemoFromSelection);
if (tableBlockEditors) {
  tableBlockEditors.addEventListener("input", handleTableEditorInput);
  tableBlockEditors.addEventListener("focusin", handleTableEditorFocus);
  tableBlockEditors.addEventListener("keydown", handleTableEditorKeydown);
  tableBlockEditors.addEventListener("click", handleTableAxisSelection);
  tableBlockEditors.addEventListener("click", handleTableEditorAction);
}
if (closeTableAxisDeleteBtn) closeTableAxisDeleteBtn.addEventListener("click", closeTableAxisDeleteDialog);
if (cancelTableAxisDeleteBtn) cancelTableAxisDeleteBtn.addEventListener("click", closeTableAxisDeleteDialog);
if (confirmTableAxisDeleteBtn) confirmTableAxisDeleteBtn.addEventListener("click", confirmTableAxisDeletion);
if (tableAxisDeleteDialog) tableAxisDeleteDialog.addEventListener("close", () => {
  const pending = pendingTableAxisDeletion;
  pendingTableAxisDeletion = null;
  if (pending?.restoreFocus && pending.trigger?.isConnected) pending.trigger.focus({ preventScroll: true });
});
if (closeTablePasteBtn) closeTablePasteBtn.addEventListener("click", () => closeTablePasteDialog());
if (cancelTablePasteBtn) cancelTablePasteBtn.addEventListener("click", () => closeTablePasteDialog());
if (confirmTablePasteBtn) confirmTablePasteBtn.addEventListener("click", insertPastedTable);
if (pasteTableAsTextBtn) pasteTableAsTextBtn.addEventListener("click", insertPastedPlainText);
if (tablePasteDialog) {
  tablePasteDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTablePasteDialog();
  });
  tablePasteDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target.closest("button") || confirmTablePasteBtn.hidden) return;
    event.preventDefault();
    insertPastedTable();
  });
  tablePasteDialog.addEventListener("close", () => {
    if (!pendingTablePaste) return;
    const pending = pendingTablePaste;
    pendingTablePaste = null;
    requestAnimationFrame(() => restoreTablePasteEditorContext(pending));
  });
}
if (closeSyntaxGuideBtn && syntaxGuideDialog) closeSyntaxGuideBtn.addEventListener("click", closeSyntaxGuide);
if (closeMermaidTemplateBtn && mermaidTemplateDialog) closeMermaidTemplateBtn.addEventListener("click", closeMermaidTemplateDetails);
if (mermaidTemplateDialog) mermaidTemplateDialog.addEventListener("close", () => {
  if (mermaidTemplateStatus) mermaidTemplateStatus.textContent = "";
  const trigger = mermaidTemplateTrigger;
  mermaidTemplateTrigger = null;
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
});
if (syntaxGuideDialog) syntaxGuideDialog.addEventListener("close", () => {
  if (syntaxGuideBtn) syntaxGuideBtn.setAttribute("aria-expanded", "false");
});

todayBtn.addEventListener("click", async () => {
  notes = await getAllNotes();
  const note = getTodayNote() || await createNote(todayTitle(), `# ${todayTitle()}\n\n`);
  openNote(note.id);
});

backupBtn.addEventListener("click", downloadMarkdownZip);
if (undoBtn) {
  undoBtn.addEventListener("click", undoLastEdit);
}
settingsBtn.addEventListener("click", () => {
  openSettingsDialog().catch((error) => {
    console.error("Settings dialog failed", error);
    alert(`設定を開けませんでした: ${error.message}`);
  });
});
closeSettingsBtn.addEventListener("click", () => {
  aiSettingsSessionId += 1;
  aiConnectionRequestId += 1;
  aiConnectionAbortController?.abort();
  aiConnectionAbortController = null;
  settingsDialog.close();
});
if (themeSelect) {
  themeSelect.addEventListener("change", () => saveTheme(themeSelect.value));
}
if (imageBlockSizeSelect) {
  imageBlockSizeSelect.addEventListener("change", () => saveImageBlockSize(imageBlockSizeSelect.value));
}
if (logoAnimationSelect) {
  logoAnimationSelect.addEventListener("change", () => saveLogoAnimationSetting(logoAnimationSelect.value));
}
if (memoNexusLogo) {
  memoNexusLogo.addEventListener("click", cycleLogoAnimation);
  memoNexusLogo.addEventListener("animationend", (event) => {
    if (event.target === memoNexusLogo && event.animationName === "memo-nexus-logo-cycle") finishLogoAnimation();
  });
}
[
  globalTitleFontSelect,
  globalTitleFontSizeSelect,
  globalBodyFontSelect,
  globalBodyFontSizeSelect,
  globalHeadingFontSelect,
  globalCodeFontSelect,
  globalCodeFontSizeSelect,
  noteTitleFontSelect,
  noteTitleFontSizeSelect,
  noteBodyFontSelect,
  noteBodyFontSizeSelect,
  noteHeadingFontSelect,
  noteCodeFontSelect,
  noteCodeFontSizeSelect
].forEach((select) => select?.addEventListener("change", updateFontSettingsPreview));
if (noteFontOverrideEnabled) {
  noteFontOverrideEnabled.addEventListener("change", () => {
    noteFontSettingsGroup.disabled = !noteFontOverrideEnabled.checked;
    updateFontSettingsPreview();
  });
}
fontCompareButtons.forEach((button) => button.addEventListener("click", openFontComparison));
if (useReceivedFontBtn) useReceivedFontBtn.addEventListener("click", applyPendingFontSelectionToDraft);
if (cancelReceivedFontBtn) cancelReceivedFontBtn.addEventListener("click", discardPendingFontSelection);
if (saveFontSettingsBtn) {
  saveFontSettingsBtn.addEventListener("click", () => {
    saveFontSettings().catch((error) => {
      console.error("Font settings save failed", error);
      fontSettingsStatus.textContent = `フォント設定を保存できませんでした: ${error.message || error}`;
    });
  });
}
if (resetFontSettingsBtn) {
  resetFontSettingsBtn.addEventListener("click", () => {
    resetFontSettings().catch((error) => {
      console.error("Font settings reset failed", error);
      fontSettingsStatus.textContent = `フォント設定を初期化できませんでした: ${error.message || error}`;
    });
  });
}
if (aiRobotBtn) aiRobotBtn.addEventListener("click", () => {
  if (aiAssistantState.panelOpen) setAiPanelOpen(false);
  else if (!contextPanelOpen && contextPanelTab === "ai") openAiAssistant({ resume: true });
  else openAiAssistant();
});
if (closeAiPanelBtn) closeAiPanelBtn.addEventListener("click", () => setAiPanelOpen(false));
if (aiBackdrop) aiBackdrop.addEventListener("click", () => setAiPanelOpen(false));
if (aiEnabledInput) aiEnabledInput.addEventListener("change", () => {
  aiSettingsDraft = { ...readAiSettingsForm(), enabled: aiEnabledInput.checked };
});
if (aiProviderSelect) aiProviderSelect.addEventListener("change", () => {
  if (aiAssistantState.generation === AI_GENERATION_STATES.STREAMING) {
    aiProviderSelect.value = aiSettingsDraft.provider;
    return;
  }
  aiSettingsDraft = withAiProviderSettings(aiSettingsDraft, aiProviderSelect.value);
  aiModels = [];
  aiModelsEndpoint = "";
  aiVerifiedModelId = "";
  aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
  aiDraftConnectionMessage = "";
  renderAiSettings();
});
if (aiBaseUrlInput) aiBaseUrlInput.addEventListener("input", () => {
  aiExternalUrlWarning.hidden = isLoopbackBaseUrl(aiBaseUrlInput.value);
  aiSettingsDraft = readAiSettingsForm();
});
if (aiGeminiApiKeyInput) aiGeminiApiKeyInput.addEventListener("input", () => {
  aiSettingsDraft = readAiSettingsForm();
  aiConnectionRequestId += 1;
  aiConnectionAbortController?.abort();
  aiConnectionAbortController = null;
  aiModelsEndpoint = "";
  aiVerifiedModelId = "";
  aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
  aiDraftConnectionMessage = "APIキーを変更しました。接続確認を行ってください。";
  renderAiSettings();
});
if (aiModelSelect) aiModelSelect.addEventListener("change", () => {
  aiSettingsDraft = readAiSettingsForm();
  if (aiSettingsDraft.provider === "gemini") {
    aiVerifiedModelId = "";
    aiDraftConnection = AI_CONNECTION_STATES.UNCHECKED;
    aiDraftConnectionMessage = "モデルを変更しました。選択モデルで接続確認を行ってください。";
    renderAiSettings();
  }
});
if (aiTimeoutInput) aiTimeoutInput.addEventListener("input", () => {
  aiSettingsDraft = readAiSettingsForm();
});
if (aiSystemInstructionInput) aiSystemInstructionInput.addEventListener("input", () => {
  aiSettingsDraft = readAiSettingsForm();
});
if (aiCheckConnectionBtn) aiCheckConnectionBtn.addEventListener("click", () => checkAiConnection());
if (aiRefreshModelsBtn) aiRefreshModelsBtn.addEventListener("click", () => checkAiConnection());
if (aiSaveSettingsBtn) aiSaveSettingsBtn.addEventListener("click", saveAiSettings);
if (aiPurposeSelect) aiPurposeSelect.addEventListener("change", renderAiUi);
if (aiTargetSelect) aiTargetSelect.addEventListener("change", () => setAiReferenceMode(aiTargetSelect.value));
if (aiClearReferenceBtn) aiClearReferenceBtn.addEventListener("click", () => setAiReferenceMode(AI_REFERENCE_MODES.NONE));
if (aiSpecifiedNoteSearch) aiSpecifiedNoteSearch.addEventListener("input", renderAiSpecifiedNoteList);
if (aiCollectionSearch) aiCollectionSearch.addEventListener("input", renderAiCollectionList);
if (aiSummarizeNoteBtn) aiSummarizeNoteBtn.addEventListener("click", () => {
  openAiAssistant({ mode: AI_REFERENCE_MODES.CURRENT_NOTE, purpose: "summarize", prompt: "このメモを要約してください。" });
});
if (aiSendSelectionBtn) aiSendSelectionBtn.addEventListener("click", () => {
  openAiAssistant({ mode: AI_REFERENCE_MODES.SELECTED_TEXT, purpose: "question", prompt: "選択した文章について" });
});
if (aiSendBtn) aiSendBtn.addEventListener("click", () => {
  startAiGeneration().catch((error) => {
    console.error("AI generation failed", error);
    aiAssistantState.error = "メモの保存またはAI生成を開始できませんでした。";
    aiAssistantState.generation = AI_GENERATION_STATES.ERROR;
    renderAiUi();
  });
});
if (aiStopBtn) aiStopBtn.addEventListener("click", stopAiGeneration);
if (aiCopyBtn) aiCopyBtn.addEventListener("click", copyAiAnswer);
if (aiAppendBtn) aiAppendBtn.addEventListener("click", () => appendAiAnswerToCurrentNote());
if (aiSaveNewBtn) aiSaveNewBtn.addEventListener("click", () => {
  saveAiAnswerAsNewNote().catch((error) => {
    console.error("AI answer note save failed", error);
    aiGenerationStatus.textContent = "AI回答を新規メモとして保存できませんでした。";
  });
});
if (collectionSortSelect) {
  collectionSortSelect.addEventListener("change", () => saveCollectionSortOrder(collectionSortSelect.value));
}
if (deleteBtn) {
  deleteBtn.addEventListener("click", deleteCurrentNote);
}
if (popoutMemoBtn) popoutMemoBtn.addEventListener("click", openMemoPopout);
if (popoutBackBtn) popoutBackBtn.addEventListener("click", returnFromPopout);
if (popoutUnavailableBackBtn) popoutUnavailableBackBtn.addEventListener("click", returnFromPopout);
if (loadMemoSyncBtn) loadMemoSyncBtn.addEventListener("click", loadPendingMemoSync);
if (settingsImportAiBtn && importAiInput) {
  settingsImportAiBtn.addEventListener("click", () => importAiInput.click());
  importAiInput.addEventListener("change", async () => {
    const [file] = importAiInput.files || [];
    if (!file) return;

    try {
      await importAiNewsFile(file);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    } finally {
      importAiInput.value = "";
    }
  });
}
if (settingsPasteJsonBtn && jsonImportDialog) {
  settingsPasteJsonBtn.addEventListener("click", () => {
    settingsDialog.close();
    openJsonImportDialog();
  });
  closeJsonImportBtn.addEventListener("click", closeJsonImportDialog);
  cancelJsonImportBtn.addEventListener("click", closeJsonImportDialog);
  runJsonImportBtn.addEventListener("click", importPastedItNewsJson);
}
if (settingsBackupBtn) {
  settingsBackupBtn.addEventListener("click", downloadMarkdownZip);
}
if (reloadAppBtn) {
  reloadAppBtn.addEventListener("click", () => location.reload());
}

linkStatsBtn.addEventListener("click", () => toggleLinkStats());

graphBtn.addEventListener("click", () => {
  graphDialog.showModal();
  drawGraph();
});

closeGraphBtn.addEventListener("click", () => graphDialog.close());
relatedToggleBtn.addEventListener("click", () => setRelatedDrawerOpen(!isRelatedDrawerOpen()));
closeRelatedPanelBtn.addEventListener("click", () => setRelatedDrawerOpen(false));
relatedBackdrop.addEventListener("click", () => setRelatedDrawerOpen(false));
searchInput.addEventListener("input", renderList);
titleInput.addEventListener("beforeinput", captureUndoSnapshot);
editor.addEventListener("beforeinput", captureUndoSnapshot);
editor.addEventListener("paste", handleEditorPaste);
editor.addEventListener("dragover", (event) => {
  if (editorDropHasFiles(event)) event.preventDefault();
});
editor.addEventListener("drop", handleEditorAttachmentDrop);
titleInput.addEventListener("input", scheduleSave);
editor.addEventListener("input", () => {
  renderTableBlockEditors();
  scheduleSave();
  updateAiTargetPreview();
});
editor.addEventListener("select", updateAiTargetPreview);
window.addEventListener("resize", () => {
  if (!isPopoutWindow) {
    syncLayoutMode();
    renderSaveStatus();
  }
  savePopoutWindowOptions();
});
window.addEventListener("beforeunload", () => {
  savePopoutWindowOptions();
  memoSyncChannel?.close();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".collection-popup-menu,.collection-more,.collection-memo-more,#collectionAddMenuBtn")) closeCollectionMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("dialog[open]") && closeLayoutOverlays()) {
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && aiAssistantState.panelOpen && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    setAiPanelOpen(false);
    return;
  }
  if (event.key === "Escape" && isRelatedDrawerOpen() && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    setRelatedDrawerOpen(false);
    return;
  }
  if (event.key === "Escape" && contextPanelOpen && contextPanelTab === "collection" && !collectionMoveDialog.open) {
    setContextPanelOpen(false);
    return;
  }
  if (!collectionTree.contains(document.activeElement)) return;
  const visible = getVisibleMemoIds(false);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    visible.forEach((id) => selectedMemoIds.add(id));
    renderCollectionExplorer();
  } else if (event.key === "Delete" && selectedMemoIds.size) {
    event.preventDefault();
    moveMemosToTrash([...selectedMemoIds]).catch(showCollectionError);
  }
});
window.addEventListener("pagehide", () => {
  stopAiGeneration();
  cleanupAttachmentObjectUrls();
  saveCurrentDraftMirror();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveCurrentNote().catch((error) => console.error("Page hide save failed", error));
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveCurrentDraftMirror();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveCurrentNote().catch((error) => console.error("Hidden page save failed", error));
    }
  }
});
