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
const THEME_STORAGE_KEY = "memo-nexus-theme";
const COLLECTION_SORT_STORAGE_KEY = "memo-nexus-collection-sort";
const IMAGE_BLOCK_SIZE_STORAGE_KEY = "memo-nexus-image-block-size";
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

// HTML要素を短く取得するための小さなヘルパー。
const $ = (id) => document.getElementById(id);

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
const storageStatusDetails = $("storageStatusDetails");
const storageEstimateMessage = $("storageEstimateMessage");
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
const noteMeta = $("noteMeta");
const editor = $("editor");
const preview = $("preview");
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

// アプリ全体で共有する状態。
// notesはIndexedDBから読み込んだメモ一覧のメモリ上コピーです。
let db;
let notes = [];
let collections = [];
let currentId = null;
let saveTimer = null;
let lastDiscovery = "";
let linkStatsVisible = false;
let saveStatusState = "saved";
let saveStatusTime = null;
let mermaidInitialized = false;
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
let currentAttachments = [];
let imageBlockSize = "medium";
let pendingImageBlockTarget = null;
let attachmentRenderToken = 0;
let attachmentObjectUrls = new Map();
let pdfObjectUrls = new Map();
let pdfObjectUrlTimers = new Map();
const enqueueAttachmentAddition = createKeyedSerialQueue();
const pendingAttachmentAdditions = new Map();

// ページ読み込み後、すぐにアプリを起動します。
init();

// 起動処理。DBを開き、初期メモを用意し、今日メモを開いて即入力できる状態にします。
async function init() {
  console.log(`Memo Nexus v${APP_VERSION} "${APP_LABEL}" (${APP_BUILD})`);
  console.log("Memo Nexus URL:", location.href);
  appVersionDisplays.forEach((element) => {
    element.textContent = `v${APP_VERSION} "${APP_LABEL}"`;
  });
  restoreTheme();
  restoreImageBlockSize();
  restoreCollectionSortOrder();

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
  renderAll();
  const restoredNote = restoredDraftId && notes.find((note) => note.id === restoredDraftId);
  openNote(restoredNote ? restoredNote.id : getTodayNote().id);
  if (restoredNote) {
    saveStatus.textContent = "前回の編集中メモを復元しました";
  }
  titleInput.focus();
  titleInput.select();
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

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("dark", nextTheme === "dark");
  if (themeSelect) {
    themeSelect.value = nextTheme;
  }
}

function saveTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    console.warn("Theme save failed", error);
  }
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
    transaction.oncomplete = () => resolve(note);
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
    transaction.oncomplete = resolve;
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
  renderList();
  renderCollectionExplorer();
  renderNoteMeta();
  renderRelated();
  renderDiscovery();
  renderLinkStats();
  updateUndoButton();
}

// 左側のメモ一覧を描画します。検索欄に入力があればタイトル・本文から絞り込みます。
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = activeNotes().filter((note) => {
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

  setRelatedDrawerOpen(false, { restoreFocus: false });
  currentId = note.id;
  titleInput.value = note.title;
  editor.value = note.body;
  lastUndoSnapshotAt = 0;
  setSaveStatus("saved", note.updatedAt);
  renderNoteMeta();
  renderList();
  renderCollectionExplorer();
  renderPreview();
  renderAttachmentsForCurrentNote();
  renderRelated();
  renderDiscovery();
  updateUndoButton();
  editor.focus();
}

// 今開いているメモ本体をnotes配列から取り出します。
function currentNote() {
  return notes.find((note) => note.id === currentId);
}

// 入力のたびに即保存すると重いので、少し待ってから保存する予約をします。
function scheduleSave({ render = true } = {}) {
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
    currentId = note.id;

    const afterLinks = collectLinks(activeNotes()).length;
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
  const note = currentNote();
  if (!note) {
    preview.innerHTML = "";
    renderLinkList();
    renderLinkStats();
    return;
  }

  const body = (note.id === currentId ? editor.value : note.body);
  preview.innerHTML = renderPreviewHtml(body);
  hydrateInlineAttachmentImages();
  bindImageBlockControls();

  preview.querySelectorAll(".wiki-link").forEach((button) => {
    button.addEventListener("click", () => openOrCreateLinkedNote(button.dataset.title));
  });
  highlightCodeBlocks();
  renderMermaidDiagrams();
  renderLinkList();
  renderLinkStats();
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
    }
    return;
  }
  const note = currentNote();
  if (!note || note.deletedAt) return;
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
    return;
  }
  handleAttachmentFiles(files, {
    insertIntoEditor: true,
    inputType: "insertFromPaste",
    selectionStart,
    selectionEnd
  });
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

function renderPreviewHtml(body) {
  let codeBlockIndex = 0;
  const html = splitImageBlocks(body)
    .map((segment, imageBlockIndex) => {
      if (segment.type === "image") return renderImageBlock(segment, imageBlockIndex);
      return splitFencedBlocks(segment.text).map((block) => {
        if (block.type !== "code") return renderTextBlock(block.text);
        const rendered = block.language.toLowerCase() === "mermaid"
          ? renderMermaidBlock(block.code, codeBlockIndex)
          : renderCodeBlock(block.code, block.language);
        codeBlockIndex += 1;
        return rendered;
      }).join("");
    })
    .filter(Boolean)
    .join("");

  return html || `<p class="empty">本文を書くとカード表示されます。</p>`;
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

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim());
        index += 1;
      }
      html.push(renderQuoteBlock(quoteLines));
      continue;
    }

    paragraphLines.push(line.trimEnd());
    index += 1;
  }

  flushParagraph();
  return html.join("");
}

function renderListBlock(lines) {
  return `<ul>${lines
    .map((line) => `<li>${renderMarkdownInline(line.replace(/^-\s+/, ""))}</li>`)
    .join("")}</ul>`;
}

function renderQuoteBlock(lines) {
  const content = lines
    .map((line) => renderMarkdownInline(line.replace(/^>\s?/, "")))
    .join("<br>");
  return `<blockquote>${content}</blockquote>`;
}

function renderMarkdownInline(text) {
  let html = "";
  let index = 0;

  while (index < text.length) {
    const token = findNextInlineToken(text, index);
    if (!token) {
      html += escapeHtml(text.slice(index));
      break;
    }

    html += escapeHtml(text.slice(index, token.start));
    if (token.type === "code") {
      html += `<code class="inline-code">${escapeHtml(token.content)}</code>`;
    } else if (token.type === "wiki") {
      html += renderWikiButton(token.content);
    } else if (token.type === "bold") {
      html += `<strong>${renderMarkdownInline(token.content)}</strong>`;
    } else if (token.type === "attachment") {
      html += `<span class="inline-attachment-image" data-attachment-id="${escapeAttr(token.id)}" data-alt="${escapeAttr(token.alt)}" role="img" aria-label="${escapeAttr(token.alt || "添付画像")}">画像を読み込み中...</span>`;
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

  return tokens.sort((a, b) => a.start - b.start || a.end - b.end)[0] || null;
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

function renderMermaidBlock(code, index) {
  return `
    <div class="mermaid-block">
      <div class="mermaid-diagram" id="mermaid-diagram-${index}">${escapeHtml(code)}</div>
      <pre class="mermaid-source" hidden><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function renderMermaidDiagrams() {
  const diagrams = preview.querySelectorAll(".mermaid-diagram");
  if (!diagrams.length || !window.mermaid) return;

  try {
    if (!mermaidInitialized) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      mermaidInitialized = true;
    }
  } catch (error) {
    console.error("Mermaid render failed", error);
    return;
  }

  diagrams.forEach((diagram) => renderMermaidDiagram(diagram));
}

async function renderMermaidDiagram(diagram) {
  const block = diagram.closest(".mermaid-block");

  try {
    await window.mermaid.run({ nodes: [diagram] });
  } catch (error) {
    console.error("Mermaid render failed", error);
    showMermaidError(block);
  }
}

function showMermaidError(block) {
  if (!block) return;

  block.classList.add("mermaid-error-block");
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
    const exists = activeNotes().some((note) => note.title === title);
    const className = exists ? "wiki-link" : "wiki-link missing";
    return `<button class="${className}" data-title="${escapeAttr(title)}">${escapeHtml(title)}</button>`;
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

async function openSettingsDialog() {
  restoreTheme();
  await renderStorageStatus();
  settingsDialog.showModal();
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
  const open = typeof force === "boolean" ? force : !document.body.classList.contains("collections-open");
  document.body.classList.toggle("collections-open", open);
  collectionExplorer.setAttribute("aria-hidden", String(!open));
  collectionsBtn.setAttribute("aria-expanded", String(open));
  collectionBackdrop.hidden = !open || window.matchMedia("(min-width: 1201px)").matches;
  if (open) {
    renderCollectionExplorer();
    collectionTree.focus();
  } else {
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

// ここから下は、画面操作と処理を結びつけるイベント設定です。
newBtn.addEventListener("click", async () => {
  const note = await createNote("", "", { avoidDuplicateTitle: false });
  notes = await getAllNotes();
  renderAll();
  openNote(note.id);
});

if (collectionsBtn) collectionsBtn.addEventListener("click", () => toggleCollectionExplorer());
if (closeCollectionsBtn) closeCollectionsBtn.addEventListener("click", () => toggleCollectionExplorer(false));
if (collectionBackdrop) collectionBackdrop.addEventListener("click", () => toggleCollectionExplorer(false));
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
closeSettingsBtn.addEventListener("click", () => settingsDialog.close());
if (themeSelect) {
  themeSelect.addEventListener("change", () => saveTheme(themeSelect.value));
}
if (imageBlockSizeSelect) {
  imageBlockSizeSelect.addEventListener("change", () => saveImageBlockSize(imageBlockSizeSelect.value));
}
if (collectionSortSelect) {
  collectionSortSelect.addEventListener("change", () => saveCollectionSortOrder(collectionSortSelect.value));
}
if (deleteBtn) {
  deleteBtn.addEventListener("click", deleteCurrentNote);
}
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
editor.addEventListener("paste", handleClipboardAttachmentPaste);
editor.addEventListener("dragover", (event) => {
  if (editorDropHasFiles(event)) event.preventDefault();
});
editor.addEventListener("drop", handleEditorAttachmentDrop);
titleInput.addEventListener("input", scheduleSave);
editor.addEventListener("input", scheduleSave);
window.addEventListener("resize", () => {
  renderSaveStatus();
  if (document.body.classList.contains("collections-open")) {
    collectionBackdrop.hidden = window.matchMedia("(min-width: 1201px)").matches;
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".collection-popup-menu,.collection-more,.collection-memo-more,#collectionAddMenuBtn")) closeCollectionMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isRelatedDrawerOpen() && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    setRelatedDrawerOpen(false);
    return;
  }
  if (event.key === "Escape" && document.body.classList.contains("collections-open") && !collectionMoveDialog.open) {
    toggleCollectionExplorer(false);
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
