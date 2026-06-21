// IndexedDBで使うデータベース名・保存箱名・バージョン。
// バージョンを上げると、あとで保存形式の変更処理を追加できます。
const DB_NAME = "memo-nexus";
const STORE_NAME = "notes";
const DB_VERSION = 1;
const DRAFT_STORAGE_KEY = "memo-nexus-current-draft";
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// HTML要素を短く取得するための小さなヘルパー。
const $ = (id) => document.getElementById(id);

// 画面上のボタンや入力欄をJavaScriptから操作できるように取得します。
const newBtn = $("newBtn");
const todayBtn = $("todayBtn");
const backupBtn = $("backupBtn");
const graphBtn = $("graphBtn");
const linkStatsBtn = $("linkStatsBtn");
const deleteBtn = $("deleteBtn");
const importAiBtn = $("importAiBtn");
const importAiInput = $("importAiInput");
const pasteJsonBtn = $("pasteJsonBtn");
const jsonImportDialog = $("jsonImportDialog");
const closeJsonImportBtn = $("closeJsonImportBtn");
const cancelJsonImportBtn = $("cancelJsonImportBtn");
const runJsonImportBtn = $("runJsonImportBtn");
const jsonImportText = $("jsonImportText");
const jsonImportError = $("jsonImportError");
const closeGraphBtn = $("closeGraphBtn");
const searchInput = $("searchInput");
const levelPanel = $("levelPanel");
const memoList = $("memoList");
const titleInput = $("titleInput");
const noteMeta = $("noteMeta");
const editor = $("editor");
const preview = $("preview");
const saveStatus = $("saveStatus");
const relatedList = $("relatedList");
const discoveryPanel = $("discoveryPanel");
const linkStatsPanel = $("linkStatsPanel");
const graphDialog = $("graphDialog");
const graphCanvas = $("graphCanvas");

// アプリ全体で共有する状態。
// notesはIndexedDBから読み込んだメモ一覧のメモリ上コピーです。
let db;
let notes = [];
let currentId = null;
let saveTimer = null;
let lastDiscovery = "";
let linkStatsVisible = false;
let saveStatusState = "saved";
let saveStatusTime = null;

// ページ読み込み後、すぐにアプリを起動します。
init();

// 起動処理。DBを開き、初期メモを用意し、今日メモを開いて即入力できる状態にします。
async function init() {
  db = await openDb();
  notes = await getAllNotes();
  console.log("IndexedDB notes count", notes.length);
  const restoredDraftId = await restoreCurrentDraftMirror();
  if (restoredDraftId) {
    notes = await getAllNotes();
  }
  await ensureStartupNotes();
  renderAll();
  const restoredNote = restoredDraftId && notes.find((note) => note.id === restoredDraftId);
  openNote(restoredNote ? restoredNote.id : getTodayNote().id);
  if (restoredNote) {
    saveStatus.textContent = "前回の編集中メモを復元しました";
  }
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
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(note);
    transaction.oncomplete = () => resolve(note);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
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
    built = buildItNewsNotes(parseItNewsJson(text));
  } catch (error) {
    showJsonImportError(error.message);
    return;
  }

  try {
    await saveCurrentNote();
    const createdItems = [];
    for (const item of built.items) {
      createdItems.push(await createNote(item.title, item.body));
    }
    const parentNote = await createNote(built.parent.title, built.parent.body);
    notes = await getAllNotes();
    renderAll();
    openNote(parentNote.id);
    closeJsonImportDialog();
    saveStatus.textContent = `${createdItems.length}件のニュースメモを作成しました`;
  } catch (error) {
    showJsonImportError(`保存に失敗しました: ${error.message}`);
  }
}

function parseItNewsJson(text) {
  try {
    const payload = JSON.parse(text);
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
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`JSONの解析に失敗しました: ${error.message}`);
    }
    throw error;
  }
}

function buildItNewsNotes(payload) {
  const date = String(payload.date || todayStampDashed()).trim();
  const parentTitle = `IT技術ニュース ${date}`;
  const items = payload.items.map(normalizeItNewsItem);
  const missingTitleIndex = items.findIndex((item) => !item.title);
  if (missingTitleIndex >= 0) {
    throw new Error(`items[${missingTitleIndex}] の title が空です。`);
  }

  return {
    parent: {
      title: parentTitle,
      body: buildItNewsParentBody(parentTitle, payload.trend_summary || payload.trendSummary || "", items)
    },
    items: items.map((item) => ({
      title: item.title,
      body: buildItNewsItemBody(item, date)
    }))
  };
}

function normalizeItNewsItem(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    title: String(source.title || "").trim(),
    category: String(source.category || "").trim(),
    summary: String(source.summary || "").trim(),
    impact: String(source.impact || "").trim(),
    urgency: String(source.urgency || "").trim(),
    source: String(source.source || "").trim()
  };
}

function buildItNewsItemBody(item, date) {
  return [
    `# ${item.title}`,
    "",
    `日付: ${date}`,
    `カテゴリ: ${item.category}`,
    `緊急度: ${item.urgency}`,
    `タグ: #ITニュース ${categoryTag(item.category)}`,
    "",
    "## 要約",
    item.summary,
    "",
    "## 実務への影響",
    item.impact,
    "",
    "## 情報源",
    item.source
  ].join("\n").trim();
}

function buildItNewsParentBody(title, trendSummary, items) {
  return [
    `# ${title}`,
    "",
    "## 全体傾向",
    String(trendSummary || "").trim(),
    "",
    "## 個別ニュース",
    ...items.map((item) => `- ${item.title}`)
  ].join("\n").trim();
}

function categoryTag(category) {
  const clean = String(category || "").replace(/\s+/g, "");
  return clean ? `#${clean}` : "#未分類";
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
    bodyUpdatedAt: now,
    updatedAt: now
  };

  await putNote(note);
  notes.unshift(note);
  return note;
}

// 同名タイトルがあるとリンク先が曖昧になるので、末尾に番号を付けて重複を避けます。
function uniqueTitle(base) {
  const clean = base || "無題メモ";
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
  renderNoteMeta();
  renderRelated();
  renderDiscovery();
  renderLinkStats();
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
  setSaveStatus("saved", note.updatedAt);
  renderNoteMeta();
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
  saveCurrentDraftMirror();
  clearTimeout(saveTimer);
  setSaveStatus("editing");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCurrentNote().catch((error) => console.error("Scheduled save failed", error));
  }, 280);
  renderPreview();
  renderRelated();
  renderLevel();
}

// 遅延保存の予約を解除し、現在の入力内容をすぐに保存します。
async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await saveCurrentNote();
}

// タイトルと本文を現在のメモへ反映し、IndexedDBへ保存します。
async function saveCurrentNote() {
  const note = currentNote();
  if (!note) return;

  setSaveStatus("saving");
  const beforeLinks = collectLinks(notes).length;
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
    currentId = note.id;

    const afterLinks = collectLinks(notes).length;
    if (afterLinks > beforeLinks) {
      lastDiscovery = buildDiscoveryMessage(note);
    }

    titleInput.value = note.title;
    setSaveStatus("saved", note.updatedAt);
    renderAll();
  } catch (error) {
    setSaveStatus("error");
    throw error;
  }
}

async function deleteCurrentNote() {
  const note = currentNote();
  if (!note) return;

  const confirmed = confirm(`「${note.title}」を削除しますか？\nこの操作は元に戻せません。`);
  if (!confirmed) return;

  clearTimeout(saveTimer);
  saveTimer = null;
  const currentIndex = notes.findIndex((item) => item.id === note.id);
  saveStatus.textContent = "削除中...";

  await deleteNote(note.id);
  removeDraftMirrorForNote(note.id);
  notes = await getAllNotes();

  if (!notes.length) {
    const nextNote = await createNote("新規メモ", "");
    notes = await getAllNotes();
    renderAll();
    openNote(nextNote.id);
    return;
  }

  const nextNote = notes[Math.min(currentIndex, notes.length - 1)] || notes[0];
  renderAll();
  openNote(nextNote.id);
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
    renderLinkList();
    renderLinkStats();
    return;
  }

  const body = (note.id === currentId ? editor.value : note.body);
  const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  preview.innerHTML = paragraphs.length
    ? paragraphs.map((part) => `<p>${renderRichText(part)}</p>`).join("")
    : `<p class="empty">本文を書くとカード表示されます。</p>`;

  preview.querySelectorAll(".wiki-link").forEach((button) => {
    button.addEventListener("click", () => openOrCreateLinkedNote(button.dataset.title));
  });
  renderLinkList();
  renderLinkStats();
}

function countPhraseOccurrences(text, phrase) {
  if (!phrase) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = text.indexOf(phrase, index);
    if (index === -1) break;
    count += 1;
    index += phrase.length;
  }
  return count;
}

function collectLinkStats() {
  const current = currentNote();
  const effectiveNotes = notes.map((note) => {
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
      const count = countPhraseOccurrences(note.body, title);
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
  const links = [...new Set(extractLinks(body))];
  linkList.innerHTML = links.length
    ? `
      <div class="link-list-header">[[語句一覧]]</div>
      <div class="link-chip-list">
        ${links.map((title) => `<button class="link-chip" data-title="${escapeAttr(title)}">${escapeHtml(title)}</button>`).join("")}
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
  await flushSave();
  const files = uniqueZipFileNames(notes.map((note) => ({
    name: `${safeFileName(note.title)}.md`,
    content: `# ${note.title}\n\n${note.body}\n`,
    updatedAt: note.bodyUpdatedAt || note.updatedAt || note.createdAt || Date.now()
  })));
  console.log("ZIP backup", {
    fileCount: files.length,
    fileNames: files.map((file) => file.name)
  });
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
  return window.matchMedia("(max-width: 980px)").matches;
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
if (deleteBtn) {
  deleteBtn.addEventListener("click", deleteCurrentNote);
}
if (importAiBtn && importAiInput) {
  importAiBtn.addEventListener("click", () => importAiInput.click());
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
if (pasteJsonBtn && jsonImportDialog) {
  pasteJsonBtn.addEventListener("click", openJsonImportDialog);
  closeJsonImportBtn.addEventListener("click", closeJsonImportDialog);
  cancelJsonImportBtn.addEventListener("click", closeJsonImportDialog);
  runJsonImportBtn.addEventListener("click", importPastedItNewsJson);
}

linkStatsBtn.addEventListener("click", () => toggleLinkStats());

graphBtn.addEventListener("click", () => {
  graphDialog.showModal();
  drawGraph();
});

closeGraphBtn.addEventListener("click", () => graphDialog.close());
searchInput.addEventListener("input", renderList);
titleInput.addEventListener("input", scheduleSave);
editor.addEventListener("input", scheduleSave);
window.addEventListener("resize", renderSaveStatus);
window.addEventListener("pagehide", () => {
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
