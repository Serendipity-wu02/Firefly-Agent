import { expect, it } from "vitest";
import { dropZoneAt, gridPlacement, movePanel, reconcileColumns, resizeColumns, shiftPanel, MIN_COLUMN_WIDTH } from "./panel-layout";

const cols = (...groups: string[][]) => groups.map(ids => ({ ids, weight: 1 }));
const ids = (columns: { ids: string[] }[]) => columns.map(column => column.ids);

it("puts newly opened panels in a column of their own at the end and drops closed ones", () => {
  expect(ids(reconcileColumns(cols(["a", "b"], ["c"]), ["a", "c", "d"]))).toEqual([["a"], ["c"], ["d"]]);
  expect(ids(reconcileColumns([], ["a", "b"]))).toEqual([["a"], ["b"]]);
});

it("moves a panel beside another (new column) or into its column above or below", () => {
  expect(ids(movePanel(cols(["a"], ["b"], ["c"]), "c", "a", "left"))).toEqual([["c"], ["a"], ["b"]]);
  expect(ids(movePanel(cols(["a"], ["b"], ["c"]), "a", "c", "right"))).toEqual([["b"], ["c"], ["a"]]);
  expect(ids(movePanel(cols(["a"], ["b"], ["c"]), "a", "c", "bottom"))).toEqual([["b"], ["c", "a"]]);
  expect(ids(movePanel(cols(["a", "b"], ["c"]), "b", "c", "top"))).toEqual([["a"], ["b", "c"]]);
  expect(ids(movePanel(cols(["a"], ["b"]), "a", "a", "left"))).toEqual([["a"], ["b"]]);
});

it("steps one place with the keyboard and stays put at the edge", () => {
  expect(ids(shiftPanel(cols(["a"], ["b"], ["c"]), "a", "right"))).toEqual([["b"], ["a"], ["c"]]);
  expect(ids(shiftPanel(cols(["a"], ["b"]), "a", "left"))).toEqual([["a"], ["b"]]);
  expect(ids(shiftPanel(cols(["a", "b"]), "b", "up"))).toEqual([["b", "a"]]);
  expect(ids(shiftPanel(cols(["a", "b"]), "b", "right"))).toEqual([["a"], ["b"]]);
});

it("resizes a pair of columns in pixels and never below the minimum", () => {
  const next = resizeColumns(cols(["a"], ["b"], ["c"]), 0, [300, 300, 200], 340);
  expect(next.map(column => column.weight)).toEqual([340, 260, 200]);
  expect(resizeColumns(cols(["a"], ["b"]), 0, [300, 300], 5).map(column => column.weight)).toEqual([MIN_COLUMN_WIDTH, 600 - MIN_COLUMN_WIDTH]);
});

it("places columns on odd tracks and splits shared rows evenly", () => {
  const { rows, byId } = gridPlacement(cols(["a", "b"], ["c"]));
  expect(rows).toBe(2);
  expect(byId.get("b")).toEqual({ column: 1, row: 2, span: 1 });
  expect(byId.get("c")).toEqual({ column: 3, row: 1, span: 2 });
});

it("treats the outer thirds of a panel as beside it and the middle as above or below", () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  expect([dropZoneAt(box, 10, 50), dropZoneAt(box, 90, 50), dropZoneAt(box, 50, 20), dropZoneAt(box, 50, 80)]).toEqual(["left", "right", "top", "bottom"]);
});
