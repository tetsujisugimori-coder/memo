(function initGeometrySvgRenderer(globalScope) {
  "use strict";

  const svgNamespace = "http://www.w3.org/2000/svg";

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function stableById(items) {
    return Array.isArray(items)
      ? [...items].sort((first, second) => String(first?.id || "").localeCompare(String(second?.id || "")))
      : [];
  }

  function isFinitePoint(point) {
    return isRecord(point) && typeof point.id === "string" && point.id
      && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  // Saved blocks are normalized before they arrive here.  This small defensive
  // projection is intentionally read-only: it keeps one malformed item from
  // preventing the remaining valid geometry from being displayed, without
  // altering the persisted source.
  function buildGeometryRenderModel(value) {
    const source = isRecord(value) ? value : {};
    const sourceViewBox = isRecord(source.viewBox) ? source.viewBox : {};
    const viewBox = [sourceViewBox.x, sourceViewBox.y, sourceViewBox.width, sourceViewBox.height]
      .every(Number.isFinite) && sourceViewBox.width > 0 && sourceViewBox.height > 0
      ? sourceViewBox
      : { x: 0, y: 0, width: 100, height: 100 };
    const points = stableById(source.points).filter(isFinitePoint);
    const pointIds = new Set(points.map((point) => point.id));
    const objects = stableById(source.objects).filter((object) => {
      if (!isRecord(object) || typeof object.id !== "string" || !object.id || !Array.isArray(object.pointIds)) return false;
      const expectedCount = object.type === "segment" || object.type === "circle" ? 2 : object.type === "polygon" ? 3 : 0;
      return expectedCount && object.pointIds.length >= expectedCount
        && (object.type !== "polygon" || object.pointIds.length >= 3)
        && object.pointIds.every((pointId) => typeof pointId === "string" && pointIds.has(pointId));
    });
    const objectIds = new Set(objects.map((object) => object.id));
    const annotations = stableById(source.annotations).filter((annotation) => {
      if (!isRecord(annotation) || typeof annotation.id !== "string" || !annotation.id) return false;
      if (["right-angle", "angle"].includes(annotation.type)) {
        const rayVertexIds = Array.isArray(annotation.rayVertexIds)
          ? annotation.rayVertexIds
          : Array.isArray(annotation.pointIds) ? [annotation.pointIds[0], annotation.pointIds[2]] : null;
        return typeof annotation.vertexId === "string" && pointIds.has(annotation.vertexId)
          && Array.isArray(rayVertexIds) && rayVertexIds.length >= 2
          && rayVertexIds.slice(0, 2).every((pointId) => pointIds.has(pointId));
      }
      if (annotation.type === "length-label") return typeof annotation.objectId === "string" && objectIds.has(annotation.objectId);
      if (["equal-length", "parallel"].includes(annotation.type)) {
        return Array.isArray(annotation.objectIds) && annotation.objectIds.every((objectId) => objectIds.has(objectId));
      }
      return annotation.type === "vertex-label" && typeof annotation.pointId === "string" && pointIds.has(annotation.pointId);
    });
    return { ...source, viewBox, points, objects, annotations };
  }

  function svgElement(name, attributes = {}) {
    const element = globalScope.document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    });
    return element;
  }

  function labelForPoint(geometry, pointId, vertexLabel) {
    try {
      return vertexLabel?.(geometry, pointId)
        || geometry.annotations.find((annotation) => annotation.type === "vertex-label" && annotation.pointId === pointId)
        || null;
    } catch (_) {
      return null;
    }
  }

  function pointName(geometry, pointId, vertexLabel) {
    return labelForPoint(geometry, pointId, vertexLabel)?.label || pointId;
  }

  function pointMap(geometry) {
    return new Map(geometry.points.map((point) => [point.id, point]));
  }

  function unitVector(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return length ? { x: dx / length, y: dy / length } : null;
  }

  function annotationAnglePoints(annotation, points) {
    const legacy = annotation.pointIds || [];
    const vertexId = annotation.vertexId || legacy[1];
    const rayVertexIds = annotation.rayVertexIds || [legacy[0], legacy[2]];
    const vertex = points.get(vertexId);
    const first = points.get(rayVertexIds?.[0]);
    const second = points.get(rayVertexIds?.[1]);
    if (!vertex || !first || !second) return null;
    const firstDirection = unitVector(vertex, first);
    const secondDirection = unitVector(vertex, second);
    return firstDirection && secondDirection ? { vertexId, vertex, first, second, firstDirection, secondDirection } : null;
  }

  function edgePairs(object, points) {
    if (object.type === "segment") {
      const [start, end] = object.pointIds.map((id) => points.get(id));
      return start && end ? [{ start, end, edgeIndex: 0 }] : [];
    }
    if (object.type !== "polygon") return [];
    const vertices = object.pointIds.map((id) => points.get(id));
    return vertices.some((point) => !point) ? [] : vertices.map((start, edgeIndex) => ({ start, end: vertices[(edgeIndex + 1) % vertices.length], edgeIndex }));
  }

  function displayValue(annotation) {
    if (annotation.label) return annotation.label;
    return annotation.value === undefined ? "" : `${annotation.value}${annotation.unit || ""}`;
  }

  function semanticGroup(type, annotation, ariaLabel, { interactive = false, selected = false } = {}) {
    return svgElement("g", {
      class: `geometry-annotation geometry-${type}${selected ? " is-selected" : ""}`,
      "data-geometry-kind": "annotation",
      "data-geometry-type": type,
      "data-geometry-id": annotation.id,
      role: "img",
      "aria-label": ariaLabel,
      focusable: "false",
      "pointer-events": interactive ? "visiblePainted" : "none"
    });
  }

  function renderRightAngle(svg, annotation, geometry, points, vertexLabel, selection) {
    const angle = annotationAnglePoints(annotation, points);
    if (!angle) return;
    const size = annotation.size || 6;
    const p1 = { x: angle.vertex.x + angle.firstDirection.x * size, y: angle.vertex.y + angle.firstDirection.y * size };
    const corner = { x: p1.x + angle.secondDirection.x * size, y: p1.y + angle.secondDirection.y * size };
    const p2 = { x: angle.vertex.x + angle.secondDirection.x * size, y: angle.vertex.y + angle.secondDirection.y * size };
    const hitSize = Math.max(size, 12);
    const hitP1 = { x: angle.vertex.x + angle.firstDirection.x * hitSize, y: angle.vertex.y + angle.firstDirection.y * hitSize };
    const hitCorner = { x: hitP1.x + angle.secondDirection.x * hitSize, y: hitP1.y + angle.secondDirection.y * hitSize };
    const hitP2 = { x: angle.vertex.x + angle.secondDirection.x * hitSize, y: angle.vertex.y + angle.secondDirection.y * hitSize };
    const group = semanticGroup("right-angle", annotation, `頂点 ${pointName(geometry, angle.vertexId, vertexLabel)} の直角`, {
      interactive: true,
      selected: selection?.kind === "annotation" && selection.id === annotation.id
    });
    group.setAttribute("data-vertex-id", angle.vertexId);
    const path = `M ${p1.x} ${p1.y} L ${corner.x} ${corner.y} L ${p2.x} ${p2.y}`;
    const hitPath = `M ${hitP1.x} ${hitP1.y} L ${hitCorner.x} ${hitCorner.y} L ${hitP2.x} ${hitP2.y}`;
    group.append(
      svgElement("path", {
        d: hitPath,
        class: "geometry-right-angle-hit",
        fill: "none",
        stroke: "transparent",
        "stroke-width": 12,
        "pointer-events": "stroke",
        "data-geometry-kind": "annotation",
        "data-geometry-type": "right-angle",
        "data-geometry-id": annotation.id,
        "aria-hidden": "true"
      }),
      svgElement("path", { d: path, class: "geometry-right-angle-mark", fill: "none", "pointer-events": "none" })
    );
    svg.append(group);
  }

  function renderAngle(svg, annotation, geometry, points, vertexLabel) {
    const angle = annotationAnglePoints(annotation, points);
    if (!angle) return;
    const radius = annotation.radius || 12;
    const start = { x: angle.vertex.x + angle.firstDirection.x * radius, y: angle.vertex.y + angle.firstDirection.y * radius };
    const end = { x: angle.vertex.x + angle.secondDirection.x * radius, y: angle.vertex.y + angle.secondDirection.y * radius };
    const dot = Math.max(-1, Math.min(1, angle.firstDirection.x * angle.secondDirection.x + angle.firstDirection.y * angle.secondDirection.y));
    const cross = angle.firstDirection.x * angle.secondDirection.y - angle.firstDirection.y * angle.secondDirection.x;
    const degrees = Math.acos(dot) * 180 / Math.PI;
    const text = displayValue(annotation);
    const labelDirection = unitVector({ x: 0, y: 0 }, { x: angle.firstDirection.x + angle.secondDirection.x, y: angle.firstDirection.y + angle.secondDirection.y }) || { x: -angle.firstDirection.y, y: angle.firstDirection.x };
    const labelRadius = radius + 7;
    const labelX = angle.vertex.x + labelDirection.x * labelRadius + (annotation.labelOffsetX || 0);
    const labelY = angle.vertex.y + labelDirection.y * labelRadius + (annotation.labelOffsetY || 0);
    const name = pointName(geometry, angle.vertexId, vertexLabel);
    const group = semanticGroup("angle", annotation, `角 ${name}${text ? ` ${text}` : degrees ? ` ${Math.round(degrees)}度` : ""}`);
    group.setAttribute("data-vertex-id", angle.vertexId);
    group.append(svgElement("path", {
      d: `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${degrees > 180 ? 1 : 0} ${cross >= 0 ? 1 : 0} ${end.x} ${end.y}`,
      class: "geometry-angle-arc", fill: "none"
    }));
    if (text) {
      const label = svgElement("text", { x: labelX, y: labelY, class: "geometry-angle-label" });
      label.textContent = text;
      group.append(label);
    }
    svg.append(group);
  }

  function renderLengthLabel(svg, annotation, object, points) {
    const edge = edgePairs(object, points).find((entry) => entry.edgeIndex === (annotation.edgeIndex || 0));
    const text = displayValue(annotation);
    if (!edge || !text) return;
    const direction = unitVector(edge.start, edge.end);
    if (!direction) return;
    const normal = { x: -direction.y, y: direction.x };
    const x = (edge.start.x + edge.end.x) / 2 + normal.x * (annotation.offsetY || 0) + (annotation.offsetX || 0);
    const y = (edge.start.y + edge.end.y) / 2 + normal.y * (annotation.offsetY || 0);
    const group = semanticGroup("length-label", annotation, `辺の長さ ${text}`);
    group.setAttribute("data-segment-id", annotation.segmentId || annotation.objectId);
    const label = svgElement("text", { x, y, class: "geometry-length-label" });
    label.textContent = text;
    group.append(label);
    svg.append(group);
  }

  function renderEqualLength(svg, annotation, objects, points) {
    [...annotation.objectIds].sort().forEach((objectId) => {
      const object = objects.get(objectId);
      const edge = object && edgePairs(object, points)[0];
      if (!edge) return;
      const direction = unitVector(edge.start, edge.end);
      if (!direction) return;
      const normal = { x: -direction.y, y: direction.x };
      const center = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 };
      const group = semanticGroup("equal-length", annotation, `線分の等しい辺の印 ${annotation.markCount} 本`);
      group.setAttribute("data-segment-id", objectId);
      for (let index = 0; index < annotation.markCount; index += 1) {
        const shift = (index - (annotation.markCount - 1) / 2) * 3;
        const x = center.x + direction.x * shift;
        const y = center.y + direction.y * shift;
        group.append(svgElement("line", { x1: x - normal.x * 3.2, y1: y - normal.y * 3.2, x2: x + normal.x * 3.2, y2: y + normal.y * 3.2, class: "geometry-equal-length-mark" }));
      }
      svg.append(group);
    });
  }

  function renderParallel(svg, annotation, objects, points) {
    [...annotation.objectIds].sort().forEach((objectId) => {
      const object = objects.get(objectId);
      const edge = object && edgePairs(object, points)[0];
      if (!edge) return;
      const direction = unitVector(edge.start, edge.end);
      if (!direction) return;
      const normal = { x: -direction.y, y: direction.x };
      const center = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 };
      const group = semanticGroup("parallel", annotation, `線分の平行記号 ${annotation.markCount} 本`);
      group.setAttribute("data-segment-id", objectId);
      for (let index = 0; index < annotation.markCount; index += 1) {
        const shift = (index - (annotation.markCount - 1) / 2) * 5;
        const x = center.x + direction.x * shift;
        const y = center.y + direction.y * shift;
        group.append(svgElement("path", { d: `M ${x - direction.x * 3 - normal.x * 2} ${y - direction.y * 3 - normal.y * 2} L ${x + direction.x * 3} ${y + direction.y * 3} L ${x - direction.x * 3 + normal.x * 2} ${y - direction.y * 3 + normal.y * 2}`, class: "geometry-parallel-mark", fill: "none" }));
      }
      svg.append(group);
    });
  }

  function renderAnnotations(svg, geometry, points, objects, vertexLabel, selection) {
    geometry.annotations.forEach((annotation) => {
      if (annotation.type === "right-angle") renderRightAngle(svg, annotation, geometry, points, vertexLabel, selection);
      else if (annotation.type === "angle") renderAngle(svg, annotation, geometry, points, vertexLabel);
      else if (annotation.type === "length-label") {
        const object = objects.get(annotation.objectId);
        if (object) renderLengthLabel(svg, annotation, object, points);
      } else if (annotation.type === "equal-length") renderEqualLength(svg, annotation, objects, points);
      else if (annotation.type === "parallel") renderParallel(svg, annotation, objects, points);
    });
  }

  function renderGeometrySvg(svg, geometry, { selection = null, vertexLabel } = {}) {
    const renderModel = buildGeometryRenderModel(geometry);
    svg.replaceChildren();
    svg.setAttribute("viewBox", `${renderModel.viewBox.x} ${renderModel.viewBox.y} ${renderModel.viewBox.width} ${renderModel.viewBox.height}`);
    const points = pointMap(renderModel);
    const objects = new Map(renderModel.objects.map((object) => [object.id, object]));
    renderModel.objects.filter((object) => object.type === "polygon").forEach((polygon) => {
      const vertices = polygon.pointIds.map((id) => points.get(id));
      if (vertices.some((point) => !point)) return;
      svg.append(svgElement("polygon", {
        points: vertices.map((point) => `${point.x},${point.y}`).join(" "),
        class: `geometry-polygon${selection?.kind === "object" && selection.id === polygon.id ? " is-selected" : ""}`,
        fill: "transparent",
        "data-geometry-kind": "object",
        "data-geometry-type": "polygon",
        "data-geometry-id": polygon.id,
        "data-geometry-source-kind": "object",
        "data-geometry-source-type": "polygon",
        "data-geometry-source-id": polygon.id,
        "aria-label": "多角形"
      }));
    });
    renderModel.objects.filter((object) => object.type === "segment").forEach((segment) => {
      const [start, end] = segment.pointIds.map((id) => points.get(id));
      if (!start || !end) return;
      const semanticRole = segment.role || "edge";
      const dashed = segment.lineStyle === "dashed" || semanticRole === "auxiliary";
      const hitAttributes = { "data-geometry-kind": "object", "data-geometry-type": "segment", "data-geometry-id": segment.id, "data-segment-role": semanticRole };
      const displayAttributes = { "data-geometry-source-kind": "object", "data-geometry-source-type": "segment", "data-geometry-source-id": segment.id, "data-segment-role": semanticRole };
      svg.append(
        svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: "geometry-segment-hit", ...hitAttributes, "aria-label": `線分 ${pointName(renderModel, segment.pointIds[0], vertexLabel)}${pointName(renderModel, segment.pointIds[1], vertexLabel)}` }),
        svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: `geometry-segment${dashed ? " is-dashed" : ""}${selection?.kind === "object" && selection.id === segment.id ? " is-selected" : ""}`, ...displayAttributes, "pointer-events": "none" })
      );
    });
    renderModel.objects.filter((object) => object.type === "circle").forEach((circle) => {
      const [center, radiusPoint] = circle.pointIds.map((id) => points.get(id));
      if (!center || !radiusPoint) return;
      const radius = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y);
      if (!Number.isFinite(radius) || radius <= 0) return;
      const hitAttributes = { "data-geometry-kind": "object", "data-geometry-type": "circle", "data-geometry-id": circle.id };
      const displayAttributes = { "data-geometry-source-kind": "object", "data-geometry-source-type": "circle", "data-geometry-source-id": circle.id };
      svg.append(
        svgElement("circle", { cx: center.x, cy: center.y, r: radius, fill: "none", class: "geometry-circle-hit", ...hitAttributes, "aria-label": "円" }),
        svgElement("circle", { cx: center.x, cy: center.y, r: radius, class: `geometry-circle${selection?.kind === "object" && selection.id === circle.id ? " is-selected" : ""}`, fill: "transparent", ...displayAttributes, "pointer-events": "none" })
      );
    });
    renderAnnotations(svg, renderModel, points, objects, vertexLabel, selection);
    renderModel.points.forEach((point) => {
      if (!point.visible) return;
      const name = pointName(renderModel, point.id, vertexLabel);
      const hitAttributes = { "data-geometry-kind": "point", "data-geometry-type": "vertex", "data-geometry-id": point.id };
      const displayAttributes = { "data-geometry-source-kind": "point", "data-geometry-source-type": "vertex", "data-geometry-source-id": point.id };
      svg.append(
        svgElement("circle", { cx: point.x, cy: point.y, r: 5, class: "geometry-point-hit", ...hitAttributes, "aria-label": `頂点 ${name}` }),
        svgElement("circle", { cx: point.x, cy: point.y, r: 1.8, class: `geometry-point${selection?.kind === "point" && selection.id === point.id ? " is-selected" : ""}`, ...displayAttributes, "pointer-events": "none" })
      );
      const label = labelForPoint(renderModel, point.id, vertexLabel);
      if (label?.label) {
        const text = svgElement("text", { x: point.x + label.offsetX, y: point.y + label.offsetY, class: "geometry-label", "data-geometry-kind": "annotation", "data-geometry-type": "vertex-label", "data-geometry-id": label.id, "data-point-id": point.id, "pointer-events": "none", "aria-hidden": "true" });
        text.textContent = label.label;
        svg.append(text);
      }
    });
  }

  const api = { annotationAnglePoints, buildGeometryRenderModel, displayValue, renderGeometrySvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometrySvgRenderer = api;
})(typeof window !== "undefined" ? window : globalThis);
