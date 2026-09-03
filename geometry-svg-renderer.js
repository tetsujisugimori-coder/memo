(function initGeometrySvgRenderer(globalScope) {
  "use strict";

  const svgNamespace = "http://www.w3.org/2000/svg";

  function svgElement(name, attributes = {}) {
    const element = globalScope.document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    });
    return element;
  }

  function pointName(geometry, pointId, vertexLabel) {
    return vertexLabel?.(geometry, pointId)?.label || pointId;
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

  function semanticGroup(type, annotation, ariaLabel) {
    return svgElement("g", {
      class: `geometry-annotation geometry-${type}`,
      "data-geometry-type": type,
      "data-geometry-id": annotation.id,
      role: "img",
      "aria-label": ariaLabel,
      focusable: "false",
      "pointer-events": "none"
    });
  }

  function renderRightAngle(svg, annotation, geometry, points, vertexLabel) {
    const angle = annotationAnglePoints(annotation, points);
    if (!angle) return;
    const size = annotation.size || 6;
    const p1 = { x: angle.vertex.x + angle.firstDirection.x * size, y: angle.vertex.y + angle.firstDirection.y * size };
    const corner = { x: p1.x + angle.secondDirection.x * size, y: p1.y + angle.secondDirection.y * size };
    const p2 = { x: angle.vertex.x + angle.secondDirection.x * size, y: angle.vertex.y + angle.secondDirection.y * size };
    const group = semanticGroup("right-angle", annotation, `頂点 ${pointName(geometry, angle.vertexId, vertexLabel)} の直角`);
    group.setAttribute("data-vertex-id", angle.vertexId);
    group.append(svgElement("path", { d: `M ${p1.x} ${p1.y} L ${corner.x} ${corner.y} L ${p2.x} ${p2.y}`, class: "geometry-right-angle-mark", fill: "none" }));
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
    annotation.objectIds.forEach((objectId) => {
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
    annotation.objectIds.forEach((objectId) => {
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

  function renderAnnotations(svg, geometry, points, objects, vertexLabel) {
    geometry.annotations.forEach((annotation) => {
      if (annotation.type === "right-angle") renderRightAngle(svg, annotation, geometry, points, vertexLabel);
      else if (annotation.type === "angle") renderAngle(svg, annotation, geometry, points, vertexLabel);
      else if (annotation.type === "length-label") {
        const object = objects.get(annotation.objectId);
        if (object) renderLengthLabel(svg, annotation, object, points);
      } else if (annotation.type === "equal-length") renderEqualLength(svg, annotation, objects, points);
      else if (annotation.type === "parallel") renderParallel(svg, annotation, objects, points);
    });
  }

  function renderGeometrySvg(svg, geometry, { selection = null, vertexLabel } = {}) {
    svg.replaceChildren();
    svg.setAttribute("viewBox", `${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`);
    const points = pointMap(geometry);
    const objects = new Map(geometry.objects.map((object) => [object.id, object]));
    geometry.objects.filter((object) => object.type === "polygon").forEach((polygon) => {
      const vertices = polygon.pointIds.map((id) => points.get(id));
      if (vertices.some((point) => !point)) return;
      svg.append(svgElement("polygon", { points: vertices.map((point) => `${point.x},${point.y}`).join(" "), class: `geometry-polygon${selection?.kind === "object" && selection.id === polygon.id ? " is-selected" : ""}`, fill: "transparent", "data-geometry-kind": "object", "data-geometry-type": "polygon", "data-geometry-id": polygon.id, "aria-label": "多角形" }));
    });
    geometry.objects.filter((object) => object.type === "segment").forEach((segment) => {
      const [start, end] = segment.pointIds.map((id) => points.get(id));
      if (!start || !end) return;
      const semanticRole = segment.role || "edge";
      const dashed = segment.lineStyle === "dashed" || semanticRole === "auxiliary";
      svg.append(
        svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: "geometry-segment-hit", "data-geometry-kind": "object", "data-geometry-type": "segment", "data-geometry-id": segment.id, "data-segment-role": semanticRole, "aria-label": `線分 ${pointName(geometry, segment.pointIds[0], vertexLabel)}${pointName(geometry, segment.pointIds[1], vertexLabel)}` }),
        svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: `geometry-segment${dashed ? " is-dashed" : ""}${selection?.kind === "object" && selection.id === segment.id ? " is-selected" : ""}`, "pointer-events": "none" })
      );
    });
    geometry.objects.filter((object) => object.type === "circle").forEach((circle) => {
      const [center, radiusPoint] = circle.pointIds.map((id) => points.get(id));
      if (!center || !radiusPoint) return;
      const radius = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y);
      svg.append(
        svgElement("circle", { cx: center.x, cy: center.y, r: radius, fill: "none", class: "geometry-circle-hit", "data-geometry-kind": "object", "data-geometry-type": "circle", "data-geometry-id": circle.id, "aria-label": "円" }),
        svgElement("circle", { cx: center.x, cy: center.y, r: radius, class: `geometry-circle${selection?.kind === "object" && selection.id === circle.id ? " is-selected" : ""}`, fill: "transparent", "pointer-events": "none" })
      );
    });
    renderAnnotations(svg, geometry, points, objects, vertexLabel);
    geometry.points.forEach((point) => {
      if (!point.visible) return;
      const name = pointName(geometry, point.id, vertexLabel);
      svg.append(
        svgElement("circle", { cx: point.x, cy: point.y, r: 5, class: "geometry-point-hit", "data-geometry-kind": "point", "data-geometry-type": "vertex", "data-geometry-id": point.id, "aria-label": `頂点 ${name}` }),
        svgElement("circle", { cx: point.x, cy: point.y, r: 1.8, class: `geometry-point${selection?.kind === "point" && selection.id === point.id ? " is-selected" : ""}`, "data-geometry-id": point.id, "pointer-events": "none" })
      );
      const label = vertexLabel?.(geometry, point.id);
      if (label?.label) {
        const text = svgElement("text", { x: point.x + label.offsetX, y: point.y + label.offsetY, class: "geometry-label", "pointer-events": "none", "aria-hidden": "true" });
        text.textContent = label.label;
        svg.append(text);
      }
    });
  }

  const api = { annotationAnglePoints, displayValue, renderGeometrySvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometrySvgRenderer = api;
})(typeof window !== "undefined" ? window : globalThis);
