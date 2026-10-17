// RightInspector — 右侧面板，参照 Claude 桌面版：
// - 打开的项（浏览器、文件、文件预览、改动、任务……）是大面板，默认横向并列，中间的分隔条可以拖动调宽（或用方向键）；
// - 拖动面板标题栏可以把它挪到另一块的左边/右边（并列）或上边/下边（叠放）；Alt+方向键也能挪；
// - 打开/关闭由主区标题行的图标开关负责，这里没有标签条。标题行：图标、名称、状态 ··· 放大、关闭。
// 放大时其余大面板隐藏（保持挂载，浏览器等状态不丢）；关闭后的焦点回退仍由上层 ChatPage 决定。
// 浏览器面板里是原生视图，会盖住页面：拖动期间先把它的内容区收起（它自己遇到零尺寸就会隐藏原生视图），松手后复原。

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { File, Files, FolderTree, GitCompareArrows, Globe, ListChecks, Maximize2, Minimize2, SquareTerminal, X } from "lucide-react";
import { useTranslation } from "../../../i18n";
import { DRAG_DEAD_ZONE } from "./reorder-list";
import { dropZoneAt, movePanel, reconcileColumns, gridPlacement, MIN_COLUMN_WIDTH, resizeColumns, shiftPanel, type DropZone, type PanelColumn } from "./panel-layout";
import "./RightInspector.css";

export interface InspectorTab {
  id: string;
  label: string;
  /** Full path/context for tabs that share the same visible basename. */
  title?: string;
  kind?: "files" | "file" | "diff" | "browser" | "tasks" | "plan" | "result";
  status?: ReactNode;
  /** 阶段色点 class（如 is-review / is-executing / is-completed），不传则不显示 */
  dotClass?: string;
  /** 是否允许关闭；不传默认可关 */
  closable?: boolean;
  content: ReactNode;
}

const tabIcons = { files: FolderTree, file: File, diff: GitCompareArrows, browser: Globe, tasks: SquareTerminal, plan: ListChecks, result: Files };

type Box = { left: number; top: number; width: number; height: number };
interface PanelDrag { id: string; startX: number; startY: number; active: boolean; x: number; y: number; drop: { id: string; zone: DropZone; box: Box } | null }
type Direction = "left" | "right" | "up" | "down";
const ARROW_DIRECTION: Record<string, Direction | undefined> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export function RightInspector({
  tabs,
  activeTabId,
  onTabChange,
  onCloseTab,
  visible = true,
}: {
  tabs: InspectorTab[];
  visible?: boolean;
  /** 当前聚焦的面板 ID，不在列表中时回退到第一块 */
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  /** 关闭指定面板 */
  onCloseTab: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<PanelColumn[]>([]);
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const paneRefs = useRef(new Map<string, HTMLElement>());
  const stopRef = useRef<(() => void) | null>(null);
  const columnsRef = useRef<PanelColumn[]>([]);
  useEffect(() => () => stopRef.current?.(), []);
  if (tabs.length === 0) return null;
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  const panels = tabs;
  const columns = reconcileColumns(saved, panels.map(tab => tab.id));
  columnsRef.current = columns;
  const byId = new Map(panels.map(tab => [tab.id, tab]));
  const expandedId = expanded !== null && panels.length > 1 && panels.some(tab => tab.id === expanded) ? expanded : null;
  const focus = (id: string) => { if (id !== active.id) onTabChange(id); };
  const activeDrag = drag?.active ? drag : null;
  // Expanding one panel lays it out alone; the others stay mounted, just hidden.
  const placed = expandedId === null ? columns : [{ ids: [expandedId], weight: 1 }];
  const { rows, byId: placement } = gridPlacement(placed);

  /** The panel under the pointer and which edge of it the pointer is nearest, for the drop marker. */
  const dropAt = (id: string, x: number, y: number): PanelDrag["drop"] => {
    const aside = asideRef.current;
    if (!aside) return null;
    const origin = aside.getBoundingClientRect();
    for (const node of aside.querySelectorAll<HTMLElement>("[data-inspector-pane]")) {
      const targetId = node.dataset.inspectorPane!;
      const rect = node.getBoundingClientRect();
      if (targetId === id || node.hidden || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const zone = dropZoneAt(rect, x, y);
      // Show the half of the panel the dragged one would take.
      const sideways = zone === "left" || zone === "right";
      const width = sideways ? rect.width / 2 : rect.width, height = sideways ? rect.height : rect.height / 2;
      const left = rect.left - origin.left + (zone === "right" ? width : 0), top = rect.top - origin.top + (zone === "bottom" ? height : 0);
      return { id: targetId, zone, box: { left, top, width, height } };
    }
    return null;
  };
  // Drags listen on the window, so they follow the pointer wherever it goes and never depend on pointer capture.
  const listen = (handlers: { move(event: PointerEvent): void; up(): void; cancel(): void; key?(event: globalThis.KeyboardEvent): void }) => {
    const stop = () => {
      window.removeEventListener("pointermove", handlers.move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", abort);
      if (handlers.key) window.removeEventListener("keydown", handlers.key);
      stopRef.current = null;
    };
    const end = () => { stop(); handlers.up(); };
    const abort = () => { stop(); handlers.cancel(); };
    window.addEventListener("pointermove", handlers.move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", abort);
    if (handlers.key) window.addEventListener("keydown", handlers.key);
    stopRef.current = stop;
    return abort;
  };
  const beginPanelDrag = (tab: InspectorTab, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button") || panels.length < 2 || expandedId !== null) return;
    stopRef.current?.();
    let state: PanelDrag = { id: tab.id, startX: event.clientX, startY: event.clientY, active: false, x: event.clientX, y: event.clientY, drop: null };
    setDrag(state);
    const abort = listen({
      move: next => {
        if (!state.active && Math.hypot(next.clientX - state.startX, next.clientY - state.startY) <= DRAG_DEAD_ZONE) return;
        state = { ...state, active: true, x: next.clientX, y: next.clientY, drop: dropAt(tab.id, next.clientX, next.clientY) };
        setDrag(state);
      },
      up: () => {
        if (state.active && state.drop) setSaved(movePanel(columnsRef.current, state.id, state.drop.id, state.drop.zone));
        setDrag(null);
      },
      cancel: () => setDrag(null),
      // Escape puts a lifted panel back.
      key: next => { if (next.key === "Escape") abort(); },
    });
  };
  const columnWidths = () => columns.map(column => paneRefs.current.get(column.ids[0]!)?.getBoundingClientRect().width ?? 0);
  const startResize = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    stopRef.current?.();
    const widths = columnWidths();
    const startX = event.clientX;
    setResizing(true);
    listen({
      move: next => setSaved(resizeColumns(columnsRef.current, index, widths, (widths[index] ?? 0) + next.clientX - startX)),
      up: () => setResizing(false),
      cancel: () => setResizing(false),
    });
  };
  const resizeByKey = (index: number, event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const widths = columnWidths();
    setSaved(resizeColumns(columns, index, widths, (widths[index] ?? 0) + (event.key === "ArrowRight" ? 16 : -16)));
  };

  return (
    <aside ref={asideRef} className="ff-right-inspector" hidden={!visible} inert={!visible} aria-label={t("rightInspector.panelAria")}
      data-has-panels={panels.length > 0 || undefined} data-shielded={activeDrag || resizing ? true : undefined} data-moving={activeDrag ? true : undefined}>
      <div className="ff-inspector-grid" style={{
        gridTemplateColumns: placed.flatMap((column, index) => [...(index > 0 ? ["8px"] : []), `minmax(${MIN_COLUMN_WIDTH}px, ${column.weight}fr)`]).join(" "),
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}>
        {expandedId === null && columns.slice(1).map((column, index) => (
          <div key={`resizer:${column.ids[0]}`} className="ff-inspector-resizer" role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label={t("rightInspector.resize")} style={{ gridColumn: (index + 1) * 2, gridRow: "1 / -1" }}
            onPointerDown={event => startResize(index, event)} onKeyDown={event => resizeByKey(index, event)} />
        ))}
        {panels.map(tab => {
          const Icon = tab.kind ? tabIcons[tab.kind] : undefined;
          const closable = tab.closable !== false;
          const isExpanded = expandedId === tab.id;
          const spot = placement.get(tab.id);
          return (
            <section key={tab.id} ref={node => { if (node) paneRefs.current.set(tab.id, node); else paneRefs.current.delete(tab.id); }}
              className="ff-inspector-pane" data-inspector-pane={tab.id} data-inspector-kind={tab.kind}
              data-active={tab.id === active.id || undefined} data-lifted={activeDrag?.id === tab.id || undefined}
              hidden={expandedId !== null && !isExpanded}
              aria-label={tab.title ?? tab.label}
              style={spot ? { gridColumn: spot.column, gridRow: `${spot.row} / span ${spot.span}` } : undefined}
              onFocusCapture={() => focus(tab.id)} onPointerDownCapture={() => focus(tab.id)}>
              <header className="ff-inspector-pane__head" tabIndex={0} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                onPointerDown={event => beginPanelDrag(tab, event)}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return;
                  // Delete on a focused header closes that panel, like its close button.
                  if (event.key === "Delete" && closable) { event.preventDefault(); onCloseTab(tab.id); return; }
                  if (event.key === "Escape" && activeDrag) { event.preventDefault(); setDrag(null); return; }
                  const direction = event.altKey ? ARROW_DIRECTION[event.key] : undefined;
                  if (direction && expandedId === null) { event.preventDefault(); setSaved(shiftPanel(columns, tab.id, direction)); }
                }}
                onDoubleClick={event => {
                  if (!(event.target as HTMLElement).closest("button") && panels.length > 1) setExpanded(isExpanded ? null : tab.id);
                }}>
                {Icon && <Icon size={14} className="ff-inspector-pane__icon" aria-hidden="true" />}
                {tab.dotClass && <span className={`ff-right-inspector__dot ${tab.dotClass}`} aria-hidden="true" />}
                <span className="ff-inspector-pane__title" title={tab.title ?? tab.label}>{tab.label}</span>
                {tab.status}
                <span className="ff-inspector-pane__spacer" />
                {panels.length > 1 && (
                  <button type="button" className="ff-inspector-pane__action" aria-pressed={isExpanded}
                    aria-label={isExpanded ? t("rightInspector.restore") : t("rightInspector.expand")}
                    title={isExpanded ? t("rightInspector.restore") : t("rightInspector.expand")}
                    onClick={() => setExpanded(isExpanded ? null : tab.id)}>
                    {isExpanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
                  </button>
                )}
                {closable && (
                  <button type="button" className="ff-inspector-pane__action ff-right-inspector__close" onClick={() => onCloseTab(tab.id)}
                    aria-label={`${t("common.close")} ${tab.label}`} title={t("rightInspector.closeTab", { name: tab.title ?? tab.label })}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </header>
              <div className="ff-inspector-pane__body" role="region" aria-label={tab.label}>{tab.content}</div>
            </section>
          );
        })}
      </div>
      {activeDrag?.drop && (
        <div className="ff-inspector-drop" data-zone={activeDrag.drop.zone} aria-hidden="true"
          style={{ left: activeDrag.drop.box.left, top: activeDrag.drop.box.top, width: activeDrag.drop.box.width, height: activeDrag.drop.box.height }} />
      )}
      {activeDrag && (
        <div className="ff-inspector-ghost" aria-hidden="true" style={{ left: activeDrag.x + 12, top: activeDrag.y + 8 }}>
          {byId.get(activeDrag.id)?.label}
        </div>
      )}
    </aside>
  );
}
