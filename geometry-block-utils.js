(function initGeometryBlockUtils(globalScope) {
  "use strict";

  const GEOMETRY_BLOCK_VERSION = 1;
  const GEOMETRY_BLOCK_LIMITS = Object.freeze({
    points: 1000,
    objects: 1000,
    annotations: 2000,
    referencesPerItem: 1000,
    idChars: 128,
    labelChars: 500,
    captionChars: 4000,
    jsonBytes: 262144
  });
  const GEOMETRY_BLOCK_PATTERN = /^\s*<!-- memo-nexus:geometry-block:([0-9a-f]+) -->\s*$/i;
  const GEOMETRY_BLOCK_CANDIDATE_PATTERN = /^\s*<!-- memo-nexus:geometry-block:.* -->\s*$/i;
  const IMAGE_BLOCK_START = "<!-- memo-nexus:image-block -->";
  const IMAGE_BLOCK_END = "<!-- /memo-nexus:image-block -->";
  const OBJECT_TYPES = new Set(["segment", "polygon", "region"]);
  const SEGMENT_ROLES = new Set(["edge", "diagonal", "auxiliary"]);
  const ANNOTATION_TYPES = new Set([
    "right-angle", "angle", "equal-length", "parallel", "length-label", "vertex-label", "fill-region"
  ]);
  const FILL_STYLES = new Set(["primary", "secondary", "accent", "muted"]);
  const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function utf8ToHex(value) {
    return Array.from(new TextEncoder().encode(String(value)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function hexToUtf8(value) {
    const source = String(value || "");
    if (!source || source.length % 2 !== 0 || /[^0-9a-f]/i.test(source)) {
      throw new Error("幾何学ブロックのデータ形式が不正です");
    }
    if (source.length / 2 > GEOMETRY_BLOCK_LIMITS.jsonBytes) {
      throw new Error("幾何学ブロックのデータサイズが上限を超えています");
    }
    const bytes = new Uint8Array(source.length / 2);
    for (let index = 0; index < source.length; index += 2) {
      bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function normalizedId(value) {
    return value == null ? "" : String(value).trim();
  }

  function normalizedText(value) {
    return value == null ? "" : String(value).replace(/\r\n?/g, "\n");
  }

  function normalizedIdList(value) {
    return Array.isArray(value) && value.length <= GEOMETRY_BLOCK_LIMITS.referencesPerItem
      ? value.map(normalizedId)
      : value;
  }

  function normalizeLimitedArray(value, limit, normalizer) {
    if (value === undefined) return [];
    return Array.isArray(value) && value.length <= limit ? value.map(normalizer) : value;
  }

  function generatedGeometryId() {
    const cryptoScope = globalScope && globalScope.crypto;
    if (cryptoScope && typeof cryptoScope.randomUUID === "function") return `geometry-${cryptoScope.randomUUID()}`;
    return `geometry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizePoint(point) {
    const source = isRecord(point) ? point : {};
    return {
      id: normalizedId(source.id),
      x: source.x,
      y: source.y,
      label: normalizedText(source.label)
    };
  }

  function normalizeObject(object) {
    const source = isRecord(object) ? object : {};
    const normalized = {
      id: normalizedId(source.id),
      type: normalizedId(source.type),
      pointIds: normalizedIdList(source.pointIds)
    };
    if (normalized.type === "segment") normalized.role = source.role === undefined ? "edge" : normalizedId(source.role);
    return normalized;
  }

  function normalizeAnnotation(annotation) {
    const source = isRecord(annotation) ? annotation : {};
    const normalized = {
      id: normalizedId(source.id),
      type: normalizedId(source.type)
    };
    if (["right-angle", "angle"].includes(normalized.type)) normalized.pointIds = normalizedIdList(source.pointIds);
    if (["equal-length", "parallel"].includes(normalized.type)) {
      normalized.objectIds = normalizedIdList(source.objectIds);
      normalized.mark = source.mark === undefined ? 1 : source.mark;
    }
    if (["length-label", "fill-region"].includes(normalized.type)) normalized.objectId = normalizedId(source.objectId);
    if (normalized.type === "vertex-label") normalized.pointId = normalizedId(source.pointId);
    if (["angle", "length-label", "vertex-label"].includes(normalized.type)) normalized.label = normalizedText(source.label);
    if (["angle", "length-label"].includes(normalized.type) && source.value !== undefined) normalized.value = source.value;
    if (normalized.type === "fill-region") normalized.fill = source.fill === undefined ? "primary" : normalizedId(source.fill);
    return normalized;
  }

  function normalizeGeometryBlockUnchecked(value, fallbackId) {
    const source = isRecord(value) ? value : {};
    const sourceViewBox = source.viewBox === undefined ? {} : source.viewBox;
    return {
      type: source.type === undefined ? "geometry" : normalizedId(source.type),
      version: source.version === undefined ? GEOMETRY_BLOCK_VERSION : source.version,
      id: normalizedId(source.id) || normalizedId(fallbackId),
      caption: normalizedText(source.caption),
      viewBox: isRecord(sourceViewBox) ? {
        x: sourceViewBox.x === undefined ? 0 : sourceViewBox.x,
        y: sourceViewBox.y === undefined ? 0 : sourceViewBox.y,
        width: sourceViewBox.width === undefined ? 100 : sourceViewBox.width,
        height: sourceViewBox.height === undefined ? 100 : sourceViewBox.height
      } : sourceViewBox,
      points: normalizeLimitedArray(source.points, GEOMETRY_BLOCK_LIMITS.points, normalizePoint),
      objects: normalizeLimitedArray(source.objects, GEOMETRY_BLOCK_LIMITS.objects, normalizeObject),
      annotations: normalizeLimitedArray(source.annotations, GEOMETRY_BLOCK_LIMITS.annotations, normalizeAnnotation)
    };
  }

  function validateGeometryBlock(value) {
    const errors = [];
    let safelyMeasurable = true;
    const addError = (message) => errors.push(message);
    if (!isRecord(value)) return { valid: false, errors: ["幾何学ブロックはオブジェクトである必要があります"] };

    if (value.type !== "geometry") addError("typeはgeometryである必要があります");
    if (!Number.isInteger(value.version) || value.version !== GEOMETRY_BLOCK_VERSION) {
      addError(`version ${String(value.version)}には対応していません`);
    }

    const validateId = (id, path) => {
      if (typeof id !== "string" || !id.trim()) addError(`${path}のIDが空です`);
      else if (id.length > GEOMETRY_BLOCK_LIMITS.idChars) {
        addError(`${path}のIDが長すぎます`);
        safelyMeasurable = false;
      }
      else if (UNSAFE_CONTROL_CHARACTERS.test(id)) addError(`${path}のIDに制御文字を使用できません`);
    };
    const validateText = (text, path, limit) => {
      if (typeof text !== "string") addError(`${path}は文字列である必要があります`);
      else if (text.length > limit) {
        addError(`${path}が長すぎます`);
        safelyMeasurable = false;
      }
      else if (UNSAFE_CONTROL_CHARACTERS.test(text)) addError(`${path}に制御文字を使用できません`);
    };
    const validateFinite = (number, path) => {
      if (typeof number !== "number" || !Number.isFinite(number)) addError(`${path}は有限の数値である必要があります`);
    };
    const validateArray = (items, path, limit) => {
      if (!Array.isArray(items)) {
        addError(`${path}は配列である必要があります`);
        safelyMeasurable = false;
        return false;
      }
      if (items.length > limit) {
        addError(`${path}の件数が上限を超えています`);
        safelyMeasurable = false;
        return false;
      }
      return true;
    };
    const validateReferenceList = (ids, path, minimum, maximum, existingIds) => {
      if (!validateArray(ids, path, GEOMETRY_BLOCK_LIMITS.referencesPerItem)) return;
      if (ids.length < minimum || ids.length > maximum) addError(`${path}の参照数が不正です`);
      const seen = new Set();
      ids.forEach((id, index) => {
        validateId(id, `${path}[${index}]`);
        if (seen.has(id)) addError(`${path}に重複参照があります`);
        seen.add(id);
        if (!existingIds.has(id)) addError(`${path}[${index}]の参照先が存在しません`);
      });
    };
    const validateUniqueIds = (items, path) => {
      const seen = new Set();
      items.forEach((item, index) => {
        const id = item && item.id;
        validateId(id, `${path}[${index}]`);
        if (seen.has(id)) addError(`${path}に重複IDがあります: ${String(id)}`);
        seen.add(id);
      });
      return seen;
    };

    validateId(value.id, "ブロック");
    validateText(value.caption, "caption", GEOMETRY_BLOCK_LIMITS.captionChars);
    if (!isRecord(value.viewBox)) addError("viewBoxはオブジェクトである必要があります");
    else {
      ["x", "y", "width", "height"].forEach((key) => validateFinite(value.viewBox[key], `viewBox.${key}`));
      if (typeof value.viewBox.width === "number" && value.viewBox.width <= 0) addError("viewBox.widthは正の数である必要があります");
      if (typeof value.viewBox.height === "number" && value.viewBox.height <= 0) addError("viewBox.heightは正の数である必要があります");
    }

    const pointsValid = validateArray(value.points, "points", GEOMETRY_BLOCK_LIMITS.points);
    const objectsValid = validateArray(value.objects, "objects", GEOMETRY_BLOCK_LIMITS.objects);
    const annotationsValid = validateArray(value.annotations, "annotations", GEOMETRY_BLOCK_LIMITS.annotations);
    const points = pointsValid ? value.points : [];
    const objects = objectsValid ? value.objects : [];
    const annotations = annotationsValid ? value.annotations : [];
    const pointIds = validateUniqueIds(points, "points");
    const objectIds = validateUniqueIds(objects, "objects");
    validateUniqueIds(annotations, "annotations");

    points.forEach((point, index) => {
      if (!isRecord(point)) {
        addError(`points[${index}]はオブジェクトである必要があります`);
        return;
      }
      validateFinite(point.x, `points[${index}].x`);
      validateFinite(point.y, `points[${index}].y`);
      validateText(point.label, `points[${index}].label`, GEOMETRY_BLOCK_LIMITS.labelChars);
    });

    objects.forEach((object, index) => {
      if (!isRecord(object)) {
        addError(`objects[${index}]はオブジェクトである必要があります`);
        return;
      }
      if (!OBJECT_TYPES.has(object.type)) {
        addError(`objects[${index}].typeが不正です`);
        return;
      }
      if (object.type === "segment") {
        if (!SEGMENT_ROLES.has(object.role)) addError(`objects[${index}].roleが不正です`);
        validateReferenceList(object.pointIds, `objects[${index}].pointIds`, 2, 2, pointIds);
      } else {
        validateReferenceList(
          object.pointIds,
          `objects[${index}].pointIds`,
          3,
          GEOMETRY_BLOCK_LIMITS.referencesPerItem,
          pointIds
        );
      }
    });

    const objectById = new Map(objects.map((object) => [object && object.id, object]));
    annotations.forEach((annotation, index) => {
      if (!isRecord(annotation)) {
        addError(`annotations[${index}]はオブジェクトである必要があります`);
        return;
      }
      const path = `annotations[${index}]`;
      if (!ANNOTATION_TYPES.has(annotation.type)) {
        addError(`${path}.typeが不正です`);
        return;
      }
      if (["right-angle", "angle"].includes(annotation.type)) {
        validateReferenceList(annotation.pointIds, `${path}.pointIds`, 3, 3, pointIds);
      }
      if (["equal-length", "parallel"].includes(annotation.type)) {
        validateReferenceList(
          annotation.objectIds,
          `${path}.objectIds`,
          2,
          GEOMETRY_BLOCK_LIMITS.referencesPerItem,
          objectIds
        );
        if (Array.isArray(annotation.objectIds)) {
          annotation.objectIds.forEach((id) => {
            if (objectById.has(id) && objectById.get(id).type !== "segment") addError(`${path}は線分だけを参照できます`);
          });
        }
        if (!Number.isInteger(annotation.mark) || annotation.mark < 1 || annotation.mark > 10) {
          addError(`${path}.markは1から10の整数である必要があります`);
        }
      }
      if (["length-label", "fill-region"].includes(annotation.type)) {
        validateId(annotation.objectId, `${path}.objectId`);
        if (!objectIds.has(annotation.objectId)) addError(`${path}.objectIdの参照先が存在しません`);
      }
      if (annotation.type === "length-label" && objectById.has(annotation.objectId) && objectById.get(annotation.objectId).type !== "segment") {
        addError(`${path}は線分だけを参照できます`);
      }
      if (annotation.type === "fill-region" && objectById.has(annotation.objectId) && !["polygon", "region"].includes(objectById.get(annotation.objectId).type)) {
        addError(`${path}は多角形または領域だけを参照できます`);
      }
      if (annotation.type === "vertex-label") {
        validateId(annotation.pointId, `${path}.pointId`);
        if (!pointIds.has(annotation.pointId)) addError(`${path}.pointIdの参照先が存在しません`);
      }
      if (["angle", "length-label", "vertex-label"].includes(annotation.type)) {
        validateText(annotation.label, `${path}.label`, GEOMETRY_BLOCK_LIMITS.labelChars);
      }
      if (["angle", "length-label"].includes(annotation.type) && annotation.value !== undefined) {
        validateFinite(annotation.value, `${path}.value`);
      }
      if (annotation.type === "fill-region" && !FILL_STYLES.has(annotation.fill)) addError(`${path}.fillが不正です`);
    });

    if (safelyMeasurable) {
      try {
        const jsonBytes = new TextEncoder().encode(JSON.stringify(value)).length;
        if (jsonBytes > GEOMETRY_BLOCK_LIMITS.jsonBytes) addError("幾何学ブロックのJSONサイズが上限を超えています");
      } catch (_) {
        addError("幾何学ブロックをJSONへ変換できません");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function normalizeGeometryBlock(value, fallbackId) {
    const normalized = normalizeGeometryBlockUnchecked(value, fallbackId);
    const validation = validateGeometryBlock(normalized);
    if (!validation.valid) throw new Error(validation.errors[0]);
    return normalized;
  }

  function createGeometryBlock(id) {
    return normalizeGeometryBlock({
      type: "geometry",
      version: GEOMETRY_BLOCK_VERSION,
      id: normalizedId(id) || generatedGeometryId(),
      caption: "",
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
      points: [],
      objects: [],
      annotations: []
    });
  }

  function serializeGeometryBlock(geometry) {
    const normalized = normalizeGeometryBlock(geometry, geometry && geometry.id);
    return `<!-- memo-nexus:geometry-block:${utf8ToHex(JSON.stringify(normalized))} -->`;
  }

  function parseGeometryBlockLine(line) {
    const source = String(line || "");
    if (source.length > GEOMETRY_BLOCK_LIMITS.jsonBytes * 2 + 256) return null;
    const match = source.match(GEOMETRY_BLOCK_PATTERN);
    if (!match) return null;
    try {
      return normalizeGeometryBlock(JSON.parse(hexToUtf8(match[1])));
    } catch (_) {
      return null;
    }
  }

  function markdownLines(source) {
    const lines = [];
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    let match;
    while ((match = pattern.exec(source)) && match[0] !== "") {
      const full = match[0];
      const lineEndingMatch = full.match(/\r\n$|\r$|\n$/);
      const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "";
      lines.push({
        start: match.index,
        end: match.index + full.length,
        text: lineEnding ? full.slice(0, -lineEnding.length) : full,
        lineEnding
      });
    }
    return lines;
  }

  function scanGeometryLines(markdown, includeInvalidCandidates = false) {
    const source = String(markdown || "");
    const matches = [];
    let fence = null;
    let inImageBlock = false;
    markdownLines(source).forEach((line) => {
      const trimmed = line.text.trim();
      if (fence) {
        if (trimmed.length >= fence.length && [...trimmed].every((character) => character === fence.character)) fence = null;
        return;
      }
      const fenceMatch = line.text.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        return;
      }
      if (trimmed === IMAGE_BLOCK_START) {
        inImageBlock = true;
        return;
      }
      if (trimmed === IMAGE_BLOCK_END) {
        inImageBlock = false;
        return;
      }
      if (inImageBlock) return;
      const geometry = parseGeometryBlockLine(line.text);
      if (geometry || (includeInvalidCandidates && GEOMETRY_BLOCK_CANDIDATE_PATTERN.test(line.text))) {
        matches.push({ ...line, geometry });
      }
    });
    return { source, matches };
  }

  function splitGeometryBlocks(markdown) {
    const { source, matches } = scanGeometryLines(markdown);
    const segments = [];
    let textStart = 0;
    matches.forEach((match) => {
      if (match.start > textStart) {
        segments.push({ type: "text", text: source.slice(textStart, match.start), start: textStart, end: match.start });
      }
      segments.push({
        type: "geometry",
        geometry: match.geometry,
        start: match.start,
        end: match.end,
        raw: match.text
      });
      textStart = match.end;
    });
    if (textStart < source.length) segments.push({ type: "text", text: source.slice(textStart), start: textStart, end: source.length });
    return segments.length ? segments : [{ type: "text", text: source, start: 0, end: source.length }];
  }

  function insertGeometryBlock(markdown, selectionStart, selectionEnd, geometry) {
    const source = String(markdown || "");
    const requestedStart = Math.min(source.length, Math.max(0, Number(selectionStart) || 0));
    const requestedEnd = Math.min(source.length, Math.max(requestedStart, Number(selectionEnd) || requestedStart));
    const protectedBlocks = scanGeometryLines(source, true).matches;
    const safeBoundary = (position) => {
      const containingBlock = protectedBlocks.find((block) => position > block.start && position < block.end);
      return containingBlock ? containingBlock.end : position;
    };
    const start = safeBoundary(requestedStart);
    const end = Math.max(start, safeBoundary(requestedEnd));
    const marker = serializeGeometryBlock(geometry);
    const lineEnding = source.includes("\r\n") ? "\r\n" : (source.includes("\r") ? "\r" : "\n");
    const prefix = start > 0 && !/[\r\n]/.test(source[start - 1]) ? lineEnding : "";
    const suffix = end < source.length && !/[\r\n]/.test(source[end]) ? lineEnding : "";
    const insertedText = `${prefix}${marker}${suffix}`;
    return {
      value: `${source.slice(0, start)}${insertedText}${source.slice(end)}`,
      selectionStart: start + insertedText.length,
      selectionEnd: start + insertedText.length,
      insertedText
    };
  }

  function replaceGeometryBlock(markdown, block, geometry) {
    const source = String(markdown || "");
    if (!block || block.type !== "geometry" || source.slice(block.start, block.start + block.raw.length) !== block.raw) {
      throw new Error("幾何学ブロックが変更されたため更新できませんでした");
    }
    const replacement = geometry == null ? "" : serializeGeometryBlock(geometry);
    return `${source.slice(0, block.start)}${replacement}${source.slice(block.start + block.raw.length)}`;
  }

  const api = {
    GEOMETRY_BLOCK_VERSION,
    GEOMETRY_BLOCK_LIMITS,
    createGeometryBlock,
    normalizeGeometryBlock,
    validateGeometryBlock,
    serializeGeometryBlock,
    parseGeometryBlockLine,
    splitGeometryBlocks,
    insertGeometryBlock,
    replaceGeometryBlock
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometryBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
