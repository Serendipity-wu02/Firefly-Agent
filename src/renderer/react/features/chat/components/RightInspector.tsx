// RightInspector — 右侧面板，参照 Claude 桌面版的结构：
// - 概览（overview）是紧挨对话框外侧的一条窄列，里面是可拖动排序的小卡片（卡片本身由 SessionOverviewPanel 渲染）；
// - 其余打开的项（浏览器、文件、文件预览、改动、任务……）是大面板，在概览列右侧铺成网格：每列上下两块，满了再开一列。
// 打开/关闭由主区标题行的图标开关负责，这里没有标签条。大面板标题行：图标、名称、状态 ··· 放大、关闭。
// 放大时其余大面板隐藏（保持挂载，浏览器等状态不丢）；关闭后的焦点回退仍由上层 ChatPage 决定。

import { useState, type ReactNode } from "react";
import { File, Files, FolderTree, GitCompareArrows, Globe, LayoutList, ListChecks, Maximize2, Minimize2, SquareTerminal, X } from "lucide-react";
import { useTranslation } from "../../../i18n";
import { tileColumns } from "./reorder-list";
import "./RightInspector.css";

export interface InspectorTab {
  id: string;
  label: string;
  /** Full path/context for tabs that share the same visible basename. */
  title?: string;
  kind?: "overview" | "files" | "file" | "diff" | "browser" | "tasks" | "plan" | "result";
  status?: ReactNode;
  /** 阶段色点 class（如 is-review / is-executing / is-completed），不传则不显示 */
  dotClass?: string;
  /** 是否允许关闭；不传默认可关 */
  closable?: boolean;
  content: ReactNode;
}

const tabIcons = { overview: LayoutList, files: FolderTree, file: File, diff: GitCompareArrows, browser: Globe, tasks: SquareTerminal, plan: ListChecks, result: Files };

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
  if (tabs.length === 0) return null;
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
  const overview = tabs.find(tab => tab.kind === "overview");
  const panels = tabs.filter(tab => tab !== overview);
  const expandedId = expanded !== null && panels.length > 1 && panels.some(tab => tab.id === expanded) ? expanded : null;
  const focus = (id: string) => { if (id !== active.id) onTabChange(id); };

  return (
    <aside className="ff-right-inspector" hidden={!visible} inert={!visible} aria-label={t("rightInspector.panelAria")}
      data-has-overview={overview ? true : undefined} data-has-panels={panels.length > 0 || undefined}>
      {overview && (
        <div className="ff-inspector-overview" data-inspector-pane={overview.id} data-inspector-kind="overview"
          data-active={overview.id === active.id || undefined} role="region" aria-label={overview.label}
          onFocusCapture={() => focus(overview.id)} onPointerDownCapture={() => focus(overview.id)}>
          {overview.content}
        </div>
      )}
      {panels.length > 0 && (
        <div className="ff-inspector-grid">
          {tileColumns(panels).map((column, columnIndex) => (
            <div key={columnIndex} className="ff-inspector-grid__column"
              data-expanded-here={column.some(tab => tab.id === expandedId) || undefined}
              hidden={expandedId !== null && !column.some(tab => tab.id === expandedId)}>
              {column.map(tab => {
                const Icon = tab.kind ? tabIcons[tab.kind] : undefined;
                const closable = tab.closable !== false;
                const isExpanded = expandedId === tab.id;
                return (
                  <section key={tab.id} className="ff-inspector-pane" data-inspector-pane={tab.id} data-inspector-kind={tab.kind}
                    data-active={tab.id === active.id || undefined}
                    hidden={expandedId !== null && !isExpanded}
                    aria-label={tab.title ?? tab.label}
                    onFocusCapture={() => focus(tab.id)} onPointerDownCapture={() => focus(tab.id)}>
                    <header className="ff-inspector-pane__head" tabIndex={0}
                      onKeyDown={event => {
                        // Delete on a focused header closes that panel, like its close button.
                        if (event.key === "Delete" && closable && event.target === event.currentTarget) { event.preventDefault(); onCloseTab(tab.id); }
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
          ))}
        </div>
      )}
    </aside>
  );
}
