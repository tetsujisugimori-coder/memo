// IndexedDBで使うデータベース名・保存箱名・バージョン。
// バージョンを上げると、あとで保存形式の変更処理を追加できます。
const DB_NAME = "memo-nexus";
const STORE_NAME = "notes";
const DB_VERSION = 1;

// HTML要素を短く取得するための小さなヘルパー。
const $ = (id) => document.getElementById(id);

// 画面上のボタンや入力欄をJavaScriptから操作できるように取得します。
const newBtn = $("newBtn");
const todayBtn = $("todayBtn");
const backupBtn = $("backupBtn");
const graphBtn = $("graphBtn");
const closeGraphBtn = $("closeGraphBtn");
const searchInput = $("searchInput");
const levelPanel = $("levelPanel");
const memoList = $("memoList");
const titleInput = $("titleInput");
const editor = $("editor");
const preview = $("preview");
const saveStatus = $("saveStatus");
const relatedList = $("relatedList");
const discoveryPanel = $("discoveryPanel");
const graphDialog = $("graphDialog");
const graphCanvas = $("graphCanvas");

// アプリ全体で共有する状態。
// notesはIndexedDBから読み込んだメモ一覧のメモリ上コピーです。
let db;
let notes = [];
let currentId = null;
let saveTimer = null;
let lastDiscovery = "";

// ページ読み込み後、すぐにアプリを起動します。
init();

// 起動処理。DBを開き、初期メモを用意し、今日メモを開いて即入力できる状態にします。
async function init() {
  db = await openDb();
  notes = await getAllNotes();
  await ensureStartupNotes();
  renderAll();
  openNote(getTodayNote().id);
  titleInput.focus();
  titleInput.select();
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
    const request = tx("readwrite").put(note);
    request.onsuccess = () => resolve(note);
    request.onerror = () => reject(request.error);
  });
}

// 起動時に最低限の「新規メモ」と「今日メモ」がある状態を保証します。
async function ensureStartupNotes() {
  if (!notes.length) {
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
  return notes.find((note) => note.title === title);
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
async function createNote(title = "新規メモ", body = "") {
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: uniqueTitle(title),
    body,
    createdAt: now,
    updatedAt: now
  };

  await putNote(note);
  notes.unshift(note);
  return note;
}

// 同名タイトルがあるとリンク先が曖昧になるので、末尾に番号を付けて重複を避けます。
function uniqueTitle(base) {
  const clean = base.trim() || "無題メモ";
  const titles = new Set(notes.map((note) => note.title));
  if (!titles.has(clean)) return clean;

  let index = 2;
  while (titles.has(`${clean} ${index}`)) index += 1;
  return `${clean} ${index}`;
}

// 画面全体の再描画をまとめて呼ぶ入口です。
function renderAll() {
  renderLevel();
  renderList();
  renderRelated();
  renderDiscovery();
}

// RPG風の知識レベル欄を更新します。
function renderLevel() {
  const historyCount = notes.filter((note) => hasHistorySignal(note)).length;
  const links = collectLinks(notes);
  const connected = new Set(links.flatMap((link) => [link.from, link.to]));

  levelPanel.innerHTML = `
    <strong>知識レベル</strong>
    歴史: ${historyCount}ノート<br>
    接続: ${links.length}リンク<br>
    発見済み: ${connected.size}項目
  `;
}

// 歴史っぽい語句を含むメモ数をざっくり数えるための判定です。
function hasHistorySignal(note) {
  return /歴史|時代|幕府|天皇|戦国|鎌倉|室町|江戸|明治|太平記|足利|源氏|平氏/.test(`${note.title}\n${note.body}`);
}

// 左側のメモ一覧を描画します。検索欄に入力があればタイトル・本文から絞り込みます。
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = notes.filter((note) => {
    const haystack = `${note.title}\n${note.body}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  memoList.innerHTML = "";

  filtered.forEach((note) => {
    const item = document.createElement("div");
    item.className = `memo-item${note.id === currentId ? " active" : ""}`;
    item.innerHTML = `
      <div class="memo-title">${escapeHtml(note.title)}</div>
      <div class="memo-snippet">${escapeHtml(snippet(note.body))}</div>
    `;
    item.addEventListener("click", () => openNote(note.id));
    memoList.appendChild(item);
  });
}

// メモ一覧カードに出す短い本文プレビューを作ります。
function snippet(body) {
  const text = body.replace(/\[\[|\]\]|#/g, "").trim();
  return text || "空のカード";
}

// 指定したidのメモをエディタに読み込みます。
function openNote(id) {
  const note = notes.find((item) => item.id === id);
  if (!note) return;

  currentId = note.id;
  titleInput.value = note.title;
  editor.value = note.body;
  saveStatus.textContent = "保存済み";
  renderList();
  renderPreview();
  renderRelated();
  renderDiscovery();
  editor.focus();
}

// 今開いているメモ本体をnotes配列から取り出します。
function currentNote() {
  return notes.find((note) => note.id === currentId);
}

// 入力のたびに即保存すると重いので、少し待ってから保存する予約をします。
function scheduleSave() {
  clearTimeout(saveTimer);
  saveStatus.textContent = "保存中...";
  saveTimer = setTimeout(saveCurrentNote, 280);
  renderPreview();
  renderRelated();
  renderLevel();
}

// タイトルと本文を現在のメモへ反映し、IndexedDBへ保存します。
async function saveCurrentNote() {
  const note = currentNote();
  if (!note) return;

  const beforeLinks = collectLinks(notes).length;
  note.body = editor.value;
  note.title = titleInput.value.trim() || titleFromBody(note.body) || "無題メモ";
  note.updatedAt = Date.now();

  await putNote(note);
  notes = await getAllNotes();
  currentId = note.id;

  const afterLinks = collectLinks(notes).length;
  if (afterLinks > beforeLinks) {
    lastDiscovery = buildDiscoveryMessage(note);
  }

  titleInput.value = note.title;
  saveStatus.textContent = "保存済み";
  renderAll();
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
  const note = currentNote();
  if (!note) {
    preview.innerHTML = "";
    return;
  }

  const paragraphs = note.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  preview.innerHTML = paragraphs.length
    ? paragraphs.map((part) => `<p>${renderRichText(part)}</p>`).join("")
    : `<p class="empty">本文を書くとカード表示されます。</p>`;

  preview.querySelectorAll(".wiki-link").forEach((button) => {
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
function renderWikiButton(rawTitle) {
    const title = rawTitle.trim();
    const exists = notes.some((note) => note.title === title);
    const className = exists ? "wiki-link" : "wiki-link missing";
    return `<button class="${className}" data-title="${escapeAttr(title)}">${escapeHtml(title)}</button>`;
}

// Wikiリンクをクリックしたとき、既存メモがあれば開き、なければ新規作成します。
async function openOrCreateLinkedNote(title) {
  const existing = notes.find((note) => note.title === title);
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

// 右側の関連メモ一覧を描画します。
function renderRelated() {
  const note = currentNote();
  relatedList.innerHTML = "";

  if (!note) return;

  const related = findRelated(note).slice(0, 8);
  if (!related.length) {
    relatedList.innerHTML = `<div class="empty">[[名前]]でつなぐと、ここに関連メモが出ます。</div>`;
    return;
  }

  related.forEach(({ note: item, reason }) => {
    const div = document.createElement("div");
    div.className = "related-item";
    div.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(reason)}</span>`;
    div.addEventListener("click", () => openNote(item.id));
    relatedList.appendChild(div);
  });
}

// 関連メモをスコア計算します。直接リンク、逆リンク、共通リンク、共通語句を見ています。
function findRelated(source) {
  const sourceLinks = new Set(extractLinks(source.body));
  const sourceWords = new Set(tokenize(`${source.title} ${source.body}`));

  return notes
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
  await saveCurrentNote();
  const files = notes.map((note) => ({
    name: `${safeFileName(note.title)}.md`,
    content: `# ${note.title}\n\n${note.body}\n`
  }));
  const blob = makeZip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `memo-nexus-${todayStamp()}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

// 追加ライブラリなしでZIPを作る処理です。各Markdownを無圧縮のZIPエントリにします。
function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    ]);
    const central = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  ]);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
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

  const links = collectLinks(notes);
  const names = [...new Set([...notes.map((note) => note.title), ...links.map((link) => link.to)])];
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
    const exists = notes.some((note) => note.title === name);
    context.beginPath();
    context.fillStyle = exists ? "#236c73" : "#a66b1f";
    context.arc(point.x, point.y, exists ? 8 : 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#222522";
    context.font = "14px sans-serif";
    context.fillText(name, point.x + 10, point.y + 5);
  });
}

// Markdownファイル名として危ない文字を置き換えます。
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "untitled";
}

// バックアップZIP名に使う日付文字列を作ります。
function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
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

// ここから下は、画面操作と処理を結びつけるイベント設定です。
newBtn.addEventListener("click", async () => {
  const note = await createNote("新規メモ", "");
  notes = await getAllNotes();
  renderAll();
  openNote(note.id);
});

todayBtn.addEventListener("click", async () => {
  notes = await getAllNotes();
  const note = getTodayNote() || await createNote(todayTitle(), `# ${todayTitle()}\n\n`);
  openNote(note.id);
});

backupBtn.addEventListener("click", downloadMarkdownZip);

graphBtn.addEventListener("click", () => {
  graphDialog.showModal();
  drawGraph();
});

closeGraphBtn.addEventListener("click", () => graphDialog.close());
searchInput.addEventListener("input", renderList);
titleInput.addEventListener("input", scheduleSave);
editor.addEventListener("input", scheduleSave);
