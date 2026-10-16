// SlidingTabs — a capsule tab strip whose active "thumb" slides to the selected tab.
// One component serves every tab row in the app: the right inspector, the browser window and any
// panel that needs a segmented switch. Tabs may be closable and the track scrolls sideways when
// there are more tabs than fit, so the same strip works for 3 fixed segments or 12 open files.
//
// The thumb is measured from the real tab elements (not an equal split), because labels differ in width.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import "./SlidingTabs.css";

export interface SlidingTabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Native tooltip, e.g. the full path when the label is only a file name. */
  title?: string;
  /** Shows a close control and enables Delete / middle-click. Defaults to false. */
  closable?: boolean;
  closeLabel?: string;
  disabled?: boolean;
  /** Plays the collapse state while a close is in flight. */
  closing?: boolean;
  /** Extra class for the tab item wrapper. */
  className?: string;
  /** Data attributes forwarded to the tab button and the close button, for tests and automation. */
  tabData?: Record<string, string>;
  closeData?: Record<string, string>;
}

export interface SlidingTabsProps {
  tabs: readonly SlidingTabItem[];
  /** The selected tab; null or an unknown id shows no selection. */
  activeId: string | null;
  onChange(id: string): void;
  onClose?(id: string): void;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
  /** Spread the tabs across the full width (fixed, few segments). Default: tabs keep their own width. */
  stretch?: boolean;
}

interface Thumb { left: number; width: number }

export function SlidingTabs({ tabs, activeId, onChange, onClose, size = "md", ariaLabel, className = "", stretch = false }: SlidingTabsProps) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const [settled, setSettled] = useState(false);
  const activeKey = tabs.some(tab => tab.id === activeId) ? activeId : null;

  const measure = useCallback(() => {
    const element = track.current?.querySelector<HTMLElement>(".ff-sliding-tabs__item[data-active='true']");
    setThumb(current => {
      if (!element) return current === null ? current : null;
      const next = { left: element.offsetLeft, width: element.offsetWidth };
      return current && current.left === next.left && current.width === next.width ? current : next;
    });
  }, []);

  // Re-measure whenever the selection or the set of tabs changes, before paint, so the thumb never flashes in the wrong place.
  useLayoutEffect(measure, [measure, activeKey, tabs.length, tabs.map(tab => tab.id + (tab.closing ? "x" : "")).join("|")]);
  useEffect(() => {
    // The first placement must not animate from the left edge.
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const element = track.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll(".ff-sliding-tabs__item").forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, [measure, tabs.length]);
  useEffect(() => {
    track.current?.querySelector<HTMLElement>(".ff-sliding-tabs__item[data-active='true']")?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeKey]);

  function move(from: number, step: number | "first" | "last") {
    const enabled = tabs.map((tab, index) => ({ tab, index })).filter(entry => !entry.tab.disabled);
    if (enabled.length === 0) return;
    const position = enabled.findIndex(entry => entry.index === from);
    const target = step === "first" ? enabled[0]
      : step === "last" ? enabled[enabled.length - 1]
      : enabled[(Math.max(position, 0) + step + enabled.length) % enabled.length];
    onChange(target.tab.id);
    track.current?.querySelectorAll<HTMLElement>("[role='tab']")[target.index]?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
    const index = Array.from(track.current?.querySelectorAll("[role='tab']") ?? []).indexOf(target);
    if (index < 0) return;
    const key = event.key;
    if (key === "ArrowRight" || key === "ArrowLeft") { event.preventDefault(); move(index, key === "ArrowRight" ? 1 : -1); }
    else if (key === "Home" || key === "End") { event.preventDefault(); move(index, key === "Home" ? "first" : "last"); }
    else if (key === "Delete" && tabs[index]?.closable && onClose) { event.preventDefault(); event.stopPropagation(); onClose(tabs[index].id); }
  }

  return (
    <div ref={track} className={`ff-sliding-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel} data-size={size} data-stretch={stretch || undefined}
      data-settled={settled || undefined} onKeyDown={onKeyDown}>
      {thumb && <span className="ff-sliding-tabs__thumb" aria-hidden="true" style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }} />}
      {tabs.map(tab => {
        const active = tab.id === activeKey;
        const closable = tab.closable === true && onClose !== undefined;
        return (
          <div key={tab.id} className={["ff-sliding-tabs__item", tab.className, tab.closing ? "is-closing" : ""].filter(Boolean).join(" ")}
            data-active={active} data-closable={closable || undefined}
            onAuxClick={event => { if (event.button === 1 && closable && !tab.disabled) { event.preventDefault(); onClose!(tab.id); } }}>
            <button type="button" role="tab" aria-selected={active} tabIndex={active || (activeKey === null && tab === tabs[0]) ? 0 : -1}
              disabled={tab.disabled} title={tab.title} className="ff-sliding-tabs__tab" onClick={() => onChange(tab.id)} {...tab.tabData}>
              {tab.icon && <span className="ff-sliding-tabs__icon" aria-hidden="true">{tab.icon}</span>}
              <span className="ff-sliding-tabs__label">{tab.label}</span>
            </button>
            {closable && (
              <button type="button" className="ff-sliding-tabs__close" tabIndex={-1} disabled={tab.disabled} aria-label={tab.closeLabel ?? "Close"}
                onClick={() => onClose!(tab.id)} {...tab.closeData}>
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
