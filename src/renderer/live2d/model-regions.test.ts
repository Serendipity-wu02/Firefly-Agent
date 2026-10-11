import { describe, expect, it, vi } from "vitest";
import {
  HIDDEN_DRAWABLE_IDS,
  NON_BODY_DRAWABLE_IDS,
  installHiddenDrawableGuard,
  pointInTriangle,
  resolveFireflyHitRegions,
  type HitRegionDrawable,
} from "./model-regions";

function fakeCore(opacities: Record<string, number>) {
  const ids = Object.keys(opacities);
  const original = vi.fn((index: number) => opacities[ids[index]]);
  const core = {
    getDrawableIndex: vi.fn((id: string) => ids.indexOf(id)),
    getDrawableOpacity: original as (index: number) => number,
  };
  return { core, original, ids };
}

describe("installHiddenDrawableGuard", () => {
  it("hides the drink, cake plate and table drawables and leaves the chair and shadow untouched", () => {
    expect(HIDDEN_DRAWABLE_IDS).toEqual(["ArtMesh153", "ArtMesh154", "ArtMesh155"]);
    const { core } = fakeCore({
      ArtMesh153: 1, ArtMesh154: 1, ArtMesh155: 1, ArtMesh156: 1, ArtMesh157: 0.5,
    });
    installHiddenDrawableGuard(core);
    expect(core.getDrawableOpacity(0)).toBe(0);
    expect(core.getDrawableOpacity(1)).toBe(0);
    expect(core.getDrawableOpacity(2)).toBe(0);
    expect(core.getDrawableOpacity(3)).toBe(1);
    expect(core.getDrawableOpacity(4)).toBe(0.5);
  });

  it("keeps hidden drawables at zero on every read, including after the original value changes", () => {
    const { core, original } = fakeCore({ ArtMesh153: 1, ArtMesh156: 1 });
    installHiddenDrawableGuard(core);
    for (let frame = 0; frame < 3; frame++) {
      original.mockReturnValue(1);
      expect(core.getDrawableOpacity(0)).toBe(0);
      expect(core.getDrawableOpacity(1)).toBe(1);
    }
  });

  it("restores the original accessor when uninstalled", () => {
    const { core, original } = fakeCore({ ArtMesh153: 1, ArtMesh156: 1 });
    const restore = installHiddenDrawableGuard(core);
    expect(core.getDrawableOpacity).not.toBe(original);
    restore();
    expect(core.getDrawableOpacity).toBe(original);
    expect(core.getDrawableOpacity(0)).toBe(1);
  });

  it("ignores hidden ids that the model does not contain", () => {
    const { core } = fakeCore({ ArtMesh156: 0.7 });
    installHiddenDrawableGuard(core, ["ArtMesh999"]);
    expect(core.getDrawableOpacity(0)).toBe(0.7);
  });
});

describe("NON_BODY_DRAWABLE_IDS", () => {
  it("lists the Head mesh, the hidden scenery, the chair and the foot shadow", () => {
    expect([...NON_BODY_DRAWABLE_IDS].sort()).toEqual([
      "ArtMesh153", "ArtMesh154", "ArtMesh155", "ArtMesh156", "ArtMesh157", "ArtMesh23",
    ]);
  });
});

describe("pointInTriangle", () => {
  const ax = 0, ay = 0, bx = 10, by = 0, cx = 0, cy = 10;
  it("accepts interior points and the edges", () => {
    expect(pointInTriangle(2, 2, ax, ay, bx, by, cx, cy)).toBe(true);
    expect(pointInTriangle(5, 0, ax, ay, bx, by, cx, cy)).toBe(true);
  });
  it("rejects exterior points regardless of winding order", () => {
    expect(pointInTriangle(20, 20, ax, ay, bx, by, cx, cy)).toBe(false);
    expect(pointInTriangle(2, 2, ax, ay, cx, cy, bx, by)).toBe(true);
    expect(pointInTriangle(-1, 5, ax, ay, cx, cy, bx, by)).toBe(false);
  });
});

describe("resolveFireflyHitRegions", () => {
  const COVER = () => true;
  const drawable = (overrides: Partial<HitRegionDrawable> & { id: string }): HitRegionDrawable => ({
    index: 0,
    opacity: 1,
    ...overrides,
  });

  it("returns Head when the Head area is hit, even if Body is also under the pointer", () => {
    expect(resolveFireflyHitRegions({
      headHit: true,
      drawables: [drawable({ id: "ArtMesh200", index: 1 })],
      excludedDrawableIds: NON_BODY_DRAWABLE_IDS,
      isPointInDrawable: COVER,
    })).toEqual(["Head"]);
  });

  it("returns Body for a visible mesh that is not excluded", () => {
    expect(resolveFireflyHitRegions({
      headHit: false,
      drawables: [drawable({ id: "ArtMesh200", index: 1 })],
      excludedDrawableIds: NON_BODY_DRAWABLE_IDS,
      isPointInDrawable: (index) => index === 1,
    })).toEqual(["Body"]);
  });

  it("does not count the chair or the foot shadow as Body", () => {
    for (const id of ["ArtMesh156", "ArtMesh157"]) {
      expect(resolveFireflyHitRegions({
        headHit: false,
        drawables: [drawable({ id })],
        excludedDrawableIds: NON_BODY_DRAWABLE_IDS,
        isPointInDrawable: COVER,
      }), id).toEqual([]);
    }
  });

  it("does not count hidden scenery (opacity zero) as Body", () => {
    for (const id of ["ArtMesh153", "ArtMesh154", "ArtMesh155"]) {
      expect(resolveFireflyHitRegions({
        headHit: false,
        drawables: [drawable({ id, opacity: 0 })],
        excludedDrawableIds: new Set<string>(),
        isPointInDrawable: COVER,
      }), id).toEqual([]);
    }
  });

  it("does not count the Head mesh as Body when Head was not hit", () => {
    expect(resolveFireflyHitRegions({
      headHit: false,
      drawables: [drawable({ id: "ArtMesh23" })],
      excludedDrawableIds: NON_BODY_DRAWABLE_IDS,
      isPointInDrawable: COVER,
    })).toEqual([]);
  });

  it("returns nothing when no candidate mesh contains the point", () => {
    expect(resolveFireflyHitRegions({
      headHit: false,
      drawables: [drawable({ id: "ArtMesh200", index: 0 })],
      excludedDrawableIds: NON_BODY_DRAWABLE_IDS,
      isPointInDrawable: () => false,
    })).toEqual([]);
  });
});
