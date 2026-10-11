import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Mock pixi-live2d-display before importing manager.ts so we don't have to
 * boot a real WebGL context in the test runner.
 */
vi.mock("pixi-live2d-display/cubism4", () => {
  return {
    MotionPriority: { IDLE: 1, NORMAL: 2 },
    Live2DModel: class {
      static from = vi.fn();
      motion = vi.fn(async () => true);
      expression = vi.fn(async () => true);
      internalModel = { motionManager: { definitions: { "动作#6": [{}, {}, {}, {}] } } };
    },
  };
});

vi.mock("pixi.js", () => {
  return {
    Application: class {
      renderer = { resize: vi.fn(), gl: { drawingBufferWidth: 200, drawingBufferHeight: 100 } };
      stage = { children: [] as unknown[], addChild: vi.fn((child: unknown) => { this.stage.children.push(child); }) };
      ticker = { started: true, stop: vi.fn(() => { this.ticker.started = false; }), start: vi.fn(() => { this.ticker.started = true; }) };
      render = vi.fn();
      destroy = vi.fn();
    },
    Renderer: class {},
    Point: class { x: number; y: number; constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
    utils: { TextureCache: { a: {}, b: {} } },
  };
});

// Minimal stub canvas; we never read pixels in these tests.
const fakeCanvas = {} as HTMLCanvasElement;

describe("Live2DManager.playAction", () => {
  it("is a no-op when the model is not loaded", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    // init() will try to load the real model — we never call it, so model stays null
    expect(await mgr.playAction({ kind: "expression", name: "expression4" })).toBe(false);
    // No assertion needed beyond "did not throw"
  });

  it("deduplicates concurrent initialization so only one model is loaded", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { devicePixelRatio: 1, innerWidth: 100, innerHeight: 100 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const model = {
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 100, height: 100,
      destroy: vi.fn(), motion: vi.fn(), expression: vi.fn(), internalModel: { motionManager: { definitions: {} } },
    };
    vi.mocked(Live2DModel.from).mockResolvedValue(model as never);
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });

    await Promise.all([mgr.init(), mgr.init()]);

    expect(Live2DModel.from).toHaveBeenCalledTimes(1);
    mgr.dispose();
    vi.unstubAllGlobals();
  });

  it("reports resource metrics for app, model, ticker, and texture cache", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { devicePixelRatio: 2, innerWidth: 100, innerHeight: 100 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const model = {
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 100, height: 100,
      destroy: vi.fn(), motion: vi.fn(), expression: vi.fn(), internalModel: { motionManager: { definitions: {} } },
    };
    vi.mocked(Live2DModel.from).mockResolvedValue(model as never);
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });

    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: false,
      modelLoaded: false,
      disposed: false,
    });

    await mgr.init();

    expect((mgr as unknown as { app: { ticker: { maxFPS: number } } }).app.ticker.maxFPS).toBe(60);
    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: true,
      modelLoaded: true,
      disposed: false,
      tickerStarted: true,
      stageChildren: 1,
    });

    mgr.dispose();
    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: false,
      modelLoaded: false,
      disposed: true,
    });
    vi.unstubAllGlobals();
  });

  it("loads the actual Firefly manifest and reconnects hit areas after model reload", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { devicePixelRatio: 1, innerWidth: 100, innerHeight: 100 });
    const manifest = JSON.parse(readFileSync("src/renderer/public/models/firefly/Firefly.model3.json", "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifest })));
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const models = Array.from({ length: 2 }, () => ({
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 100, height: 100,
      destroy: vi.fn(), motion: vi.fn(async () => true), expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: { Idle: [{}, {}, {}], Tap: [{}, {}, {}] } } },
    }));
    vi.mocked(Live2DModel.from).mockResolvedValueOnce(models[0] as never).mockResolvedValueOnce(models[1] as never);
    const { Live2DManager } = await import("./manager");
    for (const model of models) {
      const manager = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/models/firefly/Firefly.model3.json" });
      await manager.init();
      expect(manager.getHitAreaDefs()).toEqual([
        { name: "Body", id: "ArtMesh154" },
        { name: "Head", id: "ArtMesh23" },
      ]);
      expect(await manager.playAction({ kind: "motion", group: "Tap", motionName: "1" })).toBe(true);
      expect(model.motion).toHaveBeenCalledWith("Tap", 1, 2);
      expect(await manager.playAction({ kind: "expression", name: "expression4" })).toBe(true);
      manager.dispose();
      expect(manager.getHitAreaDefs()).toEqual([]);
    }
    expect(Live2DModel.from).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("calls model.expression for an expression target", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    // Inject a fake model directly
    (mgr as unknown as { model: unknown }).model = {
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    (mgr as unknown as { expressionNames: Set<string> }).expressionNames = new Set(["expression4"]);
    expect(await mgr.playAction({ kind: "expression", name: "expression4" })).toBe(true);
    const model = (mgr as unknown as { model: { expression: ReturnType<typeof vi.fn> } }).model;
    expect(model.expression).toHaveBeenCalledWith("expression4");
  });

  it("resolves motionName to the right index in the right group", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    const motionMock = vi.fn(async () => true);
    (mgr as unknown as { model: unknown }).model = {
      motion: motionMock,
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: { "动作#6": [{ Name: "动作回正" }, { Name: "Wink~" }, { Name: "我可爱吧~" }, { Name: "笑一笑吧~" }] } } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };
    // Inject the motionIndexMap that loadModel() would normally build from the JSON.
    (mgr as unknown as { motionIndexMap: Map<string, Map<string, number>> }).motionIndexMap = new Map([
      ["动作#6", new Map([
        ["动作回正", 0],
        ["Wink~", 1],
        ["我可爱吧~", 2],
        ["笑一笑吧~", 3],
      ])],
    ]);

    await mgr.playAction({ kind: "motion", group: "动作#6", motionName: "Wink~" });
    expect(motionMock).toHaveBeenCalledWith("动作#6", 1, 2);

    await mgr.playAction({ kind: "motion", group: "动作#6", motionName: "笑一笑吧~" });
    expect(motionMock).toHaveBeenLastCalledWith("动作#6", 3, 2);
  });

  it("rejects unknown motions without substituting an expression", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    const motionMock = vi.fn(async () => false);
    const expressionMock = vi.fn(async () => true);
    (mgr as unknown as { model: unknown }).model = {
      motion: motionMock,
      expression: expressionMock,
      internalModel: { motionManager: { definitions: { "动作#6": [{ Name: "动作回正" }] } } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    expect(await mgr.playAction({ kind: "motion", group: "动作#6", motionName: "Wink~" })).toBe(false);
    expect(expressionMock).not.toHaveBeenCalled();
  });

  it("swallows model errors and logs a warning", async () => {
    const { Live2DManager } = await import("./manager");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    (mgr as unknown as { model: unknown }).model = {
      motion: vi.fn(async () => { throw new Error("boom"); }),
      expression: vi.fn(async () => { throw new Error("boom"); }),
      internalModel: { motionManager: { definitions: {} } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    (mgr as unknown as { expressionNames: Set<string> }).expressionNames = new Set(["expression4"]);
    expect(await mgr.playAction({ kind: "expression", name: "expression4" })).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});


describe("Firefly hidden drawables and hit regions", () => {
  type Spec = {
    drawables: Array<{ id: string; opacity: number; triangle: number[] }>;
    headHit?: boolean;
  };

  function makeFakeModel(spec: Spec) {
    const core = {
      getDrawableIndex: (id: string) => spec.drawables.findIndex((drawable) => drawable.id === id),
      getDrawableOpacity: vi.fn((index: number) => spec.drawables[index].opacity),
      getDrawableVertexIndices: () => new Uint16Array([0, 1, 2]),
    };
    const internal = {
      coreModel: core,
      motionManager: { definitions: {} },
      getDrawableIDs: () => spec.drawables.map((drawable) => drawable.id),
      getDrawableVertices: (index: number) => new Float32Array(spec.drawables[index].triangle),
    };
    const model = {
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 400, height: 500,
      destroy: vi.fn(), motion: vi.fn(), expression: vi.fn(),
      hitTest: vi.fn(() => (spec.headHit ? ["Head"] : [])),
      toModelPosition: vi.fn((point: { x: number; y: number }) => point),
      internalModel: internal,
    };
    return { model, core, internal };
  }

  async function loadFake(spec: Spec) {
    vi.stubGlobal("window", { devicePixelRatio: 1, innerWidth: 400, innerHeight: 500 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      HitAreas: [{ Name: "Body", Id: "ArtMesh154" }, { Name: "Head", Id: "ArtMesh23" }],
      FileReferences: { Expressions: [] },
    }) })));
    const fake = makeFakeModel(spec);
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    vi.mocked(Live2DModel.from).mockReset().mockResolvedValue(fake.model as never);
    const { Live2DManager } = await import("./manager");
    const manager = new Live2DManager({ canvas: fakeCanvas, width: 400, height: 500, modelPath: "/x" });
    await manager.init();
    return { manager, ...fake };
  }

  // 三角形 (0,0)-(10,0)-(0,10)：点 (2,2) 在内，(20,20) 在外。
  const COVER = [0, 0, 10, 0, 0, 10];
  const ALL_IDS = ["ArtMesh153", "ArtMesh154", "ArtMesh155", "ArtMesh156", "ArtMesh157", "ArtMesh23", "ArtMesh200"];
  const single = (id: string, opacity = 1): Spec => ({
    drawables: ALL_IDS.map((drawableId) => ({
      id: drawableId,
      opacity: 1,
      triangle: drawableId === id ? COVER : [100, 100, 110, 100, 100, 110],
    })).map((drawable) => (drawable.id === id ? { ...drawable, opacity } : drawable)),
  });

  it("hides the drink, cake plate and table by drawable index and keeps the chair and shadow visible", async () => {
    const f = await loadFake(single("ArtMesh156"));
    try {
      const opacityOf = (id: string) => f.core.getDrawableOpacity(f.core.getDrawableIndex(id));
      expect(opacityOf("ArtMesh153")).toBe(0);
      expect(opacityOf("ArtMesh154")).toBe(0);
      expect(opacityOf("ArtMesh155")).toBe(0);
      expect(opacityOf("ArtMesh156")).toBe(1);
      expect(opacityOf("ArtMesh157")).toBe(1);
    } finally {
      f.manager.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("restores the original opacity accessor on dispose", async () => {
    const f = await loadFake(single("ArtMesh200"));
    const hookedAccessor = f.core.getDrawableOpacity;
    f.manager.dispose();
    expect(f.core.getDrawableOpacity).not.toBe(hookedAccessor);
    expect(f.core.getDrawableOpacity(f.core.getDrawableIndex("ArtMesh153"))).toBe(1);
    vi.unstubAllGlobals();
  });

  it("returns Head from the model hit area before considering Body", async () => {
    const f = await loadFake({ ...single("ArtMesh200"), headHit: true });
    try {
      expect(f.manager.hitTestRegions(2, 2)).toEqual(["Head"]);
    } finally {
      f.manager.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("hits Body on a visible mesh that is not scenery", async () => {
    const f = await loadFake(single("ArtMesh200"));
    try {
      expect(f.manager.hitTestRegions(2, 2)).toEqual(["Body"]);
      expect(f.manager.hitTestRegions(20, 20)).toEqual([]);
    } finally {
      f.manager.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("does not hit Body on the chair or the foot shadow", async () => {
    for (const id of ["ArtMesh156", "ArtMesh157"]) {
      const f = await loadFake(single(id));
      try {
        expect(f.manager.hitTestRegions(2, 2), id).toEqual([]);
      } finally {
        f.manager.dispose();
        vi.unstubAllGlobals();
      }
    }
  });

  it("does not hit the hidden drink, cake plate or table", async () => {
    for (const id of ["ArtMesh153", "ArtMesh154", "ArtMesh155"]) {
      const f = await loadFake(single(id));
      try {
        expect(f.manager.hitTestRegions(2, 2), id).toEqual([]);
      } finally {
        f.manager.dispose();
        vi.unstubAllGlobals();
      }
    }
  });

  it("does not count the Head mesh as Body when the Head area was not hit", async () => {
    const f = await loadFake(single("ArtMesh23"));
    try {
      expect(f.manager.hitTestRegions(2, 2)).toEqual([]);
    } finally {
      f.manager.dispose();
      vi.unstubAllGlobals();
    }
  });
});
