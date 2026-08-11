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
let clip = null;

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
  if (mode !== "page") return { clip: { ...base, selection: mode === "link" ? "" : base.selection }, transfer: false };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("page-injection-failed");
  const [page] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: MemoNexusPageExtractor.extractPageHtml })
    .catch((cause) => { console.error("Memo-Nexus Web Clipper page injection failed", cause); throw new Error("page-injection-failed"); });
  if (!page?.result) throw new Error("page-content-empty");
  const markdown = MemoNexusHtmlToMarkdown.htmlToMarkdown(page.result);
  if (!markdown) throw new Error("page-markdown-empty");
  return { clip: { ...base, selection: markdown }, transfer: true };
}

async function sendToMemoNexus() {
  const destination = config.targets[target.value];
  error.textContent = "";
  send.disabled = true;
  const payload = await buildClipForMode();
  const receiver = window.open(MemoNexusClipPayload.buildWebClipDestination(destination, payload.clip, { transfer: payload.transfer }), "_blank");
  if (!receiver) throw new Error("Memo-Nexusを開けませんでした。ポップアップの許可を確認してください。");
  if (payload.transfer) {
    const expectedOrigin = new URL(destination).origin;
    const receive = (event) => {
      if (event.origin !== expectedOrigin || event.data?.type !== "memo-nexus-web-clip-ready") return;
      receiver.postMessage({ type: "memo-nexus-web-clip", clip: payload.clip }, expectedOrigin);
      window.removeEventListener("message", receive);
      window.close();
    };
    window.addEventListener("message", receive);
  } else window.close();
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
