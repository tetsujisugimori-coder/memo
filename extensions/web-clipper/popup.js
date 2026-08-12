const config = globalThis.MEMO_NEXUS_CLIPPER_CONFIG;
const selectionStatus = document.getElementById("selectionStatus");
const title = document.getElementById("title");
const url = document.getElementById("url");
const target = document.getElementById("target");
const send = document.getElementById("send");
const error = document.getElementById("error");
const clipMode = document.getElementById("clipMode");
const userMemo = document.getElementById("userMemo");
const userMemoRow = document.getElementById("userMemoRow");
const modeStatus = document.getElementById("modeStatus");
const extensionVersion = document.getElementById("extensionVersion");
let clip = null;

extensionVersion.textContent = chrome.runtime.getManifest().version;

Object.entries(config.targets).forEach(([key, value]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key === "development" ? "開発環境（127.0.0.1:5500）" : "本番環境";
  option.dataset.url = value;
  target.append(option);
});
target.value = config.defaultTarget;

async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("現在のタブを取得できませんでした。");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      selection: window.getSelection()?.toString() || "",
      title: document.title || "",
      url: location.href,
      host: location.hostname,
      capturedAt: new Date().toISOString()
    })
  });
  return result.result;
}

function showClip(nextClip) {
  clip = nextClip;
  const hasSelection = Boolean(clip.selection.trim());
  selectionStatus.textContent = hasSelection ? `選択文あり（${clip.selection.length.toLocaleString()}文字）` : "選択文なし（URLとタイトルを渡します）";
  title.textContent = clip.title || "（タイトルなし）";
  url.textContent = clip.url || "（URLなし）";
  clipMode.value = hasSelection ? "selection" : "link";
  updateModeUi();
  send.disabled = false;
}

function updateModeUi() {
  const mode = clipMode.value;
  userMemoRow.hidden = mode !== "memo";
  modeStatus.textContent = mode === "page" ? "ページ本文を取得します" : mode === "link" ? "本文は取得せず、リンク情報を保存します" : "";
}

async function buildClipForMode() {
  const mode = clipMode.value;
  const base = { ...clip, clipMode: mode, userMemo: mode === "memo" ? userMemo.value : "" };
  if (mode === "link" || mode === "memo") return { clip: { ...base, selection: mode === "link" ? "" : base.selection, images: [] }, transfer: false };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("page-injection-failed");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-extractor.js"] })
    .catch((cause) => { console.error("Memo-Nexus Web Clipper extractor injection failed", cause); throw new Error("page-injection-failed"); });
  const [page] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (clipModeValue) => clipModeValue === "page"
      ? MemoNexusPageExtractor.extractPageContent()
      : MemoNexusPageExtractor.extractSelectionContent(),
    args: [mode]
  })
    .catch((cause) => { console.error("Memo-Nexus Web Clipper page injection failed", cause); throw new Error("page-injection-failed"); });
  const content = page?.result;
  if (!content?.html) {
    if (mode === "selection") return { clip: { ...base, images: [] }, transfer: false };
    throw new Error("page-content-empty");
  }
  const markdown = MemoNexusHtmlToMarkdown.htmlToMarkdown(content.html);
  if (!markdown) throw new Error("page-markdown-empty");
  let images = [];
  if (content.images?.length) {
    modeStatus.textContent = `${content.images.length}枚の画像を取得しています…`;
    images = await fetchImagesInServiceWorker(content.images);
    const readyCount = images.filter((image) => image.status === "ready").length;
    modeStatus.textContent = readyCount
      ? `${readyCount}/${images.length}枚の画像を保存できます`
      : `${images.length}枚の画像を確認しましたが、保存できる画像はありません`;
  }
  return {
    clip: { ...base, selection: markdown, images, omittedImageCount: content.omittedImageCount || 0 },
    transfer: mode === "page" || images.length > 0
  };
}

async function fetchImagesInServiceWorker(candidates) {
  const perImageLimit = 5 * 1024 * 1024;
  const totalLimit = 20 * 1024 * 1024;
  const failure = (candidate, status, errorCode, message) => ({ ...candidate, status, selected: false, dataBase64: "", errorCode, error: message });
  const fetchOne = (candidate) => new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(failure(candidate, "timeout", "TIMEOUT", "画像取得がタイムアウトしました")), 20000);
    chrome.runtime.sendMessage({
      type: "memo-nexus-fetch-clip-image",
      requestId,
      candidate,
      options: { perImageLimit, totalLimit, timeoutMs: 15000, concurrency: 1 }
    }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        const noReceiver = /Receiving end does not exist/i.test(runtimeError.message || "");
        finish(failure(candidate, "failed", noReceiver ? "NO_RECEIVER" : "RUNTIME_MESSAGE_ERROR", runtimeError.message || "Service Workerへ接続できません"));
        return;
      }
      if (response?.requestId !== requestId) {
        finish(failure(candidate, "failed", "RESPONSE_ID_MISMATCH", "画像取得の応答IDが一致しません"));
        return;
      }
      const image = Array.isArray(response?.images) ? response.images[0] : null;
      if (!response?.ok || !image) {
        finish(failure(candidate, "failed", response?.errorCode || "RESPONSE_MISSING", response?.error || "画像取得結果を受信できませんでした"));
        return;
      }
      finish(image);
    });
  });
  const results = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fetchOne(candidates[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
  let total = 0;
  return results.map((image) => {
    if (image.status !== "ready") return image;
    if (total + image.size > totalLimit) return failure(image, "too-large", "TOTAL_LIMIT_EXCEEDED", "クリップ画像合計20MBの上限を超えています");
    total += image.size;
    return image;
  });
}

async function sendToMemoNexus() {
  const destination = config.targets[target.value];
  error.textContent = "";
  send.disabled = true;
  const payload = await buildClipForMode();
  let transferId = "";
  if (payload.transfer) {
    transferId = crypto.randomUUID();
    await chrome.storage.local.set({ [`memoNexusTransfer:${transferId}`]: { clip: payload.clip, createdAt: Date.now() } });
  }
  const receiver = window.open(MemoNexusClipPayload.buildWebClipDestination(destination, payload.clip, { transfer: payload.transfer, transferId }), "_blank");
  if (!receiver) throw new Error("Memo-Nexusを開けませんでした。ポップアップの許可を確認してください。");
  window.close();
}

readActivePage().then(showClip).catch((cause) => {
  console.error("Memo-Nexus Web Clipper could not read the active page", cause);
  error.textContent = "このページはクリップできません。通常のWebページでお試しください。";
  selectionStatus.textContent = "このページではクリップできません。";
});
clipMode.addEventListener("change", updateModeUi);
send.addEventListener("click", () => sendToMemoNexus().catch((cause) => {
  console.error("Memo-Nexus Web Clipper could not open Memo-Nexus", cause);
  error.textContent = cause?.code === "clip-too-large"
    ? "選択範囲が長すぎてクリップできません。範囲を短くして再度お試しください。"
    : cause?.message === "page-extract-failed"
      ? "ページ本文を取得できませんでした。選択部分またはリンクのみでお試しください。"
    : cause?.message === "page-injection-failed"
      ? "ページ本文を取得できませんでした（拡張の権限または注入を確認してください）。"
    : cause?.message === "page-content-empty"
      ? "ページ本文の候補が見つかりませんでした。選択部分またはリンクのみでお試しください。"
    : cause?.message === "page-markdown-empty"
      ? "ページ本文をMarkdownへ変換できませんでした。選択部分またはリンクのみでお試しください。"
    : "クリップを開始できませんでした。もう一度お試しください。";
  send.disabled = false;
}));
