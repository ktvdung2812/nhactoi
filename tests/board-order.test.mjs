import test from "node:test";
import assert from "node:assert/strict";
import { reorderBeforeId, reorderIsNoop, moveColumnId, moveColumnToEndId } from "../src/board-order.js";

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

test("column reordering ignores unknown ids", () => {
  assert.equal(moveColumnId(["a", "b"], "z", "a", true), null);
  assert.equal(moveColumnId(["a", "b"], "a", "z", true), null);
  assert.equal(moveColumnToEndId(["a", "b"], "z"), null);
});
