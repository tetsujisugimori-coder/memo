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
    exact(value, ["query", "scope"], ["limit", "cursor"]);
    if (typeof value.query !== "string" || !value.query.trim() || Array.from(value.query).length > 100) fail("unsupported_query");
    const limit = value.limit === undefined ? 5 : value.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) fail("unsupported_limit");
    if (value.cursor !== undefined && (typeof value.cursor !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.cursor))) fail("invalid_cursor");
    return { query: value.query, scope: scope(value.scope), limit, ...(value.cursor ? { cursor: value.cursor } : {}) };
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
    for (const note of ordered) {
      if (afterId !== null && note.id <= afterId) continue;
      const title = typeof note.title === "string" ? note.title : "", body = typeof note.body === "string" ? note.body : "";
      const position = body.toLowerCase().indexOf(query);
      if (!title.toLowerCase().includes(query) && position < 0) continue;
      const item = { id: note.id, title: clip(title, 200), snippet: clip(body.slice(Math.max(0, position - 40)), 160) };
      if (result.results.length >= request.limit || responseBytes({ ...result, results: [...result.results, item] }) > MAX_PAGE_BYTES - 512) {
        result.hasMore = true; break;
      }
      result.results.push(item);
    }
    result.count = result.results.length;
    return result;
  }
  function validateResult(value, limit) {
    exact(value, ["results", "hasMore", "count"]);
    if (!Array.isArray(value.results) || value.results.length > limit || value.count !== value.results.length
      || typeof value.hasMore !== "boolean" || value.hasMore && !value.count
      || responseBytes({ ...value, nextCursor: "x".repeat(43) }) > MAX_PAGE_BYTES) fail("invalid_search_result");
    const ids = new Set();
    for (const item of value.results) {
      exact(item, ["id", "title", "snippet"]);
      if (typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)
        || typeof item.title !== "string" || Array.from(item.title).length > 200
        || typeof item.snippet !== "string" || Array.from(item.snippet).length > 160) fail("invalid_search_result");
      ids.add(item.id);
    }
    return value;
  }
  const api = { MAX_PAGE_BYTES, bytes, responseBytes, exact, scope, conditions, search, validateResult };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MemoNexusSearch = api;
})(typeof window !== "undefined" ? window : globalThis);
