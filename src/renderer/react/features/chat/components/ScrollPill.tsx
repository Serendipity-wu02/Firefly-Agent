// 对话区的滚动指示：一根固定长度的小圆条，代替会随内容变长的原生滚动条。
// 它跟着阅读列的右边走，而不是贴着窗口右边、右侧卡片的左边，这样不会把对话和卡片隔开。
// 平时隐藏，指针在对话区上或刚滚动过时出现；可以拖动。
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import "./ScrollPill.css";

/** Pill length and the margin kept from the top and bottom of the conversation. */
export const PILL_LENGTH = 36;
const EDGE = 8;
/** Space between the reading column and the pill. */
const GAP = 14;
const IDLE_MS = 900;

export interface PillGeometry { top: number; left: number; visible: boolean }

/** Where the pill sits for a given scroll position; pure so it can be tested without layout. */
export function pillGeometry(input: { scrollTop: number; scrollHeight: number; clientHeight: number; columnRight: number; width: number }): PillGeometry {
  const range = input.scrollHeight - input.clientHeight;
  if (range <= 1) return { top: EDGE, left: 0, visible: false };
  const ratio = Math.min(1, Math.max(0, input.scrollTop / range));
  const travel = Math.max(0, input.clientHeight - PILL_LENGTH - EDGE * 2);
  const left = Math.min(input.width - 10, Math.max(0, input.columnRight + GAP));
  return { top: Math.round(EDGE + ratio * travel), left: Math.round(left), visible: true };
}

export function ScrollPill({ target, column, onUserScroll }: {
  target: RefObject<HTMLElement | null>; column: string;
  /** Called as the pill is dragged, so bottom-pinning treats it as the user's own scroll and lets go. */
  onUserScroll?(): void;
}) {
  const [geometry, setGeometry] = useState<PillGeometry>({ top: EDGE, left: 0, visible: false });
  const [active, setActive] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ pointerId: number; startY: number; startTop: number } | null>(null);

  const measure = useCallback(() => {
    const element = target.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const columnBox = element.querySelector(column)?.getBoundingClientRect();
    setGeometry(pillGeometry({
      scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      columnRight: columnBox ? columnBox.right - box.left : box.width - 20, width: box.width,
    }));
  }, [target, column]);

  const wake = useCallback(() => {
    setActive(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => { if (!drag.current) setActive(false); }, IDLE_MS);
  }, []);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onScroll = () => { measure(); wake(); };
    const onEnter = () => { measure(); setActive(true); clearTimeout(idle.current); };
    const onLeave = () => { if (!drag.current) setActive(false); };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("pointerenter", onEnter);
    element.addEventListener("pointerleave", onLeave);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    // Watch every child (a channel banner can come before the message column), and keep up as children come and go.
    const observeChildren = () => {
      if (!observer) return;
      observer.disconnect();
      observer.observe(element);
      for (const child of Array.from(element.children)) observer.observe(child);
    };
    observeChildren();
    const mutations = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(() => { observeChildren(); measure(); });
    mutations?.observe(element, { childList: true });
    measure();
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("pointerenter", onEnter);
      element.removeEventListener("pointerleave", onLeave);
      observer?.disconnect();
      mutations?.disconnect();
      clearTimeout(idle.current);
    };
  }, [target, measure, wake]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startTop: target.current?.scrollTop ?? 0 };
    setActive(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = target.current;
    if (!drag.current || drag.current.pointerId !== event.pointerId || !element) return;
    const travel = Math.max(1, element.clientHeight - PILL_LENGTH - EDGE * 2);
    const range = element.scrollHeight - element.clientHeight;
    onUserScroll?.();
    element.scrollTop = drag.current.startTop + ((event.clientY - drag.current.startY) / travel) * range;
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    wake();
  };

  if (!geometry.visible) return null;
  return (
    <div className={`ff-scroll-pill ${active ? "is-active" : ""}`} aria-hidden="true"
      style={{ top: geometry.top, left: geometry.left, height: PILL_LENGTH }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
  );
}
