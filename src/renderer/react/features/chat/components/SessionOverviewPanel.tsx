// 会话概览：对话面板外侧的一摞卡片，只展示真实数据，参照 Claude 桌面版：环境、连接器、后台任务、上下文、变更、产出。
// 环境、连接器是单行入口（点开对应面板或设置页）；其余可折叠。
// 上下文来自主进程的估算快照（不是账单）；变更与后台任务来自本会话各次 run 的工具/委托记录。
// 卡片没有数据时说明"暂无"，不放示例内容。
// 交互参照 open-claude-ui：卡片右上角六点抓取柄可上下拖动换顺序（4px 死区，落点显示强调色线，
// 被拖卡片微倾斜），键盘在抓取柄上按 ↑↓ 也能挪；顺序记在本机。展开收起用 Grid 0fr→1fr 的高度动画。

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronRight, GripVertical } from "lucide-react";
import { useTranslation } from "../../../i18n";
import type { ContextUsageSnapshot } from "../../../../../shared/context-usage";
import type { WorkspaceChangedFile, WorkspaceRunOutput } from "../workspace/workspace-artifacts";
import { contextUsageCategoryMeta, formatTokenCount } from "./ContextUsageRing";
import {
  buildContextOverview,
  summarizeChanges,
  summarizeTasks,
  type OverviewContext,
} from "./session-overview-model";
import { DRAG_DEAD_ZONE, moveId, reconcileOrder } from "./reorder-list";
import "./SessionOverviewPanel.css";

const OPEN_STORAGE_PREFIX = "ff.sessionOverview.open.";
const ORDER_STORAGE_KEY = "ff.sessionOverview.order";

function readOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ORDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeOrder(order: readonly string[]): void {
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // 存储不可用时顺序只在本次有效。
  }
}

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_STORAGE_PREFIX + id);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_PREFIX + id, open ? "1" : "0");
  } catch {
    // 存储不可用（隐私窗口、被禁用）时折叠状态只在本次有效。
  }
}

function fileBaseName(file: string): string {
  const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return slash < 0 ? file : file.slice(slash + 1);
}

interface CardDrag {
  /** The grip's own handlers; the card list owns the drag state. */
  onGripPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
  onGripPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void;
  onGripPointerUp(): void;
  onGripPointerCancel(): void;
  onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  dragging: boolean;
  dropBefore: boolean;
  /** How far the pointer has travelled since the press, so the lifted card follows it. */
  offsetY: number;
}

function OverviewCard({ id, title, summary, defaultOpen = true, drag, onActivate, children }: {
  id: string;
  title: string;
  /** A one-line entry card: the whole bar opens something instead of folding a body. */
  onActivate?: () => void;
  /** 折叠时也看得到的一行摘要。 */
  summary?: ReactNode;
  defaultOpen?: boolean;
  drag?: CardDrag;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const isEntry = children === undefined;
  const bodyId = useId();
  return (
    <section className="ff-overview-card" data-overview-card={id} data-open={isEntry ? undefined : open} data-entry={isEntry || undefined}
      data-dragging={drag?.dragging || undefined} data-drop-before={drag?.dropBefore || undefined}
      style={drag?.dragging ? { "--ff-drag-y": `${drag.offsetY}px` } as CSSProperties : undefined}>
      <div className="ff-overview-card__bar">
        <button
          type="button"
          className="ff-overview-card__head"
          aria-expanded={isEntry ? undefined : open}
          aria-controls={isEntry ? undefined : bodyId}
          disabled={isEntry && !onActivate}
          onClick={() => { if (isEntry) { onActivate?.(); return; } setOpen(!open); writeOpen(id, !open); }}
        >
          <ChevronRight className="ff-overview-card__chevron" size={14} aria-hidden="true" />
          <span className="ff-overview-card__title">{title}</span>
          {summary !== undefined && <span className="ff-overview-card__summary">{summary}</span>}
        </button>
        {drag && (
          <button type="button" className="ff-overview-card__grip" data-overview-grip=""
            aria-label={t("sessionOverview.reorder", { name: title })} title={t("sessionOverview.reorderHint")}
            onPointerDown={drag.onGripPointerDown} onPointerMove={drag.onGripPointerMove}
            onPointerUp={drag.onGripPointerUp} onPointerCancel={drag.onGripPointerCancel} onKeyDown={drag.onGripKeyDown}>
            <GripVertical size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Grid 0fr -> 1fr: the body grows and shrinks without measuring its height. */}
      {!isEntry && (
        <div id={bodyId} className="ff-overview-card__fold" aria-hidden={!open} inert={!open}>
          <div className="ff-overview-card__body">{children}</div>
        </div>
      )}
    </section>
  );
}

function ContextCardBody({ overview }: { overview: OverviewContext }) {
  const { t } = useTranslation();
  const meta = contextUsageCategoryMeta();
  const usedText = overview.usedPercent !== undefined
    ? t("sessionOverview.contextUsed", { percent: overview.usedPercent })
    : t("sessionOverview.contextUsedUnknown");
  const totals = overview.windowTokens > 0
    ? `${formatTokenCount(overview.totalTokens)} / ${formatTokenCount(overview.windowTokens)}`
    : formatTokenCount(overview.totalTokens);
  return (
    <>
      <div className="ff-overview-context__totals">
        <strong>{usedText}</strong>
        <span>{totals}</span>
      </div>
      <div className={`ff-overview-context__bar is-${overview.tone}`} aria-hidden="true">
        {overview.rows.map((row) => (
          <span key={row.key} style={{ width: `${row.windowRatio * 100}%`, background: meta[row.key].color }} />
        ))}
      </div>
      <ul className="ff-overview-context__rows">
        {overview.rows.map((row) => (
          <li key={row.key}>
            <span className="ff-overview-context__dot" style={{ background: meta[row.key].color }} aria-hidden="true" />
            <span className="ff-overview-context__name">{meta[row.key].label}</span>
            <span className="ff-overview-context__tokens">{formatTokenCount(row.tokens)}</span>
            <span className="ff-overview-context__share">{row.share !== undefined ? `${row.share}%` : ""}</span>
          </li>
        ))}
        {overview.freeTokens !== undefined && (
          <li className="is-free">
            <span className="ff-overview-context__dot" aria-hidden="true" />
            <span className="ff-overview-context__name">{t("sessionOverview.contextFree")}</span>
            <span className="ff-overview-context__tokens">{formatTokenCount(overview.freeTokens)}</span>
            <span className="ff-overview-context__share" />
          </li>
        )}
      </ul>
      <p className="ff-overview-card__note">{t("sessionOverview.contextEstimate")}</p>
    </>
  );
}

export interface OverviewEnvironment {
  mode: "chat" | "work" | "code";
  /** The bound project's display name, when the session has one. */
  workspaceName?: string;
  temporary?: boolean;
}

export interface SessionOverviewPanelProps {
  usage?: ContextUsageSnapshot;
  outputs: readonly WorkspaceRunOutput[];
  environment?: OverviewEnvironment;
  onOpenChange?: (output: WorkspaceRunOutput, file: WorkspaceChangedFile) => void;
  onOpenTask?: (output: WorkspaceRunOutput, taskId: string) => void;
  /** Opens the project (file panel) or lets the user pick one. */
  onOpenEnvironment?: () => void;
  /** Opens the connector (MCP) settings page. */
  onOpenConnectors?: () => void;
  onOpenOutput?: (output: WorkspaceRunOutput) => void;
}

/** Entry cards that sit on top, as in Claude desktop, even for an order saved before they existed. */
const LEADING_CARDS = ["environment", "connectors"];

function outputLabel(output: WorkspaceRunOutput, index: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const single = output.tasks.length === 1 ? output.tasks[0]!.description.trim() : "";
  return single || t("workspace.runResult", { index: index + 1 });
}

export function SessionOverviewPanel({ usage, outputs, environment, onOpenChange, onOpenTask, onOpenEnvironment, onOpenConnectors, onOpenOutput }: SessionOverviewPanelProps) {
  const { t } = useTranslation();
  const context = buildContextOverview(usage);
  const changes = summarizeChanges(outputs);
  const tasks = summarizeTasks(outputs);
  const hasTasks = tasks.running.length > 0 || tasks.finished > 0;
  const [order, setOrder] = useState<string[]>(readOrder);
  const [drag, setDrag] = useState<{ id: string; startY: number; offsetY: number; active: boolean; target: number | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Scroll fade: a 28px feathered edge only where cards are hidden past it.
  const updateFade = (element: HTMLElement) => {
    element.toggleAttribute("data-fade-top", element.scrollTop > 2);
    element.toggleAttribute("data-fade-bottom", element.scrollHeight - element.scrollTop - element.clientHeight > 2);
  };
  useEffect(() => {
    const element = listRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateFade(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const environmentSummary = !environment ? undefined
    : environment.temporary ? t("sessionOverview.environmentTemporary")
    : environment.workspaceName ?? t(environment.mode === "chat" ? "sessionOverview.environmentLocal" : "sessionOverview.environmentNoProject");
  const cards: Array<{ id: string; title: string; summary?: ReactNode; body?: ReactNode; onActivate?: () => void }> = [
    { id: "environment", title: t("sessionOverview.environment"), summary: environmentSummary, onActivate: onOpenEnvironment },
    { id: "connectors", title: t("sessionOverview.connectors"), summary: t("sessionOverview.connectorsManage"), onActivate: onOpenConnectors },
    {
      id: "tasks",
      title: t("sessionOverview.tasks"),
      summary: hasTasks ? t("sessionOverview.tasksRunning", { count: tasks.running.length }) : undefined,
      body: (
        <>
          {!hasTasks && <p className="ff-overview-card__empty">{t("sessionOverview.tasksEmpty")}</p>}
          {tasks.running.length > 0 && (
            <ul className="ff-overview-list">
              {tasks.running.map(({ task, output }) => (
                <li key={task.invocationId}>
                  <button type="button" className="ff-overview-list__row" disabled={!onOpenTask}
                    onClick={() => onOpenTask?.(output, task.taskId)} title={task.description}>
                    <span className="ff-overview-list__pulse" aria-hidden="true" />
                    <span className="ff-overview-list__name">{task.description || task.nickname}</span>
                    <span className="ff-overview-list__meta">{task.nickname}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tasks.finished > 0 && (
            <p className="ff-overview-card__line">
              {t("sessionOverview.tasksFinished", { count: tasks.finished })}
              {tasks.failed > 0 && <span className="ff-overview-card__warn"> · {t("sessionOverview.tasksFailed", { count: tasks.failed })}</span>}
            </p>
          )}
        </>
      ),
    },
    {
      id: "context",
      title: t("sessionOverview.context"),
      summary: context?.usedPercent !== undefined ? `${context.usedPercent}%` : undefined,
      body: context ? <ContextCardBody overview={context} /> : <p className="ff-overview-card__empty">{t("sessionOverview.contextEmpty")}</p>,
    },
    {
      id: "changes",
      title: t("sessionOverview.changes"),
      summary: changes.files.length > 0 ? (
        <>
          <span className="ff-overview-diffstat is-add">+{changes.insertions}</span>{" "}
          <span className="ff-overview-diffstat is-del">−{changes.deletions}</span>
        </>
      ) : undefined,
      body: changes.files.length === 0
        ? <p className="ff-overview-card__empty">{t("sessionOverview.changesEmpty")}</p>
        : (
          <ul className="ff-overview-list">
            {changes.files.map((item) => (
              <li key={item.file}>
                <button type="button" className="ff-overview-list__row" disabled={!onOpenChange}
                  onClick={() => onOpenChange?.(item.output, item.changed)} title={item.file}>
                  <span className="ff-overview-list__name">{fileBaseName(item.file)}</span>
                  <span className="ff-overview-list__meta">
                    <span className="ff-overview-diffstat is-add">+{item.insertions}</span>{" "}
                    <span className="ff-overview-diffstat is-del">−{item.deletions}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "outputs",
      title: t("sessionOverview.outputs"),
      summary: outputs.length > 0 ? String(outputs.length) : undefined,
      body: outputs.length === 0
        ? <p className="ff-overview-card__empty">{t("sessionOverview.outputsEmpty")}</p>
        : (
          <ul className="ff-overview-list">
            {[...outputs].reverse().map((output) => {
              const index = outputs.indexOf(output);
              return (
                <li key={output.id}>
                  <button type="button" className="ff-overview-list__row" disabled={!onOpenOutput} onClick={() => onOpenOutput?.(output)}>
                    <span className="ff-overview-list__name">{outputLabel(output, index, t)}</span>
                    <span className="ff-overview-list__meta">{t("sessionOverview.outputCounts", { files: output.files.length, tools: output.tools.length })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ),
    },
  ];
  const reconciled = reconcileOrder(order, cards.map(card => card.id));
  const leading = LEADING_CARDS.filter(id => !order.includes(id));
  const ordered = [...leading, ...reconciled.filter(id => !leading.includes(id))].map(id => cards.find(card => card.id === id)!);
  const others = drag?.active ? ordered.filter(card => card.id !== drag.id) : [];
  const dropBeforeId = drag?.active && drag.target !== null ? others[drag.target]?.id ?? null : null;
  const dropAtEnd = Boolean(drag?.active && drag.target !== null && drag.target >= others.length);

  const commit = (next: string[]) => { setOrder(next); writeOrder(next); };
  /** Where the dragged card would land, from the pointer against each other card's midpoint. */
  const dropIndex = (clientY: number, draggedId: string) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-overview-card]") ?? [])
      .filter(node => node.dataset.overviewCard !== draggedId);
    const index = nodes.findIndex(node => { const rect = node.getBoundingClientRect(); return clientY < rect.top + rect.height / 2; });
    return index < 0 ? nodes.length : index;
  };
  const dragFor = (id: string): CardDrag => ({
    dragging: Boolean(drag?.active && drag.id === id),
    dropBefore: dropBeforeId === id,
    offsetY: drag?.id === id ? drag.offsetY : 0,
    onGripPointerDown: (event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ id, startY: event.clientY, offsetY: 0, active: false, target: null });
    },
    onGripPointerMove: (event) => {
      if (!drag || drag.id !== id) return;
      if (!drag.active && Math.abs(event.clientY - drag.startY) <= DRAG_DEAD_ZONE) return;
      setDrag({ ...drag, active: true, offsetY: event.clientY - drag.startY, target: dropIndex(event.clientY, id) });
    },
    onGripPointerUp: () => {
      if (drag?.active && drag.target !== null) commit(moveId(ordered.map(card => card.id), drag.id, drag.target));
      setDrag(null);
    },
    onGripPointerCancel: () => setDrag(null),
    onGripKeyDown: (event) => {
      // Escape puts a lifted card back where it was, like the reference's drag state machine.
      if (event.key === "Escape" && drag?.active) { event.preventDefault(); setDrag(null); return; }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const ids = ordered.map(card => card.id);
      commit(moveId(ids, id, ids.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)));
    },
  });

  return (
    <div ref={listRef} className="ff-session-overview" aria-label={t("sessionOverview.title")}
      data-dragging={drag?.active || undefined} onScroll={event => updateFade(event.currentTarget)}>
      {ordered.map(card => (
        <OverviewCard key={card.id} id={card.id} title={card.title} summary={card.summary} drag={dragFor(card.id)} onActivate={card.onActivate}>
          {card.body}
        </OverviewCard>
      ))}
      {dropAtEnd && <div className="ff-overview-drop-end" aria-hidden="true" />}
    </div>
  );
}
