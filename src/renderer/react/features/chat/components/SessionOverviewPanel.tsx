// 会话概览：右栏里的一摞可折叠卡片，只展示真实数据。
// 上下文来自主进程的估算快照（不是账单）；变更与后台任务来自本会话各次 run 的工具/委托记录。
// 卡片没有数据时说明"暂无"，不放示例内容。

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
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
import "./SessionOverviewPanel.css";

const OPEN_STORAGE_PREFIX = "ff.sessionOverview.open.";

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

function OverviewCard({ id, title, summary, defaultOpen = true, children }: {
  id: string;
  title: string;
  /** 折叠时也看得到的一行摘要。 */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const bodyId = useId();
  return (
    <section className="ff-overview-card" data-overview-card={id}>
      <button
        type="button"
        className="ff-overview-card__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { setOpen(!open); writeOpen(id, !open); }}
      >
        <ChevronRight className="ff-overview-card__chevron" size={14} aria-hidden="true" />
        <span className="ff-overview-card__title">{title}</span>
        {summary !== undefined && <span className="ff-overview-card__summary">{summary}</span>}
      </button>
      <div id={bodyId} className="ff-overview-card__body" hidden={!open}>{children}</div>
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

export interface SessionOverviewPanelProps {
  usage?: ContextUsageSnapshot;
  outputs: readonly WorkspaceRunOutput[];
  onOpenChange?: (output: WorkspaceRunOutput, file: WorkspaceChangedFile) => void;
  onOpenTask?: (output: WorkspaceRunOutput, taskId: string) => void;
}

export function SessionOverviewPanel({ usage, outputs, onOpenChange, onOpenTask }: SessionOverviewPanelProps) {
  const { t } = useTranslation();
  const context = buildContextOverview(usage);
  const changes = summarizeChanges(outputs);
  const tasks = summarizeTasks(outputs);
  const hasTasks = tasks.running.length > 0 || tasks.finished > 0;

  return (
    <div className="ff-session-overview" aria-label={t("sessionOverview.title")}>
      <OverviewCard
        id="tasks"
        title={t("sessionOverview.tasks")}
        summary={hasTasks ? t("sessionOverview.tasksRunning", { count: tasks.running.length }) : undefined}
      >
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
      </OverviewCard>

      <OverviewCard
        id="context"
        title={t("sessionOverview.context")}
        summary={context?.usedPercent !== undefined ? `${context.usedPercent}%` : undefined}
      >
        {context
          ? <ContextCardBody overview={context} />
          : <p className="ff-overview-card__empty">{t("sessionOverview.contextEmpty")}</p>}
      </OverviewCard>

      <OverviewCard
        id="changes"
        title={t("sessionOverview.changes")}
        summary={changes.files.length > 0 ? (
          <>
            <span className="ff-overview-diffstat is-add">+{changes.insertions}</span>{" "}
            <span className="ff-overview-diffstat is-del">−{changes.deletions}</span>
          </>
        ) : undefined}
      >
        {changes.files.length === 0
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
          )}
      </OverviewCard>
    </div>
  );
}
