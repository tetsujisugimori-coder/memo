const config = globalThis.MEMO_NEXUS_CLIPPER_CONFIG;
const selectionStatus = document.getElementById("selectionStatus");
const title = document.getElementById("title");
const url = document.getElementById("url");
const target = document.getElementById("target");
const send = document.getElementById("send");
const error = document.getElementById("error");
let clip = null;

Object.entries(config.targets).forEach(([key, value]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key === "development" ? "開発環境" : "本番環境";
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
  send.disabled = false;
}

async function sendToMemoNexus() {
  const destination = config.targets[target.value];
  error.textContent = "";
  send.disabled = true;
  const receiver = window.open(MemoNexusClipPayload.buildWebClipDestination(destination, clip), "_blank");
  if (!receiver) throw new Error("Memo-Nexusを開けませんでした。ポップアップの許可を確認してください。");
  window.close();
}

readActivePage().then(showClip).catch((cause) => {
  console.error("Memo-Nexus Web Clipper could not read the active page", cause);
  error.textContent = "このページはクリップできません。通常のWebページでお試しください。";
  selectionStatus.textContent = "このページではクリップできません。";
});
send.addEventListener("click", () => sendToMemoNexus().catch((cause) => {
  console.error("Memo-Nexus Web Clipper could not open Memo-Nexus", cause);
  error.textContent = cause?.code === "clip-too-large"
    ? "選択範囲が長すぎてクリップできません。範囲を短くして再度お試しください。"
    : "クリップを開始できませんでした。もう一度お試しください。";
  send.disabled = false;
}));
