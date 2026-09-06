(function initGeometryEditorUtils(globalScope) {
  "use strict";

  const geometryUtils = globalScope && globalScope.MemoNexusGeometryBlockUtils
    || (typeof require === "function" ? require("./geometry-block-utils.js") : null);
  if (!geometryUtils) throw new Error("MemoNexusGeometryBlockUtils is required");

  const { edgeCount, generatedEntityId, normalizeGeometryBlock } = geometryUtils;
  const RIGHT_ANGLE_MIN_DEGREES = 80;
  const RIGHT_ANGLE_MAX_DEGREES = 100;
  const RIGHT_ANGLE_ANGLE_EPSILON_DEGREES = 1e-9;
  const RIGHT_ANGLE_MIN_RAY_LENGTH = 1e-6;

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

  function screenPointToViewBox(svg, clientX, clientY, viewBox) {
    const source = viewBox || svg?.viewBox?.baseVal;
    if (!source) return { x: 0, y: 0 };
    const fallback = () => {
      const rect = svg?.getBoundingClientRect?.();
      if (!rect?.width || !rect?.height) return { x: source.x, y: source.y };
      const scale = Math.min(rect.width / source.width, rect.height / source.height);
      if (!Number.isFinite(scale) || scale <= 0) return { x: source.x, y: source.y };
      const renderedWidth = source.width * scale;
      const renderedHeight = source.height * scale;
      return {
        x: source.x + (clientX - rect.left - (rect.width - renderedWidth) / 2) / scale,
        y: source.y + (clientY - rect.top - (rect.height - renderedHeight) / 2) / scale
      };
    };
    try {
      const matrix = svg?.getScreenCTM?.();
      const inverse = matrix?.inverse?.();
      if (!inverse) return fallback();
      const Point = globalScope?.DOMPoint;
      const point = Point ? new Point(clientX, clientY).matrixTransform(inverse) : (() => {
        const svgPoint = svg?.createSVGPoint?.();
        if (!svgPoint) return null;
        svgPoint.x = clientX;
        svgPoint.y = clientY;
        return svgPoint.matrixTransform(inverse);
      })();
      return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? { x: point.x, y: point.y } : fallback();
    } catch (_) {
      return fallback();
    }
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

  function addCircle(geometry, centerPointId, radiusPointId) {
    if (!centerPointId || centerPointId === radiusPointId) throw new Error("円には中心と円周上の異なる2点を指定してください");
    const center = pointById(geometry, centerPointId);
    const radiusPoint = pointById(geometry, radiusPointId);
    if (!center || !radiusPoint) throw new Error("円の点が見つかりません");
    if (center.x === radiusPoint.x && center.y === radiusPoint.y) throw new Error("円には中心と異なる位置を指定してください");
    const next = copy(geometry);
    next.objects.push({ id: generatedEntityId("circle"), type: "circle", pointIds: [centerPointId, radiusPointId] });
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

  function moveObject(geometry, objectId, deltaX, deltaY) {
    const next = copy(geometry);
    const object = objectById(next, objectId);
    if (!object) throw new Error("図形が見つかりません");
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error("移動量が不正です");
    const pointIds = new Set(object.pointIds);
    next.points.forEach((point) => {
      if (!pointIds.has(point.id)) return;
      point.x += deltaX;
      point.y += deltaY;
    });
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

  function lengthLabel(geometry, objectId, edgeIndex = 0) {
    return geometry.annotations.find((annotation) => annotation.type === "length-label"
      && annotation.objectId === objectId && (annotation.edgeIndex || 0) === edgeIndex) || null;
  }

  function rightAngleDegrees(vertex, firstRay, secondRay) {
    const firstX = firstRay.x - vertex.x;
    const firstY = firstRay.y - vertex.y;
    const secondX = secondRay.x - vertex.x;
    const secondY = secondRay.y - vertex.y;
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    if (firstLength <= RIGHT_ANGLE_MIN_RAY_LENGTH || secondLength <= RIGHT_ANGLE_MIN_RAY_LENGTH) return null;
    const cosine = Math.max(-1, Math.min(1, (firstX * secondX + firstY * secondY) / (firstLength * secondLength)));
    const degrees = Math.acos(cosine) * 180 / Math.PI;
    return Number.isFinite(degrees) ? degrees : null;
  }

  function hasSameRightAngle(annotation, vertexId, rayVertexIds) {
    if (annotation.type !== "right-angle" || annotation.vertexId !== vertexId || !Array.isArray(annotation.rayVertexIds) || annotation.rayVertexIds.length !== 2) return false;
    return (annotation.rayVertexIds[0] === rayVertexIds[0] && annotation.rayVertexIds[1] === rayVertexIds[1])
      || (annotation.rayVertexIds[0] === rayVertexIds[1] && annotation.rayVertexIds[1] === rayVertexIds[0]);
  }

  function updateLengthLabel(geometry, objectId, label, edgeIndex = 0) {
    const next = copy(geometry);
    const object = objectById(next, objectId);
    if (!object || !["segment", "polygon"].includes(object.type)) throw new Error("辺を持つ図形が見つかりません");
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= edgeCount(object)) throw new Error("辺の指定が不正です");
    const annotation = lengthLabel(next, objectId, edgeIndex);
    if (annotation) annotation.label = String(label);
    else next.annotations.push({ id: generatedEntityId("length-label"), type: "length-label", objectId, edgeIndex, label: String(label) });
    return normalizeGeometryBlock(next, next.id);
  }

  // These helpers add semantic annotations only.  They intentionally do not
  // introduce a drawing UI: the SVG renderer derives every visible position
  // from the referenced vertices and segments.
  function addRightAngle(geometry, { vertexId, rayVertexIds, segmentIds, size } = {}) {
    if (!vertexId || !pointById(geometry, vertexId)) throw new Error("直角の頂点となる点が見つかりません");
    if (!Array.isArray(rayVertexIds) || rayVertexIds.length !== 2
      || new Set(rayVertexIds).size !== 2 || rayVertexIds.includes(vertexId)
      || rayVertexIds.some((pointId) => !pointById(geometry, pointId))) {
      throw new Error("直角には頂点と異なる2つの方向点を指定してください");
    }
    const vertex = pointById(geometry, vertexId);
    const [firstRay, secondRay] = rayVertexIds.map((pointId) => pointById(geometry, pointId));
    const degrees = rightAngleDegrees(vertex, firstRay, secondRay);
    if (degrees === null) throw new Error("頂点と方向点は異なる位置にしてください");
    if (degrees < RIGHT_ANGLE_MIN_DEGREES - RIGHT_ANGLE_ANGLE_EPSILON_DEGREES
      || degrees > RIGHT_ANGLE_MAX_DEGREES + RIGHT_ANGLE_ANGLE_EPSILON_DEGREES) {
      throw new Error(`直角記号は${RIGHT_ANGLE_MIN_DEGREES}度から${RIGHT_ANGLE_MAX_DEGREES}度の角度に追加できます`);
    }
    if (geometry.annotations.some((annotation) => hasSameRightAngle(annotation, vertexId, rayVertexIds))) {
      throw new Error("この直角記号は既に追加されています");
    }
    if (segmentIds !== undefined) {
      if (!Array.isArray(segmentIds) || segmentIds.length !== 2 || new Set(segmentIds).size !== 2
        || segmentIds.some((segmentId, index) => {
          const segment = objectById(geometry, segmentId);
          return !segment || segment.type !== "segment" || segment.pointIds.length !== 2
            || !segment.pointIds.includes(vertexId) || !segment.pointIds.includes(rayVertexIds[index]);
        })) {
        throw new Error("直角の線分参照が不正です");
      }
    }
    if (size !== undefined && (!Number.isFinite(size) || size <= 0)) throw new Error("直角記号の大きさが不正です");
    const next = copy(geometry);
    next.annotations.push({
      id: generatedEntityId("right-angle"), type: "right-angle", vertexId,
      rayVertexIds: Array.isArray(rayVertexIds) ? [...rayVertexIds] : rayVertexIds,
      pointIds: Array.isArray(rayVertexIds) ? [rayVertexIds[0], vertexId, rayVertexIds[1]] : undefined,
      ...(segmentIds === undefined ? {} : { segmentIds: [...segmentIds] }),
      ...(size === undefined ? {} : { size })
    });
    return normalizeGeometryBlock(next, next.id);
  }

  function addAngle(geometry, { vertexId, rayVertexIds, segmentIds, value, unit = "°", label = "", radius, labelOffsetX, labelOffsetY } = {}) {
    const next = copy(geometry);
    next.annotations.push({
      id: generatedEntityId("angle"), type: "angle", vertexId,
      rayVertexIds: Array.isArray(rayVertexIds) ? [...rayVertexIds] : rayVertexIds,
      pointIds: Array.isArray(rayVertexIds) ? [rayVertexIds[0], vertexId, rayVertexIds[1]] : undefined,
      ...(segmentIds === undefined ? {} : { segmentIds: [...segmentIds] }),
      ...(value === undefined ? {} : { value }), unit, label,
      ...(radius === undefined ? {} : { radius }),
      ...(labelOffsetX === undefined ? {} : { labelOffsetX }),
      ...(labelOffsetY === undefined ? {} : { labelOffsetY })
    });
    return normalizeGeometryBlock(next, next.id);
  }

  function addLengthAnnotation(geometry, { segmentId, value, unit = "", label = "", offsetX, offsetY } = {}) {
    const next = copy(geometry);
    next.annotations.push({
      id: generatedEntityId("length-label"), type: "length-label", objectId: segmentId, segmentId,
      value, unit, label,
      ...(offsetX === undefined ? {} : { offsetX }),
      ...(offsetY === undefined ? {} : { offsetY })
    });
    return normalizeGeometryBlock(next, next.id);
  }

  function addEqualLengthMark(geometry, { segmentIds, markCount = 1 } = {}) {
    const next = copy(geometry);
    next.annotations.push({ id: generatedEntityId("equal-length"), type: "equal-length", objectIds: Array.isArray(segmentIds) ? [...segmentIds] : segmentIds, markCount });
    return normalizeGeometryBlock(next, next.id);
  }

  function addParallelMark(geometry, { segmentIds, markCount = 1 } = {}) {
    const next = copy(geometry);
    next.annotations.push({ id: generatedEntityId("parallel"), type: "parallel", objectIds: Array.isArray(segmentIds) ? [...segmentIds] : segmentIds, markCount });
    return normalizeGeometryBlock(next, next.id);
  }

  function deleteSelection(geometry, selection) {
    if (!selection || !selection.id) return normalizeGeometryBlock(copy(geometry), geometry.id);
    const next = copy(geometry);
    if (selection.kind === "point") {
      next.points = next.points.filter((point) => point.id !== selection.id);
      next.objects = next.objects.filter((object) => !object.pointIds.includes(selection.id));
      const objectIds = new Set(next.objects.map((object) => object.id));
      next.annotations = next.annotations.filter((annotation) => annotation.vertexId !== selection.id
        && !(annotation.rayVertexIds || []).includes(selection.id)
        && annotation.pointId !== selection.id
        && !(annotation.pointIds || []).includes(selection.id)
        && (!annotation.objectId || objectIds.has(annotation.objectId))
        && !(annotation.objectIds || []).some((objectId) => !objectIds.has(objectId))
        && !(annotation.segmentIds || []).some((objectId) => !objectIds.has(objectId)));
    } else if (selection.kind === "object") {
      next.objects = next.objects.filter((object) => object.id !== selection.id);
      const objectIds = new Set(next.objects.map((object) => object.id));
      next.annotations = next.annotations.filter((annotation) => annotation.objectId !== selection.id
        && !(annotation.objectIds || []).includes(selection.id)
        && (!annotation.objectId || objectIds.has(annotation.objectId))
        && !(annotation.objectIds || []).some((objectId) => !objectIds.has(objectId))
        && !(annotation.segmentIds || []).some((objectId) => !objectIds.has(objectId)));
    } else if (selection.kind === "annotation") {
      next.annotations = next.annotations.filter((annotation) => annotation.id !== selection.id);
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

  const api = { RIGHT_ANGLE_MIN_DEGREES, RIGHT_ANGLE_MAX_DEGREES, pointName, screenPointToViewBox, pointById, objectById, vertexLabel, lengthLabel, edgeCount, addPoint, addSegment, addPolygon, addCircle, movePoint, moveObject, updateVertexLabel, updateSegmentLineStyle, updateLengthLabel, addRightAngle, addAngle, addLengthAnnotation, addEqualLengthMark, addParallelMark, deleteSelection, createHistory };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometryEditorUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
