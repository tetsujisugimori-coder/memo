const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STAGES,
  ERROR_CODES,
  buildClipResult,
  classifyHttpStatus,
  createIssue,
  sanitizeDiagnosticUrl,
  validatePageUrl
} = require("./clip-result.js");

test("要求された全失敗分類を構造化issueとして扱える", () => {
  const expected = [
    "invalid_url", "unsupported_scheme", "network_error", "timeout", "http_error", "access_denied",
    "authentication_required", "blocked_by_site", "empty_response", "html_parse_failed", "metadata_only",
    "article_not_found", "image_fetch_partial", "save_failed", "unknown"
  ];
  assert.deepEqual(ERROR_CODES, expected);
  expected.forEach((code) => {
    const issue = createIssue({ stage: STAGES.PAGE_FETCH, code, httpStatus: code === "http_error" ? 500 : null });
    assert.equal(issue.code, code);
    assert.ok(issue.userMessage);
    assert.equal(typeof issue.retryable, "boolean");
    assert.equal(typeof issue.partialSaveAvailable, "boolean");
  });
  assert.equal(createIssue({ stage: STAGES.PAGE_FETCH, code: "timeout" }).timedOut, true);
});

test("URL入力を不正値と未対応schemeへ分け、診断URLから認証・query・fragmentを除く", () => {
  assert.equal(validatePageUrl("not a url").issue.code, "invalid_url");
  assert.equal(validatePageUrl("file:///secret.txt").issue.code, "unsupported_scheme");
  assert.equal(validatePageUrl("https://example.com/article").ok, true);
  assert.equal(sanitizeDiagnosticUrl("https://user:pass@example.com/article?token=secret#part"), "https://example.com/article");
});

test("HTTP状態を認証・拒否・サイト制限・一般HTTPエラーへ分類する", () => {
  assert.equal(classifyHttpStatus(401), "authentication_required");
  assert.equal(classifyHttpStatus(403), "access_denied");
  assert.equal(classifyHttpStatus(429), "blocked_by_site");
  for (const status of [404, 500, 503]) assert.equal(classifyHttpStatus(status), "http_error");
});

test("通常記事、選択範囲、リンク、メモ付きの意味を維持する", () => {
  const page = buildClipResult({ clipMode: "page", extractedMarkdown: "# 本文", metadata: { title: "記事" } });
  const selection = buildClipResult({ clipMode: "selection", sourceSelection: "選択文", extractedMarkdown: "> 選択文" });
  const link = buildClipResult({ clipMode: "link", sourceSelection: "破棄される本文" });
  const memo = buildClipResult({ clipMode: "memo", sourceSelection: "選択文" });
  assert.equal(page.result.status, "success");
  assert.equal(page.content, "# 本文");
  assert.equal(selection.content, "> 選択文");
  assert.equal(link.content, "");
  assert.equal(memo.content, "選択文");
});

test("本文抽出失敗時は選択文、JSON-LD、description、メタデータのみの順で部分保存する", () => {
  const selected = buildClipResult({ clipMode: "page", sourceSelection: "選択文", metadata: { articleBody: "JSON-LD本文", description: "説明" } });
  const jsonLd = buildClipResult({ clipMode: "page", metadata: { articleBody: "JSON-LD本文", description: "説明" } });
  const description = buildClipResult({ clipMode: "page", metadata: { description: "説明" } });
  const metadataOnly = buildClipResult({ clipMode: "page", metadata: { title: "記事" }, url: "https://example.com/article" });
  assert.deepEqual([selected.content, jsonLd.content, description.content, metadataOnly.content], ["選択文", "JSON-LD本文", "説明", ""]);
  assert.deepEqual([selected.result.diagnostic.fallbackKind, jsonLd.result.diagnostic.fallbackKind, description.result.diagnostic.fallbackKind, metadataOnly.result.diagnostic.fallbackKind], ["selection_text", "json_ld_article_body", "description", "metadata_only"]);
  assert.ok([jsonLd, selected, description, metadataOnly].every((item) => item.result.status === "partial"));
  assert.equal(jsonLd.metadata.articleBody, "", "フォールバック済み本文をメタデータへ重複保持しない");
});

test("ページ取得失敗でも選択文を保持し、画像一部失敗を部分成功へまとめる", () => {
  const result = buildClipResult({
    clipMode: "page",
    sourceSelection: "利用者が選択した重要文",
    metadata: { title: "記事" },
    images: [{ status: "ready" }, { status: "failed" }, { status: "timeout" }],
    issue: createIssue({ stage: STAGES.PAGE_FETCH, code: "timeout" }),
    url: "https://example.com/article?private=1"
  });
  assert.equal(result.content, "利用者が選択した重要文");
  assert.equal(result.result.status, "partial");
  assert.equal(result.result.diagnostic.imageSuccessCount, 1);
  assert.equal(result.result.diagnostic.imageFailureCount, 2);
  assert.ok(result.result.issues.some((issue) => issue.code === "image_fetch_partial"));
  assert.equal(result.result.diagnostic.sourceUrl, "https://example.com/article");
});

test("選択方式だけは選択文なしで暗黙のリンク保存へ切り替えない", () => {
  const result = buildClipResult({ clipMode: "selection", sourceSelection: "" });
  assert.equal(result.result.status, "failure");
  assert.equal(result.content, "");
});
