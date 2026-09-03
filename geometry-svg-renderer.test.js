const assert = require("node:assert/strict");
const { test } = require("node:test");
const { cloneGeometryBlock, createGeometryBlock, parseGeometryBlockLine, serializeGeometryBlock } = require("./geometry-block-utils.js");
const {
  addAngle, addEqualLengthMark, addLengthAnnotation, addParallelMark, addPoint,
  addRightAngle, addSegment, deleteSelection, movePoint, updateVertexLabel
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
    assert.equal(first.filter((node) => node.getAttribute("data-geometry-type") === "equal-length").length, 2);
    assert.equal(first.filter((node) => node.getAttribute("data-geometry-type") === "parallel").length, 2);
    const beforePath = rightAngle.children[0].getAttribute("d");
    const moved = movePoint(geometry, geometry.points[1].id, 20, 20);
    renderGeometrySvg(svg, moved, { vertexLabel: labels });
    const movedRightAngle = descendants(svg).find((node) => node.getAttribute("data-geometry-type") === "right-angle");
    assert.notEqual(movedRightAngle.children[0].getAttribute("d"), beforePath);
  } finally {
    global.document = priorDocument;
  }
});
