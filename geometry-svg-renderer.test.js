const assert = require("node:assert/strict");
const { test } = require("node:test");
const { cloneGeometryBlock, createGeometryBlock, parseGeometryBlockLine, serializeGeometryBlock } = require("./geometry-block-utils.js");
const {
  addAngle, addCircle, addEqualLengthMark, addLengthAnnotation, addParallelMark, addPoint,
  addPolygon, addRightAngle, addSegment, deleteSelection, movePoint, updateFillRegion, updateLengthLabel, updateLengthLabelPlacement, updateVertexLabel
} = require("./geometry-editor-utils.js");

class MockElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.classList = { add: () => {} };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function pathPoints(path) {
  const raw = path.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const values = raw.map(Number);
  const points = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    points.push({ x: values[i], y: values[i + 1] });
  }
  return points;
}

function distance(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

test("塗り領域は最背面で1つの非操作DOMとして描画し、頂点移動へ追従する", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    let geometry = createGeometryBlock("fill-renderer");
    [[10, 10], [80, 10], [40, 70]].forEach(([x, y]) => { geometry = addPoint(geometry, { x, y }); });
    geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
    const polygon = geometry.objects[0];
    geometry = updateFillRegion(geometry, polygon.id, "accent");
    const annotation = geometry.annotations.find((entry) => entry.type === "fill-region");
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry);
    const group = descendants(svg).find((node) => node.name === "g" && node.getAttribute("data-geometry-id") === annotation.id);
    const fill = group.children[0];
    assert.equal(svg.children[0], group, "塗りを多角形輪郭より前に描画しない");
    assert.deepEqual({ kind: group.getAttribute("data-geometry-kind"), type: group.getAttribute("data-geometry-type"), id: group.getAttribute("data-geometry-id"), objectId: group.getAttribute("data-object-id"), fill: group.getAttribute("data-fill-style"), pointerEvents: group.getAttribute("pointer-events") }, { kind: "annotation", type: "fill-region", id: annotation.id, objectId: polygon.id, fill: "accent", pointerEvents: "none" });
    assert.equal(fill.getAttribute("data-geometry-kind"), null, "子polygonへ意味上の識別情報を重複しない");
    assert.equal(fill.getAttribute("pointer-events"), "none", "塗り面は操作を奪わない");
    assert.match(fill.getAttribute("class"), /geometry-fill-accent/, "既知の塗りだけ安全な表示クラスへ対応する");
    const before = fill.getAttribute("points");
    renderGeometrySvg(svg, movePoint(geometry, geometry.points[2].id, 55, 75));
    const moved = descendants(svg).find((node) => node.name === "g" && node.getAttribute("data-geometry-id") === annotation.id).children[0];
    assert.notEqual(moved.getAttribute("points"), before, "最新の頂点座標から塗りpolygonを再構築する");
  } finally {
    global.document = priorDocument;
  }
});

test("不正な塗り参照や未知のスタイルは他の図形を止めず、region参照は維持する", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { buildGeometryRenderModel, renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const geometry = {
      ...createGeometryBlock("fill-safe"),
      points: [{ id: "a", x: 0, y: 0, visible: true, style: "default" }, { id: "b", x: 40, y: 0, visible: true, style: "default" }, { id: "c", x: 20, y: 30, visible: true, style: "default" }],
      objects: [{ id: "polygon", type: "polygon", pointIds: ["a", "b", "c"] }, { id: "region", type: "region", pointIds: ["a", "b", "c"] }, { id: "edge", type: "segment", pointIds: ["a", "b"], role: "edge", lineStyle: "solid" }],
      annotations: [{ id: "valid-region", type: "fill-region", objectId: "region", fill: "secondary" }, { id: "unknown-fill", type: "fill-region", objectId: "polygon", fill: "unsafe class" }, { id: "bad-ref", type: "fill-region", objectId: "missing", fill: "primary" }]
    };
    assert.deepEqual(buildGeometryRenderModel(geometry).annotations.map((entry) => entry.id), ["valid-region"], "正当なregionだけを防御的絞り込みから落とさない");
    const svg = new MockElement("svg");
    assert.doesNotThrow(() => renderGeometrySvg(svg, geometry));
    assert.equal(descendants(svg).some((node) => node.getAttribute("data-geometry-id") === "edge"), true, "不正な塗りがあっても他の図形を描画する");
    assert.equal(descendants(svg).filter((node) => node.getAttribute("data-geometry-type") === "fill-region").length, 1, "正当な塗りを1回だけ描画する");
  } finally {
    global.document = priorDocument;
  }
});

function svgSnapshot(svg) {
  return descendants(svg).map((node) => ({ name: node.name, attributes: Object.fromEntries(node.attributes) }));
}

function semanticTriangle() {
  let geometry = createGeometryBlock("semantic-triangle");
  geometry = addPoint(geometry, { x: 10, y: 70 });
  geometry = addPoint(geometry, { x: 10, y: 10 });
  geometry = addPoint(geometry, { x: 70, y: 10 });
  geometry = updateVertexLabel(geometry, geometry.points[0].id, "A");
  geometry = updateVertexLabel(geometry, geometry.points[1].id, "B");
  geometry = updateVertexLabel(geometry, geometry.points[2].id, "C");
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
  geometry = addSegment(geometry, geometry.points[1].id, geometry.points[2].id);
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[2].id, "dashed");
  const [ab, bc, ac] = geometry.objects;
  geometry = addRightAngle(geometry, { vertexId: geometry.points[1].id, rayVertexIds: [geometry.points[0].id, geometry.points[2].id], segmentIds: [ab.id, bc.id] });
  geometry = addAngle(geometry, { vertexId: geometry.points[1].id, rayVertexIds: [geometry.points[0].id, geometry.points[2].id], segmentIds: [ab.id, bc.id], value: 90, unit: "°" });
  geometry = addLengthAnnotation(geometry, { segmentId: ab.id, value: 5, unit: "cm" });
  geometry = addEqualLengthMark(geometry, { segmentIds: [ab.id, bc.id], markCount: 2 });
  geometry = addParallelMark(geometry, { segmentIds: [ab.id, ac.id], markCount: 1 });
  return geometry;
}

test("意味付き注釈は参照ID・表示値・単位を保ったまま直列化できる", () => {
  const geometry = semanticTriangle();
  const restored = parseGeometryBlockLine(serializeGeometryBlock(geometry));
  const rightAngle = restored.annotations.find((annotation) => annotation.type === "right-angle");
  const angle = restored.annotations.find((annotation) => annotation.type === "angle");
  const length = restored.annotations.find((annotation) => annotation.type === "length-label");
  assert.equal(rightAngle.vertexId, restored.points[1].id);
  assert.deepEqual(rightAngle.segmentIds, restored.objects.slice(0, 2).map((object) => object.id));
  assert.equal(angle.value, 90);
  assert.equal(angle.unit, "°");
  assert.equal(length.segmentId, restored.objects[0].id);
  assert.equal(length.value, 5);
  assert.equal(length.unit, "cm");
  assert.equal(restored.annotations.find((annotation) => annotation.type === "equal-length").markCount, 2);
});

test("意味付き注釈の線分参照は複製・削除時にもID整合性を保つ", () => {
  const geometry = semanticTriangle();
  const copied = cloneGeometryBlock(geometry);
  const copiedAngle = copied.annotations.find((annotation) => annotation.type === "angle");
  assert.equal(copiedAngle.segmentIds.every((id) => copied.objects.some((object) => object.id === id)), true);
  assert.equal(copiedAngle.segmentIds.some((id) => geometry.objects.some((object) => object.id === id)), false);
  const afterDelete = deleteSelection(geometry, { kind: "object", id: geometry.objects[0].id });
  assert.equal(afterDelete.annotations.some((annotation) => annotation.type === "right-angle" || annotation.type === "angle"), false);
});

test("辺の長さ表示は水平・垂直・斜めで安定した法線側に描画し、反対側と線分方向位置を反映する", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    let geometry = createGeometryBlock("length-label-placement");
    [[10, 10], [50, 10], [70, 10], [70, 50], [10, 40], [50, 80], [50, 90], [10, 90]].forEach(([x, y]) => { geometry = addPoint(geometry, { x, y }); });
    [[0, 1], [2, 3], [4, 5], [6, 7]].forEach(([start, end]) => { geometry = addSegment(geometry, geometry.points[start].id, geometry.points[end].id); });
    geometry.objects.forEach((segment, index) => { geometry = updateLengthLabel(geometry, segment.id, ["5 cm", "a", "x + 2", "r"][index]); });
    const horizontal = geometry.annotations.find((annotation) => annotation.objectId === geometry.objects[0].id);
    geometry = updateLengthLabelPlacement(geometry, horizontal.id, { side: "negative", alongOffset: 5 });
    geometry = addEqualLengthMark(geometry, { segmentIds: [geometry.objects[0].id, geometry.objects[1].id], markCount: 1 });
    geometry = addParallelMark(geometry, { segmentIds: [geometry.objects[0].id, geometry.objects[2].id], markCount: 1 });
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry, { selection: { kind: "annotation", id: horizontal.id } });
    const label = (objectId) => {
      const annotation = geometry.annotations.find((entry) => entry.objectId === objectId);
      const group = descendants(svg).find((node) => node.name === "g" && node.getAttribute("data-geometry-id") === annotation.id);
      return group?.children.find((node) => node.getAttribute("class") === "geometry-length-label");
    };
    const horizontalLabel = label(geometry.objects[0].id);
    const verticalLabel = label(geometry.objects[1].id);
    const diagonalLabel = label(geometry.objects[2].id);
    const reversedLabel = label(geometry.objects[3].id);
    assert.deepEqual({ x: Number(horizontalLabel.getAttribute("x")), y: Number(horizontalLabel.getAttribute("y")) }, { x: 35, y: 2 }, "水平辺は反対側と線分方向位置を反映する");
    assert.deepEqual({ x: Number(verticalLabel.getAttribute("x")), y: Number(verticalLabel.getAttribute("y")) }, { x: 62, y: 30 }, "垂直辺は中点の法線側へ置く");
    assert.ok(Math.abs(Number(diagonalLabel.getAttribute("x")) - (30 - 8 / Math.sqrt(2))) < 1e-9);
    assert.ok(Math.abs(Number(diagonalLabel.getAttribute("y")) - (60 + 8 / Math.sqrt(2))) < 1e-9, "斜め辺は中点の法線側へ置く");
    assert.deepEqual({ x: Number(reversedLabel.getAttribute("x")), y: Number(reversedLabel.getAttribute("y")) }, { x: 30, y: 98 }, "端点の保存順が逆でも自然な側を維持する");
    assert.equal(horizontalLabel.getAttribute("data-geometry-kind"), null, "描画用textへ注釈種別を重複させない");
    assert.equal(horizontalLabel.getAttribute("data-geometry-type"), null, "描画用textへ注釈型を重複させない");
    assert.equal(horizontalLabel.getAttribute("data-geometry-id"), null, "描画用textへ注釈IDを重複させない");
    assert.match(horizontalLabel.getAttribute("pointer-events"), /visiblePainted/);
    const horizontalGroup = descendants(svg).find((node) => node.name === "g" && node.getAttribute("data-geometry-id") === horizontal.id);
    assert.equal(descendants(svg).filter((node) => node.getAttribute("data-geometry-type") === "length-label" && node.getAttribute("data-geometry-id") === horizontal.id).length, 1, "長さ注釈の意味上のDOMノードは親gだけにする");
    assert.match(horizontalGroup.getAttribute("class"), /is-selected/, "選択状態をラベルへ反映する");
    assert.equal(descendants(svg).some((node) => node.getAttribute("class") === "geometry-equal-length-mark"), true, "等辺印と共存する");
    assert.equal(descendants(svg).some((node) => node.getAttribute("class") === "geometry-parallel-mark"), true, "平行記号と共存する");
  } finally {
    global.document = priorDocument;
  }
});

test("SVGは意味付きデータから生成され、頂点移動後に注釈を追従させる", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const geometry = semanticTriangle();
    const svg = new MockElement("svg");
    const labels = (value, pointId) => value.annotations.find((annotation) => annotation.type === "vertex-label" && annotation.pointId === pointId) || null;
    renderGeometrySvg(svg, geometry, { vertexLabel: labels });
    const first = descendants(svg);
    const rightAngle = first.find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    const angle = first.find((node) => node.getAttribute("data-geometry-type") === "angle");
    assert.equal(rightAngle.getAttribute("data-vertex-id"), geometry.points[1].id);
    assert.match(rightAngle.getAttribute("aria-label"), /頂点 B の直角/);
    assert.match(angle.getAttribute("aria-label"), /角 B 90°/);
    const rightAngleHit = rightAngle.children.find((node) => node.getAttribute("class") === "geometry-right-angle-hit");
    const rightAngleMark = rightAngle.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark");
    const angleHit = angle.children.find((node) => node.getAttribute("class") === "geometry-angle-hit");
    const angleArc = angle.children.find((node) => node.getAttribute("class") === "geometry-angle-arc");
    assert.equal(rightAngleHit.getAttribute("data-geometry-kind"), "annotation", "直角記号のヒット領域から注釈種別を取得できる");
    assert.equal(rightAngleHit.getAttribute("data-geometry-id"), rightAngle.getAttribute("data-geometry-id"), "直角記号のヒット領域から注釈IDを取得できる");
    assert.equal(rightAngleHit.getAttribute("pointer-events"), "stroke", "直角記号のヒット領域だけがポインターを受け取る");
    assert.equal(rightAngleHit.getAttribute("stroke-width"), "12", "直角記号のヒット領域は表示サイズから独立して幅12を保つ");
    assert.equal(rightAngleMark.getAttribute("pointer-events"), "none", "直角記号の表示線はクリックを奪わない");
    assert.equal(rightAngleHit.getAttribute("d"), rightAngleMark.getAttribute("d"), "直角記号の表示線とヒット領域は同じ位置に描画する");
    assert.equal(angleHit.getAttribute("data-geometry-kind"), "annotation", "角度円弧のヒット領域から注釈種別を取得できる");
    assert.equal(angleHit.getAttribute("data-geometry-id"), angle.getAttribute("data-geometry-id"), "角度円弧のヒット領域から注釈IDを取得できる");
    assert.equal(angleHit.getAttribute("pointer-events"), "stroke", "角度円弧のヒット領域だけがポインターを受け取る");
    assert.equal(angleHit.getAttribute("stroke-width"), "12", "角度円弧のヒット領域は幅12を保つ");
    assert.equal(angleArc.getAttribute("pointer-events"), "none", "角度円弧の表示線はクリックを奪わない");
    assert.equal(angleHit.getAttribute("d"), angleArc.getAttribute("d"), "角度円弧の表示線とヒット領域は同じ位置に描画する");
    assert.equal(first.filter((node) => node.getAttribute("data-geometry-type") === "equal-length").length, 2);
    assert.equal(first.filter((node) => node.getAttribute("data-geometry-type") === "parallel").length, 2);
    const beforePath = rightAngleMark.getAttribute("d");
    const beforeAnglePath = angleArc.getAttribute("d");
    const beforeAngleLabel = angle.children.find((node) => node.getAttribute("class") === "geometry-angle-label");
    const moved = movePoint(geometry, geometry.points[1].id, 20, 20);
    renderGeometrySvg(svg, moved, { vertexLabel: labels });
    const movedRightAngle = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    const movedRightAngleMark = movedRightAngle.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark");
    const movedRightAngleHit = movedRightAngle.children.find((node) => node.getAttribute("class") === "geometry-right-angle-hit");
    assert.notEqual(movedRightAngleMark.getAttribute("d"), beforePath);
    assert.equal(movedRightAngleHit.getAttribute("d"), movedRightAngleMark.getAttribute("d"), "頂点移動後も表示線とヒット領域を同じ参照点から再計算する");
    const movedAngle = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "angle");
    const movedAngleArc = movedAngle.children.find((node) => node.getAttribute("class") === "geometry-angle-arc");
    const movedAngleHit = movedAngle.children.find((node) => node.getAttribute("class") === "geometry-angle-hit");
    const movedAngleLabel = movedAngle.children.find((node) => node.getAttribute("class") === "geometry-angle-label");
    assert.notEqual(movedAngleArc.getAttribute("d"), beforeAnglePath, "点移動後に角度円弧を再計算する");
    assert.equal(movedAngleHit.getAttribute("d"), movedAngleArc.getAttribute("d"), "点移動後も角度円弧の表示線とヒット領域を一致させる");
    assert.notDeepEqual({ x: movedAngleLabel.getAttribute("x"), y: movedAngleLabel.getAttribute("y") }, { x: beforeAngleLabel.getAttribute("x"), y: beforeAngleLabel.getAttribute("y") }, "点移動後に角度表示位置を再計算する");
    const angleAnnotation = geometry.annotations.find((annotation) => annotation.type === "angle");
    renderGeometrySvg(svg, geometry, { selection: { kind: "annotation", id: angleAnnotation.id }, vertexLabel: labels });
    assert.match(descendants(svg).find((node) => node.getAttribute("data-geometry-id") === angleAnnotation.id).getAttribute("class"), /is-selected/, "選択時は角度円弧へアクセントを付ける");
  } finally {
    global.document = priorDocument;
  }
});

test("直角記号は既定size6で描画し、明示sizeを尊重する", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const svg = new MockElement("svg");
    let defaultGeometry = createGeometryBlock("right-angle-renderer-default");
    defaultGeometry = addPoint(defaultGeometry, { x: 10, y: 10 });
    defaultGeometry = addPoint(defaultGeometry, { x: 20, y: 10 });
    defaultGeometry = addPoint(defaultGeometry, { x: 10, y: 20 });
    const origin = defaultGeometry.points[0].id;
    const right = defaultGeometry.points[1].id;
    const down = defaultGeometry.points[2].id;
    defaultGeometry = addRightAngle(defaultGeometry, {
      vertexId: origin,
      rayVertexIds: [right, down]
    });

    let explicitGeometry = createGeometryBlock("right-angle-renderer-explicit");
    explicitGeometry = addPoint(explicitGeometry, { x: 10, y: 10 });
    explicitGeometry = addPoint(explicitGeometry, { x: 20, y: 10 });
    explicitGeometry = addPoint(explicitGeometry, { x: 10, y: 20 });
    const explicitOrigin = explicitGeometry.points[0].id;
    const explicitRight = explicitGeometry.points[1].id;
    const explicitDown = explicitGeometry.points[2].id;
    explicitGeometry = addRightAngle(explicitGeometry, {
      vertexId: explicitOrigin,
      rayVertexIds: [explicitRight, explicitDown],
      size: 12
    });

    renderGeometrySvg(svg, defaultGeometry);
    const defaultMark = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    const defaultPath = defaultMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark").getAttribute("d");
    const defaultHitPath = defaultMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-hit").getAttribute("d");
    const defaultPoints = pathPoints(defaultPath);
    assert.equal(defaultMark.getAttribute("pointer-events"), "visiblePainted", "直角記号は選択対象として描画する");
    assert.ok(Math.abs(distance(defaultPoints[0], defaultPoints[1]) - 6) < 1e-9, "既定size6で描画される");
    assert.equal(defaultHitPath, defaultPath, "既定size6でも表示線から離れた透明な直角形状を作らない");

    const defaultRightAngle = defaultGeometry.annotations.find((annotation) => annotation.type === "right-angle");
    renderGeometrySvg(svg, defaultGeometry, { selection: { kind: "annotation", id: defaultRightAngle.id } });
    const selectedDefaultMark = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    assert.match(selectedDefaultMark.getAttribute("class"), /is-selected/, "選択時は表示用の直角記号へアクセントを付ける");
    assert.equal(selectedDefaultMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark").getAttribute("d"), defaultPath, "選択状態でも表示位置を変えない");

    renderGeometrySvg(svg, explicitGeometry);
    const explicitMark = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    const explicitPath = explicitMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark").getAttribute("d");
    const explicitHitPath = explicitMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-hit").getAttribute("d");
    const explicitPoints = pathPoints(explicitPath);
    assert.ok(Math.abs(distance(explicitPoints[0], explicitPoints[1]) - 12) < 1e-9, "明示size 12 は反映される");
    assert.equal(explicitHitPath, explicitPath, "明示sizeでも表示線とヒット領域を同じ位置に保つ");
  } finally {
    global.document = priorDocument;
  }
});

test("直角記号は参照点から再構築され、保存復元・再描画で重複しない", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    let geometry = createGeometryBlock("right-angle-renderer");
    geometry = addPoint(geometry, { x: 15, y: 75 });
    geometry = addPoint(geometry, { x: 15, y: 15 });
    geometry = addPoint(geometry, { x: 75, y: 15 });
    geometry = addRightAngle(geometry, { vertexId: geometry.points[1].id, rayVertexIds: [geometry.points[0].id, geometry.points[2].id] });
    const annotation = geometry.annotations.find((item) => item.type === "right-angle");
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry, { selection: { kind: "annotation", id: annotation.id } });
    const firstMark = descendants(svg).find((node) => node.getAttribute("data-geometry-id") === annotation.id);
    const firstPath = firstMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark").getAttribute("d");
    assert.equal(firstMark.getAttribute("pointer-events"), "visiblePainted", "直角記号は選択対象として描画する");
    assert.match(firstMark.getAttribute("class"), /is-selected/);

    const moved = movePoint(geometry, geometry.points[2].id, 85, 35);
    renderGeometrySvg(svg, moved);
    const movedMark = descendants(svg).find((node) => node.getAttribute("data-geometry-id") === annotation.id);
    assert.notEqual(movedMark.children.find((node) => node.getAttribute("class") === "geometry-right-angle-mark").getAttribute("d"), firstPath, "点移動後は保存座標に依存せず直角記号を再配置する");
    const restored = parseGeometryBlockLine(serializeGeometryBlock(moved));
    renderGeometrySvg(svg, restored);
    assert.equal(descendants(svg).filter((node) => node.name === "g" && node.getAttribute("data-geometry-id") === annotation.id).length, 1, "保存復元後の再描画で直角記号を重複させない");
    assert.deepEqual(restored.annotations.find((item) => item.id === annotation.id).rayVertexIds, annotation.rayVertexIds, "保存復元後も同じ参照関係を使う");
  } finally {
    global.document = priorDocument;
  }
});

test("共通レンダラーは点・線分・円・多角形をID付きで決定的に再構築し、再描画を重複させない", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    let geometry = createGeometryBlock("shared-renderer");
    geometry = addPoint(geometry, { x: 12, y: 20 });
    geometry = addPoint(geometry, { x: 72, y: 20 });
    geometry = addPoint(geometry, { x: 12, y: 70 });
    geometry = addPoint(geometry, { x: 70, y: 70 });
    geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
    const segment = geometry.objects[geometry.objects.length - 1];
    geometry = addCircle(geometry, geometry.points[0].id, geometry.points[2].id);
    const circle = geometry.objects[geometry.objects.length - 1];
    geometry = addPolygon(geometry, [geometry.points[0].id, geometry.points[1].id, geometry.points[2].id, geometry.points[3].id]);
    const polygon = geometry.objects[geometry.objects.length - 1];
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry, { selection: { kind: "object", id: segment.id } });
    const first = svgSnapshot(svg);
    const firstNodes = descendants(svg);
    const segmentDisplay = firstNodes.find((node) => node.getAttribute("data-geometry-source-id") === segment.id);
    assert.match(segmentDisplay.getAttribute("class"), /is-selected/, "線分表示の選択状態をDOMへ反映する");
    const circleHit = firstNodes.find((node) => node.getAttribute("data-geometry-id") === circle.id);
    const circleDisplay = firstNodes.find((node) => node.getAttribute("data-geometry-source-id") === circle.id);
    const polygonElement = firstNodes.find((node) => node.getAttribute("data-geometry-id") === polygon.id);
    const polygonSource = firstNodes.find((node) => node.getAttribute("data-geometry-source-id") === polygon.id);
    const segmentHit = firstNodes.find((node) => node.getAttribute("data-geometry-id") === segment.id);
    assert.equal(segmentHit.getAttribute("data-geometry-type"), "segment", "線分の当たり判定をオブジェクトIDへ対応させる");
    assert.equal(segmentDisplay.getAttribute("data-geometry-source-type"), "segment", "線分表示を元のオブジェクトIDへ対応させる");
    assert.equal(circleHit.getAttribute("data-geometry-type"), "circle", "円の当たり判定をオブジェクトIDへ対応させる");
    assert.equal(circleDisplay.getAttribute("data-geometry-source-type"), "circle", "円表示を元のオブジェクトIDへ対応させる");
    assert.equal(polygonElement.getAttribute("data-geometry-type"), "polygon", "多角形の当たり判定をオブジェクトIDへ対応させる");
    assert.equal(polygonElement.getAttribute("data-geometry-kind"), "object", "多角形の既存kind属性を維持する");
    assert.equal(polygonSource.getAttribute("data-geometry-source-kind"), "object", "多角形表示に既存要素参照kindを付与する");
    assert.equal(polygonSource.getAttribute("data-geometry-source-type"), "polygon", "多角形表示に既存要素参照typeを付与する");
    assert.equal(polygonSource.getAttribute("data-geometry-source-id"), polygon.id, "多角形表示に既存要素参照idを付与する");
    assert.equal(polygonElement.getAttribute("data-geometry-id"), polygon.id, "多角形要素を元のオブジェクトIDで特定できる");

    renderGeometrySvg(svg, geometry, { selection: { kind: "object", id: polygon.id } });
    const polygonElementAfterPolygonSelection = descendants(svg).find((node) => node.getAttribute("data-geometry-id") === polygon.id);
    assert.match(polygonElementAfterPolygonSelection.getAttribute("class"), /is-selected/, "多角形の選択状態は既存フラグへ反映する");

    renderGeometrySvg(svg, geometry, { selection: null });
    const second = svgSnapshot(svg);
    assert.equal(second.length, first.length, "同じSVGへの再描画で要素を追加し続けない");
    assert.equal(descendants(svg).some((node) => /is-selected/.test(node.getAttribute("class") || "")), false, "選択解除をDOMへ反映する");

    const reordered = { ...geometry, points: [...geometry.points].reverse(), objects: [...geometry.objects].reverse(), annotations: [...geometry.annotations].reverse() };
    renderGeometrySvg(svg, reordered);
    assert.deepEqual(svgSnapshot(svg), second, "入力配列の偶発的な列挙順に描画順序を依存させない");

    const restored = parseGeometryBlockLine(serializeGeometryBlock(geometry));
    renderGeometrySvg(svg, restored);
    assert.equal(descendants(svg).find((node) => node.getAttribute("data-geometry-source-id") === polygon.id).getAttribute("data-geometry-source-type"), "polygon", "保存復元後も多角形と参照を再構築できる");
    assert.deepEqual(svgSnapshot(svg), second, "保存・復元後も位置・形状・参照IDから同じSVGを再構築する");
  } finally {
    global.document = priorDocument;
  }
});

test("共通レンダラーは未知または描画不能な要素を保存値へ触れずに無視する", () => {
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    let geometry = createGeometryBlock("safe-renderer");
    geometry = addPoint(geometry, { x: 10, y: 10 });
    geometry = addPoint(geometry, { x: 70, y: 70 });
    geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
    const source = {
      ...geometry,
      objects: [{ id: "unknown-object", type: "future-shape", pointIds: [] }, { id: "broken-segment", type: "segment", pointIds: [geometry.points[0].id, "missing"] }, ...geometry.objects],
      annotations: [{ id: "unknown-annotation", type: "future-annotation" }, ...geometry.annotations]
    };
    const before = JSON.stringify(source);
    const svg = new MockElement("svg");
    assert.doesNotThrow(() => renderGeometrySvg(svg, source));
    assert.equal(descendants(svg).some((node) => node.getAttribute("data-geometry-id") === geometry.objects[0].id), true, "正常な線分は継続して描画する");
    assert.equal(JSON.stringify(source), before, "描画エラー処理のために入力スキーマを変更しない");
  } finally {
    global.document = priorDocument;
  }
});

test("共通レンダラーは多角形の先頭・途中・末尾辺を個別の等辺印とヒット領域へ出力する", () => {
  let geometry = createGeometryBlock("polygon-edge-render");
  [[10, 10], [60, 10], [70, 50], [30, 75]].forEach(([x, y]) => { geometry = addPoint(geometry, { x, y }); });
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const polygon = geometry.objects[0];
  geometry = addEqualLengthMark(geometry, { edgeRefs: [{ objectId: polygon.id, edgeIndex: 0 }, { objectId: polygon.id, edgeIndex: 2 }, { objectId: polygon.id, edgeIndex: 3 }], markCount: 3 });
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry);
    const edgeHits = descendants(svg).filter((node) => node.getAttribute("data-geometry-kind") === "edge" && node.getAttribute("data-geometry-object-id") === polygon.id);
    assert.deepEqual(edgeHits.map((node) => node.getAttribute("data-geometry-edge-index")).sort(), ["0", "1", "2", "3"]);
    const marks = descendants(svg).filter((node) => node.getAttribute("data-geometry-type") === "equal-length");
    assert.equal(marks.length, 3);
    assert.deepEqual(marks.map((node) => node.getAttribute("data-edge-index")).sort(), ["0", "2", "3"]);
  } finally {
    global.document = priorDocument;
  }
});

test("平行記号は多角形の任意辺へ本数分描画し、逆向きの辺でも選択属性を保つ", () => {
  let geometry = createGeometryBlock("parallel-render");
  [[10, 10], [70, 10], [70, 50], [10, 50]].forEach(([x, y]) => { geometry = addPoint(geometry, { x, y }); });
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const polygon = geometry.objects[0];
  geometry = addParallelMark(geometry, { edgeRefs: [{ objectId: polygon.id, edgeIndex: 0 }, { objectId: polygon.id, edgeIndex: 2 }, { objectId: polygon.id, edgeIndex: 3 }], markCount: 2 });
  const annotation = geometry.annotations.find((entry) => entry.type === "parallel");
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const svg = new MockElement("svg");
    renderGeometrySvg(svg, geometry, { selection: { kind: "annotation", id: annotation.id } });
    const groups = descendants(svg).filter((node) => node.getAttribute("class") === "geometry-annotation geometry-parallel is-selected");
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((node) => node.getAttribute("data-edge-index")).sort(), ["0", "2", "3"]);
    groups.forEach((group) => {
      assert.equal(group.children.filter((node) => node.getAttribute("class") === "geometry-parallel-mark").length, 2);
      const hit = group.children.find((node) => node.getAttribute("class") === "geometry-parallel-hit");
      assert.equal(hit.getAttribute("data-geometry-id"), annotation.id);
      assert.equal(hit.getAttribute("pointer-events"), "stroke");
      assert.equal(group.children.filter((node) => node.getAttribute("class") === "geometry-parallel-mark").every((mark) => mark.getAttribute("pointer-events") === "none"), true);
    });
    const before = groups.map((group) => group.children.find((node) => node.getAttribute("class") === "geometry-parallel-mark").getAttribute("d"));
    const moved = movePoint(geometry, geometry.points[1].id, 80, 15);
    renderGeometrySvg(svg, moved, { selection: { kind: "annotation", id: annotation.id } });
    const after = descendants(svg).filter((node) => node.getAttribute("class") === "geometry-parallel-mark").map((node) => node.getAttribute("d"));
    assert.notDeepEqual(after, before);
  } finally {
    global.document = priorDocument;
  }
});

test("等辺印と平行記号は辺上を保ち、共存時だけ接線方向へ分離する", () => {
  let geometry = createGeometryBlock("tangent-mark-sides");
  [[10, 10], [70, 10], [70, 50], [10, 50]].forEach(([x, y]) => { geometry = addPoint(geometry, { x, y }); });
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const polygon = geometry.objects[0];
  const edgeRefs = [0, 1, 2].map((edgeIndex) => ({ objectId: polygon.id, edgeIndex }));
  const edgeData = [
    { index: 0, midpoint: { x: 40, y: 10 }, direction: { x: 1, y: 0 } },
    { index: 1, midpoint: { x: 70, y: 30 }, direction: { x: 0, y: 1 } },
    { index: 2, midpoint: { x: 40, y: 50 }, direction: { x: 1, y: 0 } }
  ];
  const equalOnly = addEqualLengthMark(geometry, { edgeRefs, markCount: 2 });
  const parallelOnly = addParallelMark(geometry, { edgeRefs, markCount: 3 });
  let shared = addEqualLengthMark(geometry, { edgeRefs, markCount: 2 });
  shared = addParallelMark(shared, { edgeRefs, markCount: 3 });
  const equalAnnotation = shared.annotations.find((annotation) => annotation.type === "equal-length");
  const priorDocument = global.document;
  global.document = { createElementNS: (_namespace, name) => new MockElement(name) };
  try {
    const { renderGeometrySvg } = require("./geometry-svg-renderer.js");
    const render = (value, selection) => {
      const svg = new MockElement("svg");
      renderGeometrySvg(svg, value, { selection });
      return svg;
    };
    const center = (group) => {
      const hit = group.children.find((node) => /geometry-(equal-length|parallel)-hit/.test(node.getAttribute("class") || ""));
      return { x: (Number(hit.getAttribute("x1")) + Number(hit.getAttribute("x2"))) / 2, y: (Number(hit.getAttribute("y1")) + Number(hit.getAttribute("y2"))) / 2 };
    };
    const group = (svg, type, edgeIndex) => descendants(svg).find((node) => node.getAttribute("class")?.includes(`geometry-${type}`) && node.getAttribute("data-edge-index") === String(edgeIndex));
    const equalSvg = render(equalOnly);
    const parallelSvg = render(parallelOnly);
    const sharedSvg = render(shared, { kind: "annotation", id: equalAnnotation.id });
    edgeData.forEach(({ index, midpoint, direction }) => {
      const normal = { x: -direction.y, y: direction.x };
      const normalOffset = (position) => (position.x - midpoint.x) * normal.x + (position.y - midpoint.y) * normal.y;
      const tangentOffset = (position) => (position.x - midpoint.x) * direction.x + (position.y - midpoint.y) * direction.y;
      assert.ok(Math.abs(normalOffset(center(group(equalSvg, "equal-length", index)))) < 1e-9, `等辺印だけの辺${index + 1}は辺上に置く`);
      assert.ok(Math.abs(normalOffset(center(group(parallelSvg, "parallel", index)))) < 1e-9, `平行記号だけの辺${index + 1}は辺上に置く`);
      const equal = group(sharedSvg, "equal-length", index);
      const parallel = group(sharedSvg, "parallel", index);
      assert.ok(Math.abs(normalOffset(center(equal))) < 1e-9 && Math.abs(normalOffset(center(parallel))) < 1e-9, `共存時の辺${index + 1}も辺上に置く`);
      assert.ok(tangentOffset(center(equal)) < 0 && tangentOffset(center(parallel)) > 0, `共存時の辺${index + 1}を接線方向へ分離する`);
      assert.equal(equal.getAttribute("data-object-id"), polygon.id);
      assert.equal(parallel.getAttribute("data-edge-index"), String(index));
      assert.equal(equal.children.filter((node) => node.getAttribute("class") === "geometry-equal-length-mark").length, 2);
      assert.equal(parallel.children.filter((node) => node.getAttribute("class") === "geometry-parallel-mark").length, 3);
    });
    assert.equal(group(sharedSvg, "equal-length", 0).getAttribute("class").includes("is-selected"), true, "選択状態を維持する");
    const beforeMove = center(group(sharedSvg, "equal-length", 0));
    const moved = movePoint(shared, shared.points[0].id, 16, 16);
    const afterMove = center(group(render(moved), "equal-length", 0));
    assert.notDeepEqual(afterMove, beforeMove, "点移動後に辺上の配置を再計算する");
  } finally {
    global.document = priorDocument;
  }
});
