// RightInspector — 统一的右侧挤出式面板容器。
// 顶部是滑动胶囊标签条（SlidingTabs）：每个标签可单独关闭，右上角关闭按钮关闭当前活动标签，
// 活动标签关闭后的回退由上层 ChatPage 决定。所有标签的内容始终挂载，只用 hidden 切换，
// 因此编辑中的文本、浏览器页等状态在切换标签时不会丢。

import type { ReactNode } from "react";
import { File, Files, FolderTree, GitCompareArrows, Globe, LayoutList, ListChecks, SquareTerminal } from "lucide-react";
import { useTranslation } from "../../../i18n";
import { SlidingTabs } from "../../../components/ui/SlidingTabs";
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
  /** 是否允许关闭（chip 上的 × 和右上角按钮都受它控制）；不传默认可关 */
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
  /** 当前活动标签 ID，不在列表中时回退到第一个标签 */
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  /** 关闭指定标签（chip 上的 × 和右上角按钮共用） */
  onCloseTab: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (tabs.length === 0) return null;
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  return (
    <aside className="ff-right-inspector" hidden={!visible} inert={!visible} aria-label={t("rightInspector.panelAria")}>
      <div className="ff-right-inspector__bar">
        <SlidingTabs
          className="ff-right-inspector__tabs"
          size="md"
          activeId={active.id}
          onChange={onTabChange}
          onClose={onCloseTab}
          tabs={tabs.map((tab) => {
            const Icon = tab.kind ? tabIcons[tab.kind] : undefined;
            return {
              id: tab.id,
              title: tab.title ?? tab.label,
              closable: tab.closable !== false,
              closeLabel: t("rightInspector.closeTab", { name: tab.title ?? tab.label }),
              icon: Icon ? <Icon size={14} aria-hidden="true" /> : undefined,
              tabData: tab.kind ? { "data-inspector-kind": tab.kind } : undefined,
              label: (
                <>
                  {tab.dotClass && <span className={`ff-right-inspector__dot ${tab.dotClass}`} aria-hidden="true" />}
                  <span className="ff-right-inspector__label-text">{tab.label}</span>
                  {tab.status}
                </>
              ),
            };
          })}
        />
        {active.closable !== false && (
          <button
            type="button"
            className="ff-right-inspector__close"
            onClick={() => onCloseTab(active.id)}
            aria-label={`${t("common.close")} ${active.label}`}
            title={t("rightInspector.closeTab", { name: active.title ?? active.label })}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
            </svg>
          </button>
        )}
      </div>
      <div className="ff-right-inspector__panes">
        {tabs.map((tab) => (
          <div key={tab.id} role="tabpanel" className="ff-right-inspector__pane" hidden={tab.id !== active.id}>{tab.content}</div>
        ))}
      </div>
    </aside>
  );
}
