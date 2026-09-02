(function (root) {
  const STAGES = Object.freeze({
    INPUT_VALIDATION: "input_validation",
    PAGE_FETCH: "page_fetch",
    HTML_PARSE: "html_parse",
    METADATA_EXTRACTION: "metadata_extraction",
    ARTICLE_EXTRACTION: "article_extraction",
    IMAGE_FETCH: "image_fetch",
    MEMO_CONVERSION: "memo_conversion",
    MEMO_SAVE: "memo_save"
  });
  const ERROR_CODES = Object.freeze([
    "invalid_url", "unsupported_scheme", "network_error", "timeout", "http_error",
    "access_denied", "authentication_required", "blocked_by_site", "empty_response",
    "html_parse_failed", "metadata_only", "article_not_found", "image_fetch_partial",
    "save_failed", "unknown"
  ]);
  const OUTCOMES = Object.freeze(["success", "partial", "failure"]);
  const MESSAGE = Object.freeze({
    invalid_url: "URLが無効です。入力内容を確認してください。",
    unsupported_scheme: "このURL形式には対応していません。HTTPまたはHTTPSのページを開いてください。",
    network_error: "ページへ接続できませんでした。接続を確認して再試行できます。",
    timeout: "接続がタイムアウトしました。再試行できます。",
    http_error: "ページを取得できませんでした。時間を置いて再試行してください。",
    access_denied: "ページへのアクセスが拒否されました。サイト側で取得が制限されている可能性があります。",
    authentication_required: "ログインが必要なページ、またはサイト側で取得が制限されている可能性があります。",
    blocked_by_site: "サイト側のアクセス制限により取得できない可能性があります。",
    empty_response: "ページから内容を取得できませんでした。",
    html_parse_failed: "ページ内容を解析できませんでした。保存可能な情報は確認画面に残しています。",
    metadata_only: "本文を取得できなかったため、取得できたタイトル、説明、URLなどを保存候補にしました。",
    article_not_found: "本文候補が見つかりませんでした。保存可能な情報は確認画面に残しています。",
    image_fetch_partial: "本文は取得できましたが、一部の画像を取得できませんでした。",
    save_failed: "メモを保存できませんでした。入力内容は保持されています。再試行してください。",
    unknown: "クリップ処理を完了できませんでした。入力内容を確認して再試行してください。"
  });

  function clean(value, limit = 500) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function normalizeMetadata(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      title: clean(input.title, 300),
      description: clean(input.description, 2000),
      siteName: clean(input.siteName, 255),
      articleBody: clean(input.articleBody, 500000)
    };
  }

  function sanitizeDiagnosticUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) { return ""; }
  }

  function validatePageUrl(value) {
    const raw = String(value || "").trim();
    let url;
    try { url = new URL(raw); }
    catch (_) { return { ok: false, issue: createIssue({ stage: STAGES.INPUT_VALIDATION, code: "invalid_url", developerMessage: "URL parsing failed" }) }; }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, issue: createIssue({ stage: STAGES.INPUT_VALIDATION, code: "unsupported_scheme", developerMessage: `Unsupported scheme: ${clean(url.protocol, 20)}` }) };
    }
    return { ok: true, url: url.href };
  }

  function classifyHttpStatus(status) {
    const value = Math.max(0, Math.floor(Number(status) || 0));
    if (value === 401) return "authentication_required";
    if (value === 403) return "access_denied";
    if (value === 429) return "blocked_by_site";
    return value >= 400 ? "http_error" : "unknown";
  }

  function defaultRetryable(code, httpStatus) {
    if (["timeout", "network_error", "blocked_by_site"].includes(code)) return true;
    return code === "http_error" && Number(httpStatus) >= 500;
  }

  function defaultPartialSave(code) {
    return !["invalid_url", "unsupported_scheme", "save_failed"].includes(code);
  }

  function createIssue(value = {}) {
    const code = ERROR_CODES.includes(value.code) ? value.code : "unknown";
    const httpStatus = Number.isFinite(Number(value.httpStatus)) && Number(value.httpStatus) > 0 ? Math.floor(Number(value.httpStatus)) : null;
    return {
      stage: Object.values(STAGES).includes(value.stage) ? value.stage : STAGES.PAGE_FETCH,
      code,
      userMessage: MESSAGE[code],
      developerMessage: clean(value.developerMessage, 300),
      httpStatus,
      timedOut: code === "timeout" || Boolean(value.timedOut),
      retryable: value.retryable === undefined ? defaultRetryable(code, httpStatus) : Boolean(value.retryable),
      partialSaveAvailable: value.partialSaveAvailable === undefined ? defaultPartialSave(code) : Boolean(value.partialSaveAvailable)
    };
  }

  function issueError(issue) {
    const normalized = createIssue(issue);
    const error = new Error(normalized.code);
    error.code = normalized.code;
    error.issue = normalized;
    return error;
  }

  function issueFromError(error, fallback = {}) {
    if (error?.issue) return createIssue(error.issue);
    const code = ERROR_CODES.includes(error?.code) ? error.code
      : error?.name === "AbortError" ? "timeout"
        : fallback.code || "unknown";
    return createIssue({ ...fallback, code, developerMessage: fallback.developerMessage || error?.message || "Unexpected pipeline error" });
  }

  function chooseContent({ clipMode, sourceSelection, extractedMarkdown, metadata }) {
    const mode = ["selection", "page", "link", "memo"].includes(clipMode) ? clipMode : "selection";
    const selected = String(sourceSelection || "").trim();
    const extracted = String(extractedMarkdown || "").trim();
    if (mode === "link") return { content: "", fallbackKind: "", fallbackUsed: false };
    if (mode === "memo") return { content: selected, fallbackKind: "", fallbackUsed: false };
    if (mode === "selection") {
      return extracted
        ? { content: extracted, fallbackKind: "", fallbackUsed: false }
        : { content: selected, fallbackKind: selected ? "selection_text" : "", fallbackUsed: Boolean(selected) };
    }
    if (extracted) return { content: extracted, fallbackKind: "", fallbackUsed: false };
    if (selected) return { content: selected, fallbackKind: "selection_text", fallbackUsed: true };
    if (metadata.articleBody) return { content: metadata.articleBody, fallbackKind: "json_ld_article_body", fallbackUsed: true };
    if (metadata.description) return { content: metadata.description, fallbackKind: "description", fallbackUsed: true };
    return { content: "", fallbackKind: "metadata_only", fallbackUsed: true };
  }

  function rebuildClipResultForImages(value = {}, images = []) {
    const input = value && typeof value === "object" ? value : {};
    const diagnostic = input.diagnostic && typeof input.diagnostic === "object" ? input.diagnostic : {};
    const originalIssues = (Array.isArray(input.issues) ? input.issues : []).map(createIssue);
    const hadImageIssue = originalIssues.some((issue) => issue.code === "image_fetch_partial");
    const issues = originalIssues.filter((issue) => issue.code !== "image_fetch_partial");
    const sourceImages = Array.isArray(images) ? images : [];
    const imageSuccessCount = sourceImages.filter((image) => image?.status === "ready").length;
    const imageFailureCount = sourceImages.length - imageSuccessCount;
    if (imageFailureCount) {
      issues.push(createIssue({
        stage: STAGES.IMAGE_FETCH,
        code: "image_fetch_partial",
        developerMessage: `${imageFailureCount}/${sourceImages.length} image fetches failed`
      }));
    }

    const fatal = issues.find((issue) => !issue.partialSaveAvailable);
    const preserveNonImageFailure = input.status === "failure" && !hadImageIssue;
    let status = fatal || preserveNonImageFailure
      ? "failure"
      : issues.length || diagnostic.fallbackUsed ? "partial" : "success";
    if (!OUTCOMES.includes(status)) status = "failure";
    const primaryIssue = issues[0] || null;
    const notice = status === "success"
      ? imageSuccessCount ? `本文と画像${imageSuccessCount}件を取得しました。内容を確認して保存してください。` : "クリップ内容を取得しました。内容を確認して保存してください。"
      : primaryIssue?.userMessage || clean(input.notice, 500) || MESSAGE.unknown;

    return {
      status,
      notice,
      issues,
      diagnostic: {
        ...diagnostic,
        occurredAt: Number.isFinite(Date.parse(diagnostic.occurredAt)) ? new Date(diagnostic.occurredAt).toISOString() : new Date().toISOString(),
        stage: primaryIssue?.stage || STAGES.MEMO_CONVERSION,
        code: primaryIssue?.code || "",
        httpStatus: primaryIssue?.httpStatus || null,
        timedOut: Boolean(primaryIssue?.timedOut),
        imageSuccessCount,
        imageFailureCount,
        fallbackUsed: Boolean(diagnostic.fallbackUsed),
        fallbackKind: clean(diagnostic.fallbackKind, 60),
        finalResult: status,
        sourceUrl: sanitizeDiagnosticUrl(diagnostic.sourceUrl)
      }
    };
  }

  function buildClipResult(options = {}) {
    const clipMode = ["selection", "page", "link", "memo"].includes(options.clipMode) ? options.clipMode : "selection";
    const metadata = normalizeMetadata(options.metadata);
    const images = Array.isArray(options.images) ? options.images : [];
    const contentChoice = chooseContent({ ...options, clipMode, metadata });
    const suppliedIssues = (Array.isArray(options.issues) ? options.issues : options.issue ? [options.issue] : []).map(createIssue);
    const issues = suppliedIssues.slice();
    if (clipMode === "page" && contentChoice.fallbackUsed && !issues.some((item) => ["metadata_only", "article_not_found", "html_parse_failed"].includes(item.code))) {
      issues.push(createIssue({
        stage: STAGES.ARTICLE_EXTRACTION,
        code: contentChoice.fallbackKind === "metadata_only" || contentChoice.fallbackKind === "description" ? "metadata_only" : "article_not_found",
        developerMessage: `Fallback used: ${contentChoice.fallbackKind}`
      }));
    }
    const selectionMissing = clipMode === "selection" && !contentChoice.content;
    if (selectionMissing && !issues.some((item) => !item.partialSaveAvailable)) {
      issues.push(createIssue({
        stage: STAGES.MEMO_CONVERSION,
        code: "empty_response",
        developerMessage: "Selection clip has no selected content",
        partialSaveAvailable: false
      }));
    }
    const fatal = issues.find((item) => !item.partialSaveAvailable);
    let status = fatal || selectionMissing ? "failure" : issues.length || contentChoice.fallbackUsed ? "partial" : "success";
    if (!OUTCOMES.includes(status)) status = "failure";
    const primaryIssue = issues[0] || null;
    const metadataFound = Boolean(metadata.title || metadata.description || metadata.siteName || metadata.articleBody);
    const articleFound = Boolean(String(options.extractedMarkdown || "").trim() || metadata.articleBody);
    const result = rebuildClipResultForImages({
      status,
      notice: primaryIssue?.userMessage || MESSAGE.unknown,
      issues,
      diagnostic: {
        occurredAt: Number.isFinite(Date.parse(options.occurredAt)) ? new Date(options.occurredAt).toISOString() : new Date().toISOString(),
        stage: primaryIssue?.stage || STAGES.MEMO_CONVERSION,
        code: primaryIssue?.code || "",
        httpStatus: primaryIssue?.httpStatus || null,
        timedOut: Boolean(primaryIssue?.timedOut),
        articleFound,
        metadataFound,
        fallbackUsed: contentChoice.fallbackUsed,
        fallbackKind: contentChoice.fallbackKind,
        finalResult: status,
        sourceUrl: sanitizeDiagnosticUrl(options.url)
      }
    }, images);
    return {
      content: contentChoice.content,
      metadata: { ...metadata, articleBody: "" },
      result
    };
  }

  const api = {
    STAGES,
    ERROR_CODES,
    OUTCOMES,
    MESSAGE,
    buildClipResult,
    classifyHttpStatus,
    createIssue,
    issueError,
    issueFromError,
    normalizeMetadata,
    rebuildClipResultForImages,
    sanitizeDiagnosticUrl,
    validatePageUrl
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipResult = api;
})(globalThis);
