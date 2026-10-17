// Layout of the right-hand panels: columns side by side, each column a vertical stack.
// Pure helpers, so moving and resizing can be tested without a DOM.

export interface PanelColumn { ids: string[]; weight: number }
export type DropZone = "left" | "right" | "top" | "bottom";

/** No column is squeezed below this width (px) by the separators. */
export const MIN_COLUMN_WIDTH = 160;

/** Drops closed panels, removes empty columns, and puts newly opened panels in a column of their own at the end. */
export function reconcileColumns(columns: readonly PanelColumn[], ids: readonly string[]): PanelColumn[] {
  const alive = columns.map(column => ({ ...column, ids: column.ids.filter(id => ids.includes(id)) })).filter(column => column.ids.length > 0);
  const known = new Set(alive.flatMap(column => column.ids));
  const weight = alive.length > 0 ? alive.reduce((sum, column) => sum + column.weight, 0) / alive.length : 1;
  return [...alive, ...ids.filter(id => !known.has(id)).map(id => ({ ids: [id], weight }))];
}

/** Moves a panel next to another one: a new column on its left or right, or into its column above or below it. */
export function movePanel(columns: readonly PanelColumn[], id: string, targetId: string, zone: DropZone): PanelColumn[] {
  if (id === targetId) return columns.map(column => ({ ...column, ids: [...column.ids] }));
  const weight = columns.find(column => column.ids.includes(targetId))?.weight ?? 1;
  const next = columns.map(column => ({ ...column, ids: column.ids.filter(item => item !== id) }));
  const targetIndex = next.findIndex(column => column.ids.includes(targetId));
  if (targetIndex < 0) return columns.map(column => ({ ...column, ids: [...column.ids] }));
  if (zone === "left" || zone === "right") {
    next.splice(zone === "left" ? targetIndex : targetIndex + 1, 0, { ids: [id], weight });
  } else {
    const column = next[targetIndex]!;
    column.ids.splice(column.ids.indexOf(targetId) + (zone === "top" ? 0 : 1), 0, id);
  }
  return next.filter(column => column.ids.length > 0);
}

/** The keyboard move: one step left/right/up/down. Returns the same layout when there is nowhere to go. */
export function shiftPanel(columns: readonly PanelColumn[], id: string, direction: "left" | "right" | "up" | "down"): PanelColumn[] {
  const index = columns.findIndex(column => column.ids.includes(id));
  if (index < 0) return columns.map(column => ({ ...column, ids: [...column.ids] }));
  const column = columns[index]!;
  const at = column.ids.indexOf(id);
  if (direction === "up" || direction === "down") {
    const neighbour = column.ids[at + (direction === "up" ? -1 : 1)];
    return neighbour === undefined ? columns.map(item => ({ ...item, ids: [...item.ids] })) : movePanel(columns, id, neighbour, direction === "up" ? "top" : "bottom");
  }
  if (column.ids.length > 1) return movePanel(columns, id, column.ids.find(item => item !== id)!, direction);
  const beside = columns[index + (direction === "left" ? -1 : 1)];
  return beside === undefined ? columns.map(item => ({ ...item, ids: [...item.ids] })) : movePanel(columns, id, beside.ids[0]!, direction);
}

/** Moves the separator after column `index` so the column on its left is `leftPx` wide, keeping both at least the minimum. */
export function resizeColumns(columns: readonly PanelColumn[], index: number, widthsPx: readonly number[], leftPx: number): PanelColumn[] {
  const pair = (widthsPx[index] ?? 0) + (widthsPx[index + 1] ?? 0);
  const left = Math.max(MIN_COLUMN_WIDTH, Math.min(leftPx, pair - MIN_COLUMN_WIDTH));
  return columns.map((column, position) => ({
    ...column,
    // Weights become pixel widths: flex-grow then splits the row in exactly those proportions.
    weight: position === index ? left : position === index + 1 ? pair - left : (widthsPx[position] ?? column.weight),
  }));
}

/** Where a pointer over a panel would drop it: the outer thirds make a side-by-side column, the middle stacks. */
export function dropZoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): DropZone {
  const across = (x - rect.left) / Math.max(1, rect.width);
  if (across < 0.3) return "left";
  if (across > 0.7) return "right";
  return y < rect.top + rect.height / 2 ? "top" : "bottom";
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/** CSS grid placement for every panel, so a move never re-parents (and so never remounts) a panel. */
export function gridPlacement(columns: readonly PanelColumn[]): { rows: number; byId: Map<string, { column: number; row: number; span: number }> } {
  const rows = columns.reduce((lcm, column) => lcm / gcd(lcm, column.ids.length) * column.ids.length, 1);
  const byId = new Map<string, { column: number; row: number; span: number }>();
  columns.forEach((column, index) => {
    const span = rows / column.ids.length;
    // Tracks alternate panel column / 8px separator, so panel column n sits on track 2n + 1.
    column.ids.forEach((id, at) => byId.set(id, { column: index * 2 + 1, row: at * span + 1, span }));
  });
  return { rows, byId };
}
