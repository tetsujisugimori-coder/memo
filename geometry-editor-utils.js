(function initGeometryEditorUtils(globalScope) {
  "use strict";

  const geometryUtils = globalScope && globalScope.MemoNexusGeometryBlockUtils
    || (typeof require === "function" ? require("./geometry-block-utils.js") : null);
  if (!geometryUtils) throw new Error("MemoNexusGeometryBlockUtils is required");

  const { generatedEntityId, normalizeGeometryBlock } = geometryUtils;

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pointName(index) {
    let value = index;
    let result = "";
    do {
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return result;
  }

  function pointById(geometry, pointId) {
    return geometry.points.find((point) => point.id === pointId) || null;
  }

  function objectById(geometry, objectId) {
    return geometry.objects.find((object) => object.id === objectId) || null;
  }

  function vertexLabel(geometry, pointId) {
    return geometry.annotations.find((annotation) => annotation.type === "vertex-label" && annotation.pointId === pointId) || null;
  }

  function addPoint(geometry, { x, y, label = null, visible = true, style = "default" } = {}) {
    const next = copy(geometry);
    const point = { id: generatedEntityId("point"), x, y, visible, style };
    const name = label == null ? pointName(next.points.length) : String(label);
    next.points.push(point);
    next.annotations.push({
      id: generatedEntityId("vertex-label"), type: "vertex-label", pointId: point.id,
      label: name, offsetX: 8, offsetY: -8
    });
    return normalizeGeometryBlock(next, next.id);
  }

  function sameSegmentEndpoints(pointIds, candidate) {
    return candidate.type === "segment" && candidate.pointIds.length === 2
      && ((candidate.pointIds[0] === pointIds[0] && candidate.pointIds[1] === pointIds[1])
        || (candidate.pointIds[0] === pointIds[1] && candidate.pointIds[1] === pointIds[0]));
  }

  function addSegment(geometry, startPointId, endPointId, lineStyle = "solid") {
    if (!startPointId || startPointId === endPointId) throw new Error("線分には異なる2点を指定してください");
    if (!pointById(geometry, startPointId) || !pointById(geometry, endPointId)) throw new Error("線分の点が見つかりません");
    const pointIds = [startPointId, endPointId];
    if (geometry.objects.some((object) => sameSegmentEndpoints(pointIds, object))) {
      throw new Error("同じ2点を結ぶ線分は既にあります");
    }
    const next = copy(geometry);
    next.objects.push({ id: generatedEntityId("segment"), type: "segment", pointIds, role: "edge", lineStyle });
    return normalizeGeometryBlock(next, next.id);
  }

  function addPolygon(geometry, pointIds) {
    if (!Array.isArray(pointIds) || pointIds.length < 3) throw new Error("多角形には3点以上を指定してください");
    if (new Set(pointIds).size !== pointIds.length) throw new Error("多角形の頂点は重複できません");
    if (pointIds.some((pointId) => !pointById(geometry, pointId))) throw new Error("多角形の点が見つかりません");
    const next = copy(geometry);
    next.objects.push({ id: generatedEntityId("polygon"), type: "polygon", pointIds: [...pointIds] });
    return normalizeGeometryBlock(next, next.id);
  }

  function movePoint(geometry, pointId, x, y) {
    const next = copy(geometry);
    const point = pointById(next, pointId);
    if (!point) throw new Error("点が見つかりません");
    point.x = x;
    point.y = y;
    return normalizeGeometryBlock(next, next.id);
  }

  function updateVertexLabel(geometry, pointId, label) {
    const next = copy(geometry);
    if (!pointById(next, pointId)) throw new Error("点が見つかりません");
    const annotation = vertexLabel(next, pointId);
    if (annotation) annotation.label = String(label);
    else next.annotations.push({ id: generatedEntityId("vertex-label"), type: "vertex-label", pointId, label: String(label), offsetX: 8, offsetY: -8 });
    return normalizeGeometryBlock(next, next.id);
  }

  function updateSegmentLineStyle(geometry, objectId, lineStyle) {
    const next = copy(geometry);
    const segment = objectById(next, objectId);
    if (!segment || segment.type !== "segment") throw new Error("線分が見つかりません");
    segment.lineStyle = lineStyle;
    return normalizeGeometryBlock(next, next.id);
  }

  function deleteSelection(geometry, selection) {
    if (!selection || !selection.id) return normalizeGeometryBlock(copy(geometry), geometry.id);
    const next = copy(geometry);
    if (selection.kind === "point") {
      next.points = next.points.filter((point) => point.id !== selection.id);
      next.objects = next.objects.filter((object) => !object.pointIds.includes(selection.id));
      const objectIds = new Set(next.objects.map((object) => object.id));
      next.annotations = next.annotations.filter((annotation) => annotation.pointId !== selection.id
        && !(annotation.pointIds || []).includes(selection.id)
        && (!annotation.objectId || objectIds.has(annotation.objectId))
        && !(annotation.objectIds || []).some((objectId) => !objectIds.has(objectId)));
    } else if (selection.kind === "object") {
      next.objects = next.objects.filter((object) => object.id !== selection.id);
      const objectIds = new Set(next.objects.map((object) => object.id));
      next.annotations = next.annotations.filter((annotation) => annotation.objectId !== selection.id
        && !(annotation.objectIds || []).includes(selection.id)
        && (!annotation.objectId || objectIds.has(annotation.objectId))
        && !(annotation.objectIds || []).some((objectId) => !objectIds.has(objectId)));
    }
    return normalizeGeometryBlock(next, next.id);
  }

  function createHistory(initial) {
    const states = [copy(initial)];
    let index = 0;
    return {
      push(value) {
        states.splice(index + 1);
        states.push(copy(value));
        index = states.length - 1;
      },
      undo() { if (index > 0) index -= 1; return copy(states[index]); },
      redo() { if (index < states.length - 1) index += 1; return copy(states[index]); },
      get canUndo() { return index > 0; },
      get canRedo() { return index < states.length - 1; }
    };
  }

  const api = { pointName, pointById, objectById, vertexLabel, addPoint, addSegment, addPolygon, movePoint, updateVertexLabel, updateSegmentLineStyle, deleteSelection, createHistory };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometryEditorUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
