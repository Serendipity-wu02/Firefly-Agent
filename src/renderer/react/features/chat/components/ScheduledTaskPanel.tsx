import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "antd";
import { History, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "../../../i18n";
import { useFeedback } from "../../../components/feedback/FeedbackProvider";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import {
  describeSchedule,
  describeTaskTools,
  fireNowErrorMessage,
  formatScheduledTime,
  type ScheduledTask,
  type ScheduledTaskHistoryEntry,
  type SchedulerApi,
  type SchedulerToolInfo,
  type Translate,
} from "./scheduled-task-model";
import "./ScheduledTaskPanel.css";

interface PluginEntryLike {
  id: string;
  status?: string;
}

type PluginListing = PluginEntryLike[] | { plugins?: PluginEntryLike[] };

/** preload 暴露的全局对象（定时任务 IPC、运行事件、插件列表）。 */
type ChatWindowWithScheduler = Window & {
  fireflyScheduler?: SchedulerApi;
  schedulerEvents?: { onEvent: (callback: (event: unknown) => void) => () => void };
  plugins?: { list?: () => Promise<unknown>; onChanged?: (callback: (overview: unknown) => void) => () => void };
};

interface HistoryState {
  loading: boolean;
  rows: ScheduledTaskHistoryEntry[];
  error?: string;
}

function getSchedulerApi(): SchedulerApi | undefined {
  return (window as ChatWindowWithScheduler).fireflyScheduler;
}

async function readPluginRunning(): Promise<Record<string, boolean>> {
  const plugins = (window as ChatWindowWithScheduler).plugins;
  // 插件状态只影响"等待插件启用"提示与立即运行按钮；查询失败按未知处理，不阻塞任务列表
  const listed = plugins?.list
    ? (await plugins.list().catch(() => undefined)) as PluginListing | undefined
    : undefined;
  const entries = Array.isArray(listed) ? listed : listed?.plugins ?? [];
  return Object.fromEntries(entries.map((plugin) => [plugin.id, plugin.status === "running"]));
}

/** 运行边界事件：任务触发、运行结束或失败时任务的 lastFiredAt / nextFireAt 会变化。 */
function isRunBoundaryEvent(raw: unknown): boolean {
  const event = raw as { type?: string; name?: string } | null;
  if (!event) return false;
  return event.type === "RUN_FINISHED"
    || event.type === "RUN_ERROR"
    || (event.type === "CUSTOM" && event.name === "scheduler.started");
}

function pluginEnableMessage(task: ScheduledTask, t: Translate): string {
  const promptPreview = task.prompt.length > 120 ? `${task.prompt.slice(0, 120)}…` : task.prompt;
  return t("scheduledPanel.pluginEnableMessage", {
    plugin: task.ownerPluginId,
    schedule: describeSchedule(task.schedule, t),
    prompt: promptPreview,
    mode: task.mode ?? "work",
    tools: task.allowedToolIds.length ? task.allowedToolIds.join(", ") : t("scheduledPanel.noToolsModelOnly"),
  });
}

export function ScheduledTaskPanel() {
  const { t } = useTranslation();
  const feedback = useFeedback();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [tools, setTools] = useState<SchedulerToolInfo[]>([]);
  const [pluginRunning, setPluginRunning] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** null 表示列表视图；{} 为新建；{ task } 为编辑。 */
  const [editor, setEditor] = useState<{ task?: ScheduledTask } | null>(null);
  /** 存在键即表示该任务的历史已展开。 */
  const [histories, setHistories] = useState<Record<string, HistoryState>>({});
  const historiesRef = useRef(histories);
  historiesRef.current = histories;

  /** Re-reads one expanded history in place: the rows stay on screen while it loads, and a failure keeps them. */
  const refreshHistory = useCallback(async (taskId: string) => {
    try {
      const result = await getSchedulerApi()?.getHistory(taskId, 10);
      setHistories((current) => current[taskId] && result?.ok
        ? { ...current, [taskId]: { loading: false, rows: result.value ?? [] } }
        : current);
    } catch { /* an expanded list that cannot refresh keeps what it shows */ }
  }, []);

  const reload = useCallback(async () => {
    try {
      const scheduler = getSchedulerApi();
      if (!scheduler) throw new Error(t("scheduledPanel.apiUnavailable"));
      const [tasksResult, toolsResult, running] = await Promise.all([
        scheduler.list(),
        scheduler.getTools(),
        readPluginRunning(),
      ]);
      if (!tasksResult.ok) throw new Error(tasksResult.error ?? t("scheduledPanel.loadFailed"));
      setTasks(tasksResult.value ?? []);
      if (toolsResult.ok) setTools(toolsResult.value ?? []);
      setPluginRunning(running);
      setLoadError(null);
      // Histories that are open must follow the run boundary too, or they keep showing a finished run as running.
      void Promise.all(Object.keys(historiesRef.current).map(refreshHistory));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("scheduledPanel.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t, refreshHistory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 实时刷新：运行事件与窗口重新获得焦点时重新读取（设置窗口里的修改也会在这里生效）
  useEffect(() => {
    const refresh = () => void reload();
    const off = (window as ChatWindowWithScheduler).schedulerEvents?.onEvent((event) => {
      if (isRunBoundaryEvent(event)) refresh();
    });
    window.addEventListener("focus", refresh);
    // A plugin can start or stop while the panel keeps focus; only the cached run state needs re-reading.
    const offPlugins = (window as ChatWindowWithScheduler).plugins?.onChanged?.(() => {
      void readPluginRunning().then(setPluginRunning).catch(() => undefined);
    });
    return () => {
      off?.();
      offPlugins?.();
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  /** 统一的操作兜底：调用异常时以轻提示反馈，不让 Promise 悬挂。 */
  const attempt = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      feedback.notice({ tone: "error", message: err instanceof Error ? err.message : t("scheduledPanel.errors.actionFailed") });
    }
  }, [feedback, t]);

  const requireApi = (): SchedulerApi => {
    const scheduler = getSchedulerApi();
    if (!scheduler) throw new Error(t("scheduledPanel.apiUnavailable"));
    return scheduler;
  };

  const runNow = (task: ScheduledTask) => attempt(async () => {
    const result = await requireApi().fireNow(task.id);
    if (!result.ok) feedback.notice({ tone: "error", message: fireNowErrorMessage(result, t) });
  });

  const toggleTask = (task: ScheduledTask, enabled: boolean) => attempt(async () => {
    const scheduler = requireApi();
    // 启用插件任务前确认：启用即对该任务执行规格的一次明确授权
    if (enabled && task.ownerPluginId) {
      const confirmed = await feedback.confirm({
        tone: "warning",
        title: t("scheduledPanel.pluginEnableTitle"),
        message: pluginEnableMessage(task, t),
        confirmText: t("scheduledPanel.pluginEnableConfirm"),
      });
      if (!confirmed) return;
    }
    const result = await scheduler.toggle(task.id, enabled);
    if (!result.ok) feedback.notice({ tone: "error", message: result.error ?? t("scheduledPanel.errors.toggleFailed") });
    await reload();
  });

  const deleteTask = (task: ScheduledTask) => attempt(async () => {
    const scheduler = requireApi();
    // 删除不可撤销：危险确认，默认聚焦取消
    const confirmed = await feedback.confirm({
      title: t("scheduledPanel.deleteTitle"),
      message: t("scheduledPanel.deleteMessage"),
      confirmText: t("scheduledPanel.delete"),
      dangerous: true,
    });
    if (!confirmed) return;
    const result = await scheduler.delete(task.id);
    if (!result.ok) feedback.notice({ tone: "error", message: result.error ?? t("scheduledPanel.errors.deleteFailed") });
    setHistories((current) => withoutKey(current, task.id));
    await reload();
  });

  const toggleHistory = (task: ScheduledTask) => {
    if (histories[task.id]) {
      setHistories((current) => withoutKey(current, task.id));
      return;
    }
    setHistories((current) => ({ ...current, [task.id]: { loading: true, rows: [] } }));
    void (async () => {
      try {
        const result = await requireApi().getHistory(task.id, 10);
        setHistories((current) => current[task.id]
          ? {
            ...current,
            [task.id]: result.ok
              ? { loading: false, rows: result.value ?? [] }
              : { loading: false, rows: [], error: result.error ?? t("scheduledPanel.errors.historyFailed") },
          }
          : current);
      } catch (err) {
        setHistories((current) => current[task.id]
          ? { ...current, [task.id]: { loading: false, rows: [], error: err instanceof Error ? err.message : t("scheduledPanel.errors.historyFailed") } }
          : current);
      }
    })();
  };

  return (
    <div className="scheduled-panel">
      <header className="scheduled-panel__header">
        <h1 className="scheduled-panel__title">{t("scheduledPanel.title")}</h1>
        <p className="scheduled-panel__subtitle">{t("scheduledPanel.subtitle")}</p>
      </header>

      {editor ? (
        <ScheduledTaskEditor
          key={editor.task?.id ?? "new"}
          task={editor.task}
          api={getSchedulerApi()}
          tools={tools}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void reload();
          }}
        />
      ) : (
        <>
          <div className="scheduled-panel__toolbar">
            <p className="scheduled-panel__hint">{t("scheduledPanel.listHint")}</p>
            <button type="button" className="scheduled-btn is-primary" onClick={() => setEditor({})}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              <span>{t("scheduledPanel.newTask")}</span>
            </button>
          </div>

          {loadError && <div role="alert" className="scheduled-state is-error">{loadError}</div>}
          {loading ? (
            <div className="scheduled-state">{t("common.loading")}</div>
          ) : tasks.length === 0 && !loadError ? (
            <div className="scheduled-state">{t("scheduledPanel.empty")}</div>
          ) : (
            <div className="scheduled-list">
              {tasks.map((task) => (
                <ScheduledTaskCard
                  key={task.id}
                  task={task}
                  pluginRunning={task.ownerPluginId ? pluginRunning[task.ownerPluginId] === true : true}
                  history={histories[task.id]}
                  onRun={() => void runNow(task)}
                  onEdit={() => setEditor({ task })}
                  onToggle={(enabled) => void toggleTask(task, enabled)}
                  onHistory={() => toggleHistory(task)}
                  onDelete={() => void deleteTask(task)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

interface ScheduledTaskCardProps {
  task: ScheduledTask;
  /** 非插件任务恒为 true；插件任务按插件运行状态。 */
  pluginRunning: boolean;
  history?: HistoryState;
  onRun: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onHistory: () => void;
  onDelete: () => void;
}

function ScheduledTaskCard({ task, pluginRunning, history, onRun, onEdit, onToggle, onHistory, onDelete }: ScheduledTaskCardProps) {
  const { t } = useTranslation();
  const pluginOwned = Boolean(task.ownerPluginId);
  const pluginWaiting = pluginOwned && !pluginRunning;
  const metaItems = [
    pluginOwned ? t("scheduledPanel.createdByPlugin", { plugin: task.ownerPluginId }) : null,
    describeSchedule(task.schedule, t),
    t("scheduledPanel.nextRun", { time: formatScheduledTime(task.nextFireAt, t) }),
    task.lastFiredAt ? t("scheduledPanel.lastRun", { time: formatScheduledTime(task.lastFiredAt, t) }) : null,
    t("scheduledPanel.mode", { mode: task.mode ?? "work" }),
    t("scheduledPanel.tools", { tools: describeTaskTools(task, t) }),
    pluginWaiting ? t("scheduledPanel.waitingPlugin") : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <article className={`scheduled-card ${task.enabled ? "" : "is-disabled"}`}>
      <div className="scheduled-card__head">
        <h2 className="scheduled-card__name">{task.title}</h2>
        <span className={`scheduled-card__badge ${task.enabled ? "is-on" : ""}`}>
          {task.enabled ? t("scheduledPanel.badgeEnabled") : t("scheduledPanel.badgeDisabled")}
        </span>
        <Switch size="small" checked={task.enabled} onChange={(checked) => onToggle(checked)}
          aria-label={task.enabled ? t("scheduledPanel.disable") : t("scheduledPanel.enable")} />
      </div>
      <ul className="scheduled-card__meta">
        {metaItems.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
      <div className="scheduled-card__actions">
        <button type="button" className="scheduled-btn" onClick={onRun} disabled={!pluginRunning}
          title={pluginRunning ? undefined : t("scheduledPanel.errors.pluginNotRunning")}>
          <Play size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("scheduledPanel.runNow")}</span>
        </button>
        <button type="button" className="scheduled-btn" onClick={onEdit}>
          <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("scheduledPanel.edit")}</span>
        </button>
        <button type="button" className="scheduled-btn" onClick={onHistory} aria-expanded={Boolean(history)}>
          <History size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("scheduledPanel.history")}</span>
        </button>
        <button type="button" className="scheduled-btn is-danger" onClick={onDelete}>
          <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("scheduledPanel.delete")}</span>
        </button>
      </div>
      {history && <ScheduledHistory history={history} />}
    </article>
  );
}

function ScheduledHistory({ history }: { history: HistoryState }) {
  const { t } = useTranslation();
  if (history.loading) return <div className="scheduled-card__history">{t("common.loading")}</div>;
  if (history.error) return <div className="scheduled-card__history is-error" role="alert">{history.error}</div>;
  if (history.rows.length === 0) return <div className="scheduled-card__history">{t("scheduledPanel.historyEmpty")}</div>;
  return (
    <ul className="scheduled-card__history" aria-label={t("scheduledPanel.history")}>
      {history.rows.map((row) => {
        const duration = row.durationMs ? ` · ${Math.round(row.durationMs / 100) / 10}s` : "";
        const detail = row.outputPreview ?? row.errorMessage ?? row.reason ?? "";
        return (
          <li key={row.id} className="scheduled-card__history-row">
            <span>{formatScheduledTime(row.firedAt, t)}</span>
            <span className={`scheduled-card__history-status is-${row.status}`}>{t(`scheduledPanel.historyStatus.${row.status}`)}{duration}</span>
            {detail && <span className="scheduled-card__history-detail">{detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}
