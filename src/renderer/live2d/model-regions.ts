// Firefly 网格隐藏与命中区域解析（桌宠窗口）。
//
// - HIDDEN_DRAWABLE_IDS：按网格隐藏的场景物（饮料、蛋糕盘、桌子）。不修改模型文件，
//   通过覆盖 coreModel.getDrawableOpacity 让这些网格的不透明度恒为 0；渲染与命中都读取该值。
// - NON_BODY_DRAWABLE_IDS：不计入“双击身体”的网格（Head、被隐藏的场景物、椅子、脚下影子）。
// - 命中区域：Head 沿用模型 HitAreas（ArtMesh23）；Body 为任意可见、且不在 NON_BODY_DRAWABLE_IDS 中的网格。

/** 按网格隐藏的场景物：饮料、蛋糕盘、桌子。 */
export const HIDDEN_DRAWABLE_IDS: readonly string[] = ["ArtMesh153", "ArtMesh154", "ArtMesh155"];

/**
 * 不计入“双击身体”的网格。
 * - ArtMesh23：Head 区域（单独走 HitAreas 的 Head 判定）。
 * - ArtMesh153 / 154 / 155：被隐藏的饮料、蛋糕盘、桌子（不可见，也不可命中）。
 * - ArtMesh156：椅子，属于场景物，保持可见但不触发身体。
 * - ArtMesh157：脚下影子，属于场景物，保持可见但不触发身体。
 */
export const NON_BODY_DRAWABLE_IDS: ReadonlySet<string> = new Set([
  "ArtMesh23",
  "ArtMesh153",
  "ArtMesh154",
  "ArtMesh155",
  "ArtMesh156",
  "ArtMesh157",
]);

/** 本模块用到的 Cubism 核心模型方法（运行时即 CubismModel；pixi-live2d-display 的类型对 coreModel 收窄为 object）。 */
export interface FireflyCoreModel {
  getDrawableIndex(drawableId: string): number;
  getDrawableOpacity(drawableIndex: number): number;
  getDrawableVertexIndices(drawableIndex: number): Uint16Array;
}

/**
 * 覆盖 coreModel.getDrawableOpacity：hidden 网格返回 0，其它网格调用原函数。
 * 渲染器与命中判定都经由 core 实例读取不透明度，因此覆盖对二者同时生效。
 * 返回恢复函数（dispose 时调用）。
 */
export function installHiddenDrawableGuard(
  core: Pick<FireflyCoreModel, "getDrawableIndex" | "getDrawableOpacity">,
  drawableIds: readonly string[] = HIDDEN_DRAWABLE_IDS,
): () => void {
  const hidden = new Set(
    drawableIds.map((id) => core.getDrawableIndex(id)).filter((index) => index >= 0),
  );
  const original = core.getDrawableOpacity;
  core.getDrawableOpacity = function (this: unknown, index: number): number {
    return hidden.has(index) ? 0 : original.call(this, index);
  };
  return () => {
    core.getDrawableOpacity = original;
  };
}

/** 点 (px, py) 是否落在三角形 abc 内（含边界）。 */
export function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export interface HitRegionDrawable {
  index: number;
  id: string;
  /** 当前不透明度（已包含隐藏覆盖）。 */
  opacity: number;
}

export interface ResolveHitRegionsInput {
  /** 模型 HitAreas 的 Head 是否命中（Head 优先）。 */
  headHit: boolean;
  drawables: readonly HitRegionDrawable[];
  /** 不计入 Body 的网格 ID（见 NON_BODY_DRAWABLE_IDS）。 */
  excludedDrawableIds: ReadonlySet<string>;
  /** 指定网格（按 index）是否包含该点。 */
  isPointInDrawable: (index: number) => boolean;
}

/**
 * 解析点击命中的区域名：返回 ["Head"]、["Body"] 或 []。
 * Head 优先；Body 只考虑可见（opacity > 0）且不在排除集合中的网格。
 */
export function resolveFireflyHitRegions(input: ResolveHitRegionsInput): string[] {
  if (input.headHit) return ["Head"];
  for (const drawable of input.drawables) {
    if (input.excludedDrawableIds.has(drawable.id)) continue;
    if (!(drawable.opacity > 0)) continue;
    if (input.isPointInDrawable(drawable.index)) return ["Body"];
  }
  return [];
}
