import { Live2DManager } from "./live2d/manager";
import "./ui/theme";
import { InteractionController } from "./live2d/interaction";
import { MouseFocusController } from "./live2d/focus";
import { FireflyExpressionState } from "./live2d/expression-state";
import { FireflyActionController } from "./live2d/action-controller";

import { BlinkController } from "./live2d/blink";
// OpenerBubbleController 已被移除（主动开口子系统整体删除）。
import { ClickThroughController } from "./live2d/click-through";
import { Live2DRendererLifecycleTracker } from "./live2d/lifecycle-diagnostics";
import { resolveAsset } from "../shared/renderer-base";
import { LIVE2D_DEFAULT_EXPRESSION, LIVE2D_WORKING_EXPRESSION } from "../shared/live2d-actions";

/** 双击触发的临时表情持续时长（毫秒），结束后恢复到当前基础表情。 */
const DOUBLE_CLICK_EXPRESSION_MS = 5000;

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #live2d-canvas not found");

if (!window.firefly) {
  (window as unknown as { firefly: unknown }).firefly = {
    minimize: () => {},
    setInteractive: (_: boolean) => Promise.resolve(),
    moveTo: (_x: number, _y: number) => {},
    setDragging: (_isDragging: boolean) => {},
    getCursorPosition: () => Promise.resolve(null),
    onPetZoom: (_cb: (zoom: number) => void) => () => {},
    onPetVisibilityChanged: (_cb: (visible: boolean) => void) => () => {},
  };
}

declare global {
  interface Window {

    live2dWork?: {
      onChanged: (callback: (working: boolean) => void) => () => void;
      getWorking?: () => Promise<boolean>;
    };
  }
}

let interaction: InteractionController | null = null;
let focus: MouseFocusController | null = null;
let expressionReset: FireflyExpressionState | null = null;
let actions: FireflyActionController | null = null;

let blink: BlinkController | null = null;
let clickThrough: ClickThroughController | null = null;
let petZoomOff: (() => void) | null = null;
let petVisibilityOff: (() => void) | null = null;
let petVisible = true;

let workOff: (() => void) | null = null;
/** 主进程报告的“工作中”状态；模型加载前到达的状态也以它为准。 */
let workingNow = false;
const live2dLifecycle = new Live2DRendererLifecycleTracker();

function trackSubscription(label: string, off: () => void): () => void {
  return live2dLifecycle.track("subscription", label, off);
}

function addTrackedEventListener(
  target: EventTarget,
  label: string,
  type: string,
  listener: EventListenerOrEventListenerObject,
): void {
  target.addEventListener(type, listener);
  live2dLifecycle.track("listener", label, () => target.removeEventListener(type, listener));
}

const manager = new Live2DManager({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  modelPath: resolveAsset("models/firefly/Firefly.model3.json"),
  onLoad: () => {
    console.log("[Firefly] Model loaded");
    const model = manager.getModel();
    if (!model) return;

    expressionReset = new FireflyExpressionState(model);
    void expressionReset.setBase(currentBaseExpression());
    actions = new FireflyActionController(manager, expressionReset);

    blink = new BlinkController(model);

    interaction = new InteractionController(canvas, model, manager.getHitAreaDefs(), {
      resolveRegions: (x, y) => manager.hitTestRegions(x, y),
      playAction: (target) => actions?.play(target, DOUBLE_CLICK_EXPRESSION_MS) ?? Promise.resolve(false),
      onTrigger: (area, target) => {
        console.info("[Firefly] double-click", area.name, "started", target);
      },
      onMiss: (area, target) =>
        console.info("[Firefly] double-click", area.name, "not started", target),
    });

    focus = new MouseFocusController(canvas, model);
    focus.focusCenter(true);

    clickThrough = new ClickThroughController(canvas, manager, {
      onInteractive: (interactive) => void window.firefly.setInteractive(interactive),
    });

    // Apply the persisted zoom on load and track future changes. The main
    // process has already resized the window to base × zoom; this rescales
    // the model to match.
    petZoomOff = trackSubscription("firefly:onPetZoom", window.firefly.onPetZoom((zoom) => manager.applyZoom(zoom)));
    petVisibilityOff = trackSubscription("firefly:onPetVisibilityChanged", window.firefly.onPetVisibilityChanged((visible) => {
      petVisible = visible;
      if (!visible) {
        clickThrough?.pause();
        focus?.pause();
        manager.pause();
        return;
      }
      if (!isDragging) {
        manager.resume();
        focus?.resume();
        clickThrough?.resume();
      }
    }));

    // 启动竞态修复：主进程在渲染进程就绪前发的 PET_ZOOM 事件会被丢弃。
    // 注册监听后主动从磁盘读一次 petZoom 并应用，确保重启后模型大小生效。
    window.settings?.getGeneral().then((cfg) => {
      if (cfg?.petZoom && cfg.petZoom !== 1) {
        manager.applyZoom(cfg.petZoom);
      }
    }).catch(() => { /* 设置读取失败不影响加载 */ });

    (window as unknown as { __firefly: unknown }).__firefly = {
      manager,
      interaction,
      focus,
      expressionReset,
      resetExpression: () => expressionReset?.resetNow(),
      getLive2DDiagnostics: () => ({
        resources: manager.getResourceMetrics(),
        lifecycle: live2dLifecycle.getDiagnostics(),
        controllers: {
          interaction: interaction !== null,
          focus: focus !== null,
          expressionReset: expressionReset !== null,
          blink: blink !== null,
          clickThrough: clickThrough !== null,
        },
        petVisible,
        isDragging,
      }),
    };
  },
  onError: (err) => {
    console.error("[Firefly] Failed to load model:", err);
  },
});

function currentBaseExpression(): string {
  return workingNow ? LIVE2D_WORKING_EXPRESSION : LIVE2D_DEFAULT_EXPRESSION;
}

// 工作中（工具调用期间）基础表情为 expression6，否则为 expression00；
// 临时表情或手动动作在播时 setBase 只记录，结束后恢复时生效。
workOff = trackSubscription("live2dWork:onChanged", window.live2dWork?.onChanged((working) => {
  workingNow = working === true;
  void expressionReset?.setBase(currentBaseExpression());
}) ?? (() => {}));
// 初始快照：桌宠晚于“true”事件加载或重载时，补上当前是否处于工作中。
// 订阅已先挂好，快照之后到达的跳变事件仍会覆盖它。
void window.live2dWork?.getWorking?.().then((working) => {
  workingNow = working === true;
  void expressionReset?.setBase(currentBaseExpression());
}).catch(() => { /* 读取失败按不在工作处理 */ });

manager.init();

addTrackedEventListener(window, "window:resize", "resize", () => {
  manager.resize(window.innerWidth, window.innerHeight);
  focus?.focusCenter(true);
});

window.addEventListener("beforeunload", () => {
  expressionReset?.dispose();
  expressionReset = null;
  actions?.dispose();
  actions = null;
  workOff?.();
  workOff = null;

  blink?.dispose();
  blink = null;
  focus?.dispose();
  focus = null;
  clickThrough?.dispose();
  clickThrough = null;
  petZoomOff?.();
  petZoomOff = null;
  petVisibilityOff?.();
  petVisibilityOff = null;
  interaction?.dispose();
  interaction = null;
  manager.dispose();
  live2dLifecycle.disposeAll();
});

let isDragging = false;
let didDrag = false;
let dragPointerId: number | null = null;
let dragStartScreenX = 0;
let dragStartScreenY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingPosition: { x: number; y: number } | null = null;
let rafId: number | null = null;
let dragOverlay: HTMLImageElement | null = null;
let dragToken = 0;

let dragOverlayUrl: string | null = null;

function clearDragOverlay(): void {
  if (dragOverlay) {
    dragOverlay.remove();
    dragOverlay = null;
  }
  if (dragOverlayUrl) {
    URL.revokeObjectURL(dragOverlayUrl);
    dragOverlayUrl = null;
  }
  canvas.style.visibility = "";
}

function captureCanvasBlob(): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      // preserveDrawingBuffer is enabled, so the last rendered frame is
      // readable even after the PIXI ticker has been paused.
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch (err) {
      console.warn("[Firefly] canvas.toBlob failed", err);
      resolve(null);
    }
  });
}

async function showDragOverlay(token: number): Promise<void> {
  const blob = await captureCanvasBlob();
  if (!blob || token !== dragToken || !isDragging) return;

  const url = URL.createObjectURL(blob);
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.draggable = false;
  img.style.position = "fixed";
  img.style.inset = "0";
  img.style.width = "100vw";
  img.style.height = "100vh";
  img.style.objectFit = "contain";
  img.style.pointerEvents = "none";
  img.style.userSelect = "none";
  img.style.zIndex = "10";

  img.onload = () => {
    if (token !== dragToken || !isDragging) {
      URL.revokeObjectURL(url);
      return;
    }
    dragOverlay?.remove();
    dragOverlay = img;
    dragOverlayUrl = url;
    document.body.appendChild(img);
    canvas.style.visibility = "hidden";
  };
  img.onerror = () => URL.revokeObjectURL(url);
}

function scheduleMoveTo(screenX: number, screenY: number): void {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  if (!Number.isFinite(dragOffsetX) || !Number.isFinite(dragOffsetY)) return;
  pendingPosition = {
    x: screenX - dragOffsetX,
    y: screenY - dragOffsetY,
  };
  if (rafId === null) {
    rafId = requestAnimationFrame(flushMove);
  }
}

function flushMove(): void {
  rafId = null;
  if (pendingPosition) {
    window.firefly.moveTo(pendingPosition.x, pendingPosition.y);
    pendingPosition = null;
  }
}

function cancelPendingMove(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingPosition = null;
}

function finishDrag(): void {
  isDragging = false;
  didDrag = false;
  dragPointerId = null;
  dragToken += 1;
  cancelPendingMove();
  clearDragOverlay();
  if (petVisible) {
    manager.resume();
    focus?.resume();
  }
  window.firefly.setDragging(false);
  if (petVisible) clickThrough?.resume();
}

// Click-through is driven per-pixel by ClickThroughController on pointermove.
// We only need enter/leave to bookend the cursor's stay in the window:
// entering hands control to the controller, leaving the window entirely
// means there's nothing to capture (and no move will fire), so pass through.
addTrackedEventListener(canvas, "canvas:pointerenter", "pointerenter", () => {
  clickThrough?.resume();
});

addTrackedEventListener(canvas, "canvas:pointercancel", "pointercancel", (e) => {
  if (isDragging && (e as PointerEvent).pointerId === dragPointerId) finishDrag();
});

addTrackedEventListener(canvas, "canvas:pointerleave", "pointerleave", () => {
  if (isDragging) return;
  void window.firefly.setInteractive(false);
});

addTrackedEventListener(canvas, "canvas:pointerdown", "pointerdown", (e) => {
  const event = e as PointerEvent;
  if (isDragging || event.button !== 0) return;
  if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;
  if (!Number.isFinite(window.screenX) || !Number.isFinite(window.screenY)) return;
  isDragging = true;
  didDrag = false;
  dragPointerId = event.pointerId;
  dragStartScreenX = event.screenX;
  dragStartScreenY = event.screenY;
  dragToken += 1;
  dragOffsetX = event.screenX - window.screenX;
  dragOffsetY = event.screenY - window.screenY;
  cancelPendingMove();
  clickThrough?.pause();
  focus?.pause(true);
  manager.pause();
  void window.firefly.setInteractive(true);
  try {
    (event.target as Element).setPointerCapture(event.pointerId);
  } catch {}
});

addTrackedEventListener(canvas, "canvas:pointermove", "pointermove", (e) => {
  const event = e as PointerEvent;
  if (!isDragging || event.pointerId !== dragPointerId) return;
  if (!didDrag && Math.hypot(event.screenX - dragStartScreenX, event.screenY - dragStartScreenY) > 5) {
    didDrag = true;
    window.firefly.setDragging(true);
    void showDragOverlay(dragToken);
  }
  if (!didDrag) return;
  scheduleMoveTo(event.screenX, event.screenY);
});

addTrackedEventListener(canvas, "canvas:pointerup", "pointerup", (e) => {
  const event = e as PointerEvent;
  if (!isDragging || event.pointerId !== dragPointerId) return;
  const moved = didDrag;
  if (moved) scheduleMoveTo(event.screenX, event.screenY);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  flushMove();
  finishDrag();

  try {
    (event.target as Element).releasePointerCapture(event.pointerId);
  } catch {}

  const rect = canvas.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) void window.firefly.setInteractive(false);
});
