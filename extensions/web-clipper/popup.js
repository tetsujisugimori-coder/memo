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
const environmentStatus = document.getElementById("environmentStatus");
const updateStatus = document.getElementById("updateStatus");
const updateManager = globalThis.MemoNexusClipperUpdateManager;
const transferLifecycle = globalThis.MemoNexusClipperTransferLifecycle;
const clipResult = globalThis.MemoNexusClipResult;
let clip = null;
let clipOperationActive = false;

const currentExtensionManifest = chrome.runtime.getManifest();
extensionVersion.textContent = currentExtensionManifest.version;

Object.entries(config.targets).forEach(([key, value]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key === "development" ? "開発環境（127.0.0.1:5500）" : "本番環境";
  option.dataset.url = value;
  target.append(option);
});
const distribution = config.distributions[config.distributionChannel] || config.distributions["unpacked-development"];
target.value = distribution.defaultTarget;

function browserFamily() {
  const userAgent = navigator.userAgent || "";
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  return "Chromium";
}

function extensionDiagnostics() {
  const manifest = chrome.runtime.getManifest();
  return {
    extensionVersion: manifest.version,
    manifestVersion: manifest.manifest_version,
    browserFamily: browserFamily(),
    targetEnvironment: target.value,
    distributionChannel: config.distributionChannel
  };
}

function updateEnvironmentStatus() {
  const targetLabel = target.value === "development" ? "開発環境" : "本番環境";
  const updateLabel = config.distributionChannel === "unpacked-development" && target.value === "development"
    ? `${distribution.label}・更新確認あり`
    : config.distributionChannel === "edge-store" ? `${distribution.label}自動更新` : distribution.label;
  environmentStatus.textContent = `接続先: ${targetLabel}／${updateLabel}`;
}

async function restoreTargetEnvironment() {
  const key = config.storage.targetKey;
  try {
    const stored = await chrome.storage.local.get(key);
    if (Object.hasOwn(config.targets, stored[key])) target.value = stored[key];
  } catch (_) {}
  updateEnvironmentStatus();
}

async function saveTargetEnvironment() {
  await chrome.storage.local.set({ [config.storage.targetKey]: target.value });
  updateEnvironmentStatus();
}

async function hasPendingClipTransfer() {
  if (clipOperationActive) return true;
  const stored = await chrome.storage.local.get(null);
  const inspection = transferLifecycle.inspectTransferEntries(stored);
  if (inspection.invalidKeys.length) await chrome.storage.local.remove(inspection.invalidKeys);
  return inspection.hasActiveTransfer;
}

async function checkDevelopmentUpdate() {
  updateEnvironmentStatus();
  const settings = config.updates[config.distributionChannel]?.[target.value];
  if (settings?.strategy !== "local-manifest") {
    updateStatus.textContent = settings?.strategy === "browser-managed"
      ? "更新はEdgeアドオンの標準機構を使用します。"
      : "この接続先ではローカル開発版の更新確認を行いません。";
    return false;
  }
  try {
    const response = await fetch(settings.manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remoteManifest = await response.json();
    const attemptKey = config.storage.reloadAttemptKey;
    const stored = await chrome.storage.local.get(attemptKey);
    const decision = updateManager.decideDevelopmentUpdate({
      environment: target.value,
      distributionChannel: config.distributionChannel,
      currentVersion: chrome.runtime.getManifest().version,
      latestVersion: remoteManifest.version,
      previousAttempt: stored[attemptKey],
      hasPendingTransfer: await hasPendingClipTransfer()
    });
    if (decision.action === "continue") {
      updateStatus.textContent = decision.reason === "up-to-date" ? "ローカル開発版は最新です。" : "開発版のバージョンを確認できませんでした。";
      if (decision.reason === "up-to-date" && stored[attemptKey]) await chrome.storage.local.remove(attemptKey);
      return false;
    }
    if (decision.action === "defer") {
      updateStatus.textContent = `開発版 ${decision.targetVersion} への更新はクリップ転送完了後に確認します。`;
      return false;
    }
    if (decision.action === "manual") {
      updateStatus.textContent = `開発版 ${decision.targetVersion} を反映できませんでした。Edgeが別の拡張機能フォルダを読み込んでいる可能性があります。edge://extensions/ で読み込み元を確認してください。`;
      return false;
    }
    if (decision.action === "reload") {
      updateStatus.textContent = `開発版 ${decision.targetVersion} を検出しました。拡張機能を再読み込みします。完了後に拡張アイコンをもう一度押してください。`;
      await chrome.storage.local.set({
        [attemptKey]: { targetVersion: decision.targetVersion, sourceVersion: chrome.runtime.getManifest().version, attemptedAt: new Date().toISOString() }
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
      chrome.runtime.reload();
      return true;
    }
    return false;
  } catch (cause) {
    console.info("Memo-Nexus Web Clipper development update check skipped", cause);
    updateStatus.textContent = "開発サーバーへ接続できないため更新確認を省略しました。クリップ機能は通常どおり利用できます。";
    return false;
  }
}

async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("現在のタブを取得できませんでした。");
  const validation = clipResult.validatePageUrl(tab.url || "");
  if (!validation.ok) throw clipResult.issueError(validation.issue);
  const fallback = {
    selection: "",
    title: tab.title || new URL(validation.url).hostname,
    url: validation.url,
    host: new URL(validation.url).hostname,
    capturedAt: new Date().toISOString(),
    metadata: { title: tab.title || "", description: "", siteName: "", articleBody: "" }
  };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = (...selectors) => selectors.map((selector) => document.querySelector(selector)?.getAttribute("content") || "").find(Boolean) || "";
        return {
          selection: window.getSelection()?.toString() || "",
          title: document.title || location.hostname,
          url: location.href,
          host: location.hostname,
          capturedAt: new Date().toISOString(),
          metadata: {
            title: meta('meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title || "",
            description: meta('meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]'),
            siteName: meta('meta[property="og:site_name"]', 'meta[name="application-name"]'),
            articleBody: ""
          }
        };
      }
    });
    return { ...fallback, ...(result?.result || {}) };
  } catch (cause) {
    return {
      ...fallback,
      acquisitionIssue: clipResult.createIssue({
        stage: clipResult.STAGES.PAGE_FETCH,
        code: "access_denied",
        developerMessage: cause?.message || "Active tab script injection failed"
      })
    };
  }
}

function showClip(nextClip) {
  clip = nextClip;
  const hasSelection = Boolean(clip.selection.trim());
  selectionStatus.textContent = hasSelection ? `選択文あり（${clip.selection.length.toLocaleString()}文字）` : "選択文なし。選択部分をクリップするにはページ上で文章を選択してください。";
  title.textContent = clip.title || "（タイトルなし）";
  url.textContent = clip.url || "（URLなし）";
  clipMode.value = "selection";
  error.textContent = clip.acquisitionIssue?.userMessage || "";
  updateModeUi();
}

function updateModeUi() {
  const mode = clipMode.value;
  const selectionRequired = mode === "selection" && !clip?.selection.trim();
  userMemoRow.hidden = mode !== "memo";
  modeStatus.textContent = selectionRequired
    ? "選択文がありません。ページ上で文章を選択するか、別のクリップ方式を選んでください。"
    : mode === "page"
      ? "確認画面を開く前にページ本文と画像を取得します"
      : mode === "link"
        ? "本文と画像は取得せず、URLとタイトルだけを保存します"
        : "";
  delete modeStatus.dataset.outcome;
  send.disabled = !clip || selectionRequired;
}

async function buildClipForMode() {
  const mode = clipMode.value;
  const base = { ...clip, ...extensionDiagnostics(), clipMode: mode, userMemo: mode === "memo" ? userMemo.value : "" };
  if (mode === "selection" && !base.selection.trim()) {
    throw clipResult.issueError({ stage: clipResult.STAGES.ARTICLE_EXTRACTION, code: "article_not_found", partialSaveAvailable: false, developerMessage: "Selection mode has no selected text" });
  }
  if (mode === "link" || mode === "memo") {
    const finalized = clipResult.buildClipResult({
      clipMode: mode,
      sourceSelection: base.selection,
      metadata: base.metadata,
      url: base.url,
      occurredAt: base.capturedAt
    });
    return { clip: { ...base, selection: finalized.content, metadata: finalized.metadata, clipResult: finalized.result, images: [] }, transfer: false };
  }

  const issues = base.acquisitionIssue ? [base.acquisitionIssue] : [];
  let content = null;
  let markdown = "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    issues.push(clipResult.createIssue({ stage: clipResult.STAGES.PAGE_FETCH, code: "access_denied", developerMessage: "Active tab is unavailable" }));
  } else {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-extractor.js"] });
      const [page] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (clipModeValue) => clipModeValue === "page"
          ? MemoNexusPageExtractor.extractPageContent()
          : MemoNexusPageExtractor.extractSelectionContent(),
        args: [mode]
      });
      content = page?.result || null;
      if (!content?.html) {
        issues.push(clipResult.createIssue({
          stage: clipResult.STAGES.ARTICLE_EXTRACTION,
          code: content?.metadata?.description || content?.metadata?.articleBody ? "metadata_only" : "article_not_found",
          developerMessage: `No extracted HTML (${content?.strategy || "no strategy"})`
        }));
      } else {
        modeStatus.textContent = mode === "page" ? "ページ本文を抽出しました。画像を確認しています…" : "選択部分を取得しました。画像を確認しています…";
        try {
          markdown = MemoNexusHtmlToMarkdown.htmlToMarkdown(content.html);
          if (!markdown) issues.push(clipResult.createIssue({ stage: clipResult.STAGES.HTML_PARSE, code: "html_parse_failed", developerMessage: "Markdown conversion returned empty output" }));
        } catch (cause) {
          issues.push(clipResult.createIssue({ stage: clipResult.STAGES.HTML_PARSE, code: "html_parse_failed", developerMessage: cause?.message || "Markdown conversion failed" }));
        }
      }
    } catch (cause) {
      console.info("Memo-Nexus Web Clipper page source was unavailable", {
        stage: clipResult.STAGES.PAGE_FETCH,
        code: "access_denied",
        sourceUrl: clipResult.sanitizeDiagnosticUrl(base.url)
      });
      issues.push(clipResult.createIssue({ stage: clipResult.STAGES.PAGE_FETCH, code: "access_denied", developerMessage: cause?.message || "Page extraction injection failed" }));
    }
  }

  let images = [];
  if (content?.images?.length) {
    modeStatus.textContent = `${content.images.length}枚の画像を取得しています…`;
    images = await fetchImagesInServiceWorker(content.images);
    const readyCount = images.filter((image) => image.status === "ready").length;
    modeStatus.textContent = readyCount
      ? `${readyCount}/${images.length}枚の画像を保存できます`
      : `${images.length}枚の画像を確認しましたが、保存できる画像はありません`;
  }
  const finalized = clipResult.buildClipResult({
    clipMode: mode,
    sourceSelection: base.selection,
    extractedMarkdown: markdown,
    metadata: {
      title: content?.metadata?.title || base.metadata?.title,
      description: content?.metadata?.description || base.metadata?.description,
      siteName: content?.metadata?.siteName || base.metadata?.siteName,
      articleBody: content?.metadata?.articleBody || base.metadata?.articleBody
    },
    images,
    issues,
    url: base.url,
    occurredAt: base.capturedAt
  });
  if (finalized.result.status === "failure") throw clipResult.issueError(finalized.result.issues[0]);
  modeStatus.textContent = finalized.result.notice;
  modeStatus.dataset.outcome = finalized.result.status;
  return {
    clip: {
      ...base,
      selection: finalized.content,
      metadata: finalized.metadata,
      clipResult: finalized.result,
      images,
      omittedImageCount: content?.omittedImageCount || 0
    },
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
  clipOperationActive = true;
  let transferKey = "";
  try {
    if (clipMode.value === "page") modeStatus.textContent = "ページ本文を取得しています…";
    if (clipMode.value === "selection") modeStatus.textContent = "選択部分を取得しています…";
    const payload = await buildClipForMode();
    let transferId = "";
    if (payload.transfer) {
      transferId = crypto.randomUUID();
      transferKey = transferLifecycle.transferStorageKey(transferId);
      await chrome.storage.local.set({ [transferKey]: { clip: payload.clip, createdAt: Date.now() } });
    }
    const receiver = window.open(MemoNexusClipPayload.buildWebClipDestination(destination, payload.clip, { transfer: payload.transfer, transferId }), "_blank");
    if (!receiver) throw new Error("Memo-Nexusを開けませんでした。ポップアップの許可を確認してください。");
    window.close();
  } catch (cause) {
    if (transferKey) await chrome.storage.local.remove(transferKey).catch(() => {});
    clipOperationActive = false;
    throw cause;
  }
}

async function initializePopup() {
  await restoreTargetEnvironment();
  if (await checkDevelopmentUpdate()) return;
  try {
    showClip(await readActivePage());
  } catch (cause) {
    const issue = clipResult.issueFromError(cause, { stage: clipResult.STAGES.PAGE_FETCH, code: "unknown" });
    console.info("Memo-Nexus Web Clipper could not read the active page", { stage: issue.stage, code: issue.code, retryable: issue.retryable });
    error.textContent = issue.userMessage;
    selectionStatus.textContent = "このページではクリップできません。";
    selectionStatus.dataset.outcome = "failure";
  }
}

initializePopup();
clipMode.addEventListener("change", updateModeUi);
target.addEventListener("change", async () => {
  send.disabled = true;
  try {
    await saveTargetEnvironment();
    const reloading = await checkDevelopmentUpdate();
    if (!reloading) updateModeUi();
  } catch (cause) {
    console.info("Memo-Nexus Web Clipper target setting could not be saved", cause);
    if (clip) updateModeUi();
  }
});
send.addEventListener("click", () => sendToMemoNexus().catch((cause) => {
  const issue = cause?.code === "clip-too-large"
    ? clipResult.createIssue({ stage: clipResult.STAGES.MEMO_CONVERSION, code: "html_parse_failed", partialSaveAvailable: false, developerMessage: "Clip payload exceeded the transfer limit" })
    : clipResult.issueFromError(cause, { stage: clipResult.STAGES.MEMO_CONVERSION, code: "unknown" });
  console.info("Memo-Nexus Web Clipper could not open Memo-Nexus", {
    stage: issue.stage,
    code: issue.code,
    retryable: issue.retryable,
    partialSaveAvailable: issue.partialSaveAvailable,
    sourceUrl: clipResult.sanitizeDiagnosticUrl(clip?.url)
  });
  error.textContent = cause?.code === "clip-too-large"
    ? "クリップ内容が転送上限を超えています。選択範囲を短くするか、リンクのみを選んでください。"
    : issue.code === "article_not_found" && clipMode.value === "selection"
      ? "選択部分をクリップするには、ページ上で文章を選択してください。URLとタイトルだけのクリップには自動で切り替えません。"
      : issue.userMessage;
  modeStatus.dataset.outcome = "failure";
  send.disabled = false;
  clipOperationActive = false;
}));
