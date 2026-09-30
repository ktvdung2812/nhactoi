import test from "node:test";
import assert from "node:assert/strict";
import { reorderBeforeId, reorderIsNoop, taskDropTarget, columnDropTarget, moveColumnId, moveColumnToEndId } from "../src/board-order.js";

const cards = [
  { id: "a", top: 0, height: 100 },
  { id: "b", top: 110, height: 100 },
  { id: "c", top: 220, height: 100 },
];

test("a card lands before the row whose midpoint is still below the pointer", () => {
  assert.equal(reorderBeforeId(cards, "c", 40), "a");
  assert.equal(reorderBeforeId(cards, "a", 150), "b");
  assert.equal(reorderBeforeId(cards, "a", 180), "c");
  assert.equal(reorderBeforeId(cards, "a", 400), null);
});

test("dropping a card where it already sits does not count as a move", () => {
  assert.equal(reorderIsNoop(cards, "a", "b"), true);
  assert.equal(reorderIsNoop(cards, "b", "c"), true);
  assert.equal(reorderIsNoop(cards, "c", null), true);
  assert.equal(reorderIsNoop(cards, "a", "c"), false);
  assert.equal(reorderIsNoop(cards, "c", "a"), false);
  assert.equal(reorderIsNoop(cards, "a", null), false);
});

test("pointer task drops select a visible column and insertion position", () => {
  const columns = [
    { id: "todo", left: 0, width: 100, cards },
    { id: "review", left: 120, width: 100, cards: [] },
    { id: "doing", left: 240, width: 100, cards: [{ id: "d", top: 0, height: 100 }], firstHiddenId: "e" },
  ];
  assert.deepEqual(taskDropTarget(columns, "c", 30, 40), { columnId: "todo", beforeTaskId: "a" });
  assert.deepEqual(taskDropTarget(columns, "a", 160, 400), { columnId: "review", beforeTaskId: null });
  assert.deepEqual(taskDropTarget(columns, "a", 270, 40), { columnId: "doing", beforeTaskId: "d" });
  assert.deepEqual(taskDropTarget(columns, "a", 270, 400), { columnId: "doing", beforeTaskId: "e" });
  assert.equal(taskDropTarget(columns, "a", 110, 40), null);
  assert.equal(taskDropTarget(columns, "a", 400, 40), null);
  assert.equal(reorderIsNoop([], "a", null), false);
});

test("a dragged column lands before or after the target column", () => {
  assert.deepEqual(moveColumnId(["a", "b", "c"], "c", "a", true), ["c", "a", "b"]);
  assert.deepEqual(moveColumnId(["a", "b", "c"], "a", "c", false), ["b", "c", "a"]);
  assert.deepEqual(moveColumnId(["a", "b", "c"], "a", "b", false), ["b", "a", "c"]);
  assert.deepEqual(moveColumnId(["a", "b", "c"], "b", "c", true), ["a", "b", "c"]);
});

test("a column dropped on the board lands at the end", () => {
  assert.deepEqual(moveColumnToEndId(["a", "b", "c"], "a"), ["b", "c", "a"]);
  assert.deepEqual(moveColumnToEndId(["a", "b", "c"], "c"), ["a", "b", "c"]);
});

test("pointer column drops use horizontal midpoints, including gaps and either end", () => {
  const columns = [
    { id: "a", left: 0, width: 100 },
    { id: "b", left: 120, width: 100 },
    { id: "c", left: 240, width: 100 },
  ];
  const order = columns.map(column => column.id);
  for (const [dragged, x, expected] of [
    ["b", 20, ["b", "a", "c"]],
    ["a", 200, ["b", "a", "c"]],
    ["a", 230, ["b", "a", "c"]],
    ["a", 330, ["b", "c", "a"]],
    ["b", 170, ["a", "b", "c"]],
  ]) {
    const target = columnDropTarget(columns, dragged, x);
    assert.deepEqual(moveColumnId(order, dragged, target.id, target.before), expected);
  }
  assert.equal(columnDropTarget([columns[0]], "a", 20), null);
});

test("column reordering ignores unknown ids", () => {
  assert.equal(moveColumnId(["a", "b"], "z", "a", true), null);
  assert.equal(moveColumnId(["a", "b"], "a", "z", true), null);
  assert.equal(moveColumnToEndId(["a", "b"], "z"), null);
});
