import test from "node:test";
import assert from "node:assert/strict";
import { classifyColumnDrop, resolveDisplayedColumn } from "../src/board-columns.js";

const columns = [
  { id: "todo", status: "todo", name: "Cần làm" },
  { id: "review", status: "todo", name: "Chờ duyệt" },
  { id: "doing", status: "doing", name: "Đang làm" },
  { id: "done", status: "done", name: "Hoàn thành" },
];

test("tasks on the selected board keep their column, other items follow status", () => {
  const options = { placeByStatus: true, teamId: null };
  assert.equal(resolveDisplayedColumn({ kind: "task", teamId: null, status: "todo", columnId: "review" }, columns, options), "review");
  assert.equal(resolveDisplayedColumn({ kind: "task", teamId: null, status: "doing", columnId: null }, columns, options), "doing");
  assert.equal(resolveDisplayedColumn({ kind: "task", teamId: "team_sales", status: "todo", columnId: "sales-review" }, columns, options), "todo");
  assert.equal(resolveDisplayedColumn({ kind: "event", teamId: null, status: "doing" }, columns, options), "doing");
  assert.equal(resolveDisplayedColumn({ kind: "task", teamId: null, status: "todo", columnId: "archived" }, columns, options), "todo");
});

test("only work on the selected board can enter a custom column", () => {
  const options = { placeByStatus: true, teamId: null };
  assert.equal(classifyColumnDrop({ kind: "task", teamId: null, status: "todo" }, "review", columns, options).mode, "board");
  assert.equal(classifyColumnDrop({ kind: "task", teamId: "team_sales", status: "todo", columnId: "sales-review" }, "review", columns, options).mode, "error");
  assert.equal(classifyColumnDrop({ kind: "event", status: "todo" }, "review", columns, options).mode, "error");
  assert.deepEqual(
    classifyColumnDrop({ kind: "event", status: "todo" }, "doing", columns, options),
    { mode: "status", status: "doing", column: columns[2] },
  );
  assert.equal(classifyColumnDrop({ kind: "event", status: "doing" }, "doing", columns, options).mode, "skip");
  assert.equal(classifyColumnDrop({ kind: "task", teamId: null, status: "todo" }, "missing", columns, options).message, "Cột đích không còn hoạt động.");
});

test("a single-team workflow keeps the stored column even when it is archived", () => {
  assert.equal(
    resolveDisplayedColumn({ kind: "task", teamId: "team_sales", status: "todo", columnId: "archived" }, columns, { teamId: "team_sales" }),
    "archived",
  );
  assert.equal(classifyColumnDrop({ id: "task_1", columnId: "todo", status: "todo" }, "review", columns).mode, "board");
});
