(function (root) {
  "use strict";
  const MAX_PAGE_BYTES = 8192;
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const responseBytes = value => bytes({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
  const fail = code => { throw Object.assign(new Error(code), { code, status: 400 }); };
  function exact(value, required, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("unsupported_conditions");
  }
  function scope(value) {
    exact(value, ["type"], ["collectionId"]);
    if (value.type === "all" && !Object.hasOwn(value, "collectionId")) return { type: "all" };
    if (value.type === "collection" && typeof value.collectionId === "string" && value.collectionId.length > 0 && value.collectionId.length <= 128)
      return { type: "collection", collectionId: value.collectionId };
    return fail("unsupported_scope");
  }
  function conditions(value) {
    exact(value, ["query", "scope"], ["limit", "cursor", "fields", "tagIds"]);
    if (typeof value.query !== "string" || !value.query.trim() || Array.from(value.query).length > 100) fail("unsupported_query");
    const limit = value.limit === undefined ? 5 : value.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) fail("unsupported_limit");
    if (value.cursor !== undefined && (typeof value.cursor !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.cursor))) fail("invalid_cursor");
    const fields = value.fields;
    if (fields !== undefined && (!Array.isArray(fields) || !fields.length || fields.length > 2
      || fields.some(field => !["title", "body"].includes(field)) || new Set(fields).size !== fields.length)) fail("unsupported_conditions");
    const tagIds = value.tagIds;
    if (tagIds !== undefined && (!Array.isArray(tagIds) || !tagIds.length || tagIds.length > 10
      || tagIds.some(id => typeof id !== "string" || !id || id.length > 128) || new Set(tagIds).size !== tagIds.length)) fail("unsupported_conditions");
    return { query: value.query, scope: scope(value.scope), limit, ...(value.cursor ? { cursor: value.cursor } : {}),
      ...(fields ? { fields: [...fields].sort() } : {}), ...(tagIds ? { tagIds: [...tagIds].sort() } : {}) };
  }
  const clip = (text, length) => Array.from(text).slice(0, length).join("");
  function search(notes, input, afterId = null) {
    const request = conditions(input), query = request.query.toLowerCase();
    const result = { results: [], hasMore: false, count: 0 };
    // Fixed ID ordering; all spans every collection, collection matches only the exact ID.
    // Live drafts, attachments and trash are excluded in both scopes.
    const ordered = notes.filter(note => !note.deletedAt && typeof note.id === "string" && note.id.length > 0 && note.id.length <= 128
      && (request.scope.type === "all" || note.collectionId === request.scope.collectionId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const seen = new Set(), fields = request.fields || ["title", "body"];
    for (const note of ordered) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      if (afterId !== null && note.id <= afterId) continue;
      const title = typeof note.title === "string" ? note.title : "", body = typeof note.body === "string" ? note.body : "";
      const position = body.toLowerCase().indexOf(query);
      if (!(fields.includes("title") && title.toLowerCase().includes(query)) && !(fields.includes("body") && position >= 0)) continue;
      if (request.tagIds && !request.tagIds.every(id => Array.isArray(note.tags) && note.tags.includes(id))) continue;
      let snippetStart = Math.max(0, position - 40);
      // Preserve a surrogate pair when the UTF-16 search window starts inside an emoji.
      if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(body[snippetStart]) && /[\uD800-\uDBFF]/.test(body[snippetStart - 1])) snippetStart--;
      const item = { id: note.id, title: clip(title, 200), snippet: clip(body.slice(snippetStart), 160),
        collectionId: typeof note.collectionId === "string" ? note.collectionId : null };
      if (result.results.length >= request.limit || responseBytes({ ...result, results: [...result.results, item] }) > MAX_PAGE_BYTES - 512) {
        result.hasMore = true; break;
      }
      result.results.push(item);
    }
    result.count = result.results.length;
    return result;
  }
  function validateResult(value, limit, allowedScope = { type: "all" }) {
    const allowed = scope(allowedScope);
    exact(value, ["results", "hasMore", "count"]);
    if (!Array.isArray(value.results) || value.results.length > limit || value.count !== value.results.length
      || typeof value.hasMore !== "boolean" || value.hasMore && !value.count
      || responseBytes({ ...value, nextCursor: "x".repeat(43) }) > MAX_PAGE_BYTES) fail("invalid_search_result");
    const ids = new Set();
    for (const item of value.results) {
      exact(item, ["id", "title", "snippet", ...(allowed.type === "collection" ? ["collectionId"] : [])], allowed.type === "collection" ? [] : ["collectionId"]);
      if (typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)
        || typeof item.title !== "string" || Array.from(item.title).length > 200
        || typeof item.snippet !== "string" || Array.from(item.snippet).length > 160) fail("invalid_search_result");
      if (item.collectionId !== undefined && item.collectionId !== null && (typeof item.collectionId !== "string" || !item.collectionId || item.collectionId.length > 128)) fail("invalid_search_result");
      if (allowed.type === "collection" && item.collectionId !== allowed.collectionId) fail("invalid_search_result");
      if (ids.size && item.id <= [...ids].at(-1)) fail("invalid_search_result");
      ids.add(item.id);
    }
    return value;
  }
  function readConditions(value) {
    exact(value, ["memoId"], ["offset"]);
    if (typeof value.memoId !== "string" || !value.memoId || value.memoId.length > 128) fail("invalid_memo_id");
    const offset = value.offset === undefined ? 0 : value.offset;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1048576) fail("invalid_offset");
    return { memoId: value.memoId, offset };
  }
  function read(note, input, allowedScope) {
    const request = readConditions(input), allowed = scope(allowedScope);
    // Do not inspect content or return metadata until the collection boundary passes.
    if (!note || note.id !== request.memoId || note.deletedAt
      || allowed.type === "collection" && note.collectionId !== allowed.collectionId) fail("memo_unavailable");
    const body = typeof note.body === "string" ? note.body : "";
    if (body.length > 1048576) fail("memo_too_large");
    const points = Array.from(body);
    if (request.offset > points.length) fail("invalid_offset");
    const end = Math.min(points.length, request.offset + 512);
    const result = { id: note.id, title: typeof note.title === "string" ? note.title : "", body: points.slice(request.offset, end).join(""),
      collectionId: typeof note.collectionId === "string" ? note.collectionId : null, tags: Array.isArray(note.tags) ? [...note.tags] : [],
      offset: request.offset, nextOffset: end < points.length ? end : null, totalLength: points.length };
    if (responseBytes(result) > MAX_PAGE_BYTES) fail("memo_too_large");
    return validateReadResult(result, request, allowed);
  }
  function validateReadResult(value, request, allowedScope) {
    exact(value, ["id", "title", "body", "collectionId", "tags", "offset", "nextOffset", "totalLength"]);
    if (value.id !== request.memoId || typeof value.title !== "string" || typeof value.body !== "string"
      || !Array.isArray(value.tags) || value.tags.some(id => typeof id !== "string")
      || value.collectionId !== null && (typeof value.collectionId !== "string" || value.collectionId.length > 128)
      || allowedScope.type === "collection" && value.collectionId !== allowedScope.collectionId
      || value.offset !== request.offset || !Number.isInteger(value.totalLength) || value.totalLength < value.offset || value.totalLength > 1048576
      || Array.from(value.body).length !== Math.min(512, value.totalLength - value.offset)
      || value.nextOffset !== (value.offset + Array.from(value.body).length < value.totalLength ? value.offset + 512 : null)
      || responseBytes(value) > MAX_PAGE_BYTES) fail("invalid_read_result");
    return value;
  }
  const api = { MAX_PAGE_BYTES, bytes, responseBytes, exact, scope, conditions, search, validateResult, readConditions, read, validateReadResult };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MemoNexusSearch = api;
})(typeof window !== "undefined" ? window : globalThis);
