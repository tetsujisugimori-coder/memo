(function initMemoNexusTags(global) {
  "use strict";

  const DEFAULT_TAG_COLOR = "#6f8372";

  function normalizeTagId(value) {
    if (value == null) return null;
    const id = String(value).trim().toLowerCase();
    return id || null;
  }

  function normalizeTagName(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function normalizeTagDate(value) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeTagIds(value) {
    const normalized = [];
    const seen = new Set();
    (Array.isArray(value) ? value : []).forEach((tag) => {
      const id = normalizeTagId(tag);
      if (!id || seen.has(id)) return;
      seen.add(id);
      normalized.push(id);
    });
    return normalized;
  }

  function normalizeTagDefinitions(value) {
    const definitions = [];
    const seen = new Set();
    (Array.isArray(value) ? value : []).forEach((item) => {
      const source = item && typeof item === "object" ? item : { id: item, name: item };
      const id = normalizeTagId(source.id ?? source.name);
      if (!id || seen.has(id)) return;
      const name = normalizeTagName(source.name) || id;
      seen.add(id);
      definitions.push({
        ...source,
        id,
        name,
        createdAt: normalizeTagDate(source.createdAt),
        updatedAt: normalizeTagDate(source.updatedAt) || normalizeTagDate(source.createdAt)
      });
    });
    return definitions.sort((a, b) => a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id, "ja"));
  }

  function findTagDefinition(definitions, value) {
    const id = normalizeTagId(value);
    if (!id) return null;
    return normalizeTagDefinitions(definitions).find((definition) => definition.id === id) || null;
  }

  function isRegisteredTag(definitions, value) {
    return Boolean(findTagDefinition(definitions, value));
  }

  function restrictTagIds(value, definitions) {
    const registered = new Set(normalizeTagDefinitions(definitions).map((definition) => definition.id));
    return normalizeTagIds(value).filter((id) => registered.has(id));
  }

  function assignRegisteredTag(value, tagId, definitions) {
    const current = restrictTagIds(value, definitions);
    const id = normalizeTagId(tagId);
    if (!id || !isRegisteredTag(definitions, id) || current.includes(id)) return current;
    return [...current, id];
  }

  function removeMemoTag(value, tagId) {
    const id = normalizeTagId(tagId);
    return normalizeTagIds(value).filter((item) => item !== id);
  }

  function normalizedTimestamp(now) {
    const date = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function createTagDefinition(name, definitions, now) {
    const normalizedName = normalizeTagName(name);
    const id = normalizeTagId(normalizedName);
    if (!id) return { status: "invalid", definition: null };
    const existing = findTagDefinition(definitions, id);
    if (existing) return { status: "exists", definition: existing };
    const timestamp = normalizedTimestamp(now);
    return {
      status: "created",
      definition: { id, name: normalizedName, createdAt: timestamp, updatedAt: timestamp }
    };
  }

  function mergeTagDefinitionsFromNotes(definitions, notes, now) {
    const merged = normalizeTagDefinitions(definitions);
    const known = new Set(merged.map((definition) => definition.id));
    const timestamp = normalizedTimestamp(now);
    (Array.isArray(notes) ? notes : []).forEach((note) => {
      normalizeTagIds(note?.tags).forEach((id) => {
        if (known.has(id)) return;
        known.add(id);
        merged.push({ id, name: id, createdAt: timestamp, updatedAt: timestamp });
      });
    });
    return normalizeTagDefinitions(merged);
  }

  function mergeTagDefinitions(existingDefinitions, importedDefinitions) {
    const merged = new Map(normalizeTagDefinitions(existingDefinitions).map((definition) => [definition.id, definition]));
    normalizeTagDefinitions(importedDefinitions).forEach((incoming) => {
      const existing = merged.get(incoming.id);
      if (!existing) {
        merged.set(incoming.id, incoming);
        return;
      }
      const existingUpdatedAt = normalizeTagDate(existing.updatedAt);
      const incomingUpdatedAt = normalizeTagDate(incoming.updatedAt);
      if (!existingUpdatedAt || !incomingUpdatedAt) return;
      if (Date.parse(incomingUpdatedAt) > Date.parse(existingUpdatedAt)) merged.set(incoming.id, incoming);
    });
    return normalizeTagDefinitions([...merged.values()]);
  }

  function countTagUsage(definitions, notes) {
    const counts = new Map(normalizeTagDefinitions(definitions).map((definition) => [definition.id, 0]));
    (Array.isArray(notes) ? notes : []).filter((note) => !note?.deletedAt).forEach((note) => {
      normalizeTagIds(note?.tags).forEach((id) => {
        if (counts.has(id)) counts.set(id, counts.get(id) + 1);
      });
    });
    return counts;
  }

  function filterMemosByTag(notes, selectedTagId, selectedCollectionId = null) {
    const id = normalizeTagId(selectedTagId);
    if (!id) return Array.isArray(notes) ? [...notes] : [];
    const collectionScoped = selectedCollectionId && selectedCollectionId !== "trash";
    return (Array.isArray(notes) ? notes : []).filter((note) => {
      if (collectionScoped && note?.collectionId !== selectedCollectionId) return false;
      return normalizeTagIds(note?.tags).includes(id);
    });
  }

  function searchTagOptions(definitions, query = "", excludedTagIds = []) {
    const normalizedQuery = normalizeTagName(query).toLowerCase();
    const excluded = new Set(normalizeTagIds(excludedTagIds));
    return normalizeTagDefinitions(definitions).filter((definition) => {
      if (excluded.has(definition.id)) return false;
      if (!normalizedQuery) return true;
      return definition.id.includes(normalizedQuery) || definition.name.toLowerCase().includes(normalizedQuery);
    });
  }

  function tagNameForId(definitions, tagId) {
    const id = normalizeTagId(tagId);
    return findTagDefinition(definitions, id)?.name || id || "";
  }

  function normalizeTagColor(value, fallback = DEFAULT_TAG_COLOR) {
    const color = typeof value === "string" ? value.trim() : "";
    if (!color) return fallback;
    if (global.CSS?.supports?.("color", color)) return color;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
    return fallback;
  }

  function tagColorForId(definitions, tagId) {
    return normalizeTagColor(findTagDefinition(definitions, tagId)?.color);
  }

  function summarizeTagIds(value, limit = 3) {
    const tagIds = normalizeTagIds(value);
    const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 3;
    return {
      visibleTagIds: tagIds.slice(0, safeLimit),
      hiddenCount: Math.max(0, tagIds.length - safeLimit)
    };
  }

  const api = {
    DEFAULT_TAG_COLOR,
    assignRegisteredTag,
    countTagUsage,
    createTagDefinition,
    filterMemosByTag,
    findTagDefinition,
    isRegisteredTag,
    mergeTagDefinitions,
    mergeTagDefinitionsFromNotes,
    normalizeMemoTags: normalizeTagIds,
    normalizeTagDefinitions,
    normalizeTagColor,
    normalizeTagDate,
    normalizeTagFilter: normalizeTagId,
    normalizeTagId,
    normalizeTagIds,
    normalizeTagName,
    removeMemoTag,
    restrictTagIds,
    searchTagOptions,
    summarizeTagIds,
    tagColorForId,
    tagNameForId
  };

  global.MemoNexusTags = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
