// 新会话页中央的"选项目"卡片：列出最近用过的项目，点一下就把新任务放进那个项目；
// 底部"选择其他文件夹"打开系统选择框。当前已选的项目带勾。
import { Check, ChevronDown, Laptop } from "lucide-react";
import type { ChatSessionMeta } from "../../../../../shared/chat-types";
import { useTranslation } from "../../../i18n";
import "./ProjectChooserCard.css";

export interface RecentProject { path: string; displayName: string; updatedAt: number }

/** Distinct workspaces of these sessions, most recently used first. */
export function recentProjects(sessions: readonly ChatSessionMeta[], limit = 5): RecentProject[] {
  const byPath = new Map<string, RecentProject>();
  for (const session of sessions) {
    const path = session.workspaceRoot?.trim();
    if (!path) continue;
    const known = byPath.get(path);
    if (!known || session.updatedAt > known.updatedAt) {
      byPath.set(path, { path, displayName: session.workspaceDisplayName?.trim() || path.split(/[\\/]/).filter(Boolean).pop() || path, updatedAt: session.updatedAt });
    }
  }
  return [...byPath.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
}

export function ProjectChooserCard({ projects, selectedPath, onPick, onBrowse }: {
  projects: readonly RecentProject[];
  selectedPath?: string;
  onPick(project: RecentProject): void;
  onBrowse(): void;
}) {
  const { t } = useTranslation();
  return (
    <section className="ff-project-chooser" aria-label={t("chatPage.projectChooser.label")}>
      {projects.length > 0 && (
        <ul className="ff-project-chooser__list">
          {projects.map(project => {
            const selected = project.path === selectedPath;
            return (
              <li key={project.path}>
                <button type="button" className="ff-project-chooser__item" aria-pressed={selected} title={project.path} onClick={() => onPick(project)}>
                  <Laptop size={16} strokeWidth={1.6} aria-hidden="true" />
                  <span className="ff-project-chooser__name">{project.displayName}</span>
                  {selected && <Check className="ff-project-chooser__check" size={15} strokeWidth={2} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="ff-project-chooser__browse" onClick={onBrowse}>
        <span>{t(projects.length > 0 ? "chatPage.projectChooser.browse" : "chatPage.projectChooser.browseFirst")}</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </section>
  );
}
