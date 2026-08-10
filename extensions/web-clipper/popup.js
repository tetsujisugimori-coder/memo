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
  const destinationOrigin = new URL(destination).origin;
  error.textContent = "";
  send.disabled = true;
  let receiver = null;
  function onMessage(event) {
    if (event.origin !== destinationOrigin || event.source !== receiver || event.data?.type !== "memo-nexus-web-clip-ready") return;
    clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    receiver.postMessage({ type: "memo-nexus-web-clip", clip }, destinationOrigin);
    window.close();
  }
  window.addEventListener("message", onMessage);
  receiver = window.open(`${destination}${destination.includes("?") ? "&" : "?"}web-clip=1`, "_blank");
  if (!receiver) throw new Error("Memo-Nexusを開けませんでした。ポップアップの許可を確認してください。");

  const timeout = setTimeout(() => {
    window.removeEventListener("message", onMessage);
    error.textContent = "Memo-Nexusの受信準備を確認できませんでした。拡張IDと接続先の設定を確認してください。";
    send.disabled = false;
  }, 8000);
}

readActivePage().then(showClip).catch((cause) => {
  error.textContent = `ページ情報を取得できませんでした: ${cause.message || cause}`;
  selectionStatus.textContent = "このページではクリップできません。";
});
send.addEventListener("click", () => sendToMemoNexus().catch((cause) => {
  error.textContent = cause.message || String(cause);
  send.disabled = false;
}));
