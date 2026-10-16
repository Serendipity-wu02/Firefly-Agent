import { useRef, useState } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { Check, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "../../../i18n";
import type { ConversationMode } from "../../../../../shared/chat-types";
import type { SidebarPatch, SidebarSnapshot } from "../../../../../shared/sidebar-layout";
import type { SidebarProjectionGroup } from "../pages/sidebar-projection";
import "./SidebarLayoutControls.css";

const CHECK_SLOT = 14;
const checked = (on: boolean) => on ? <Check size={CHECK_SLOT} strokeWidth={2} aria-hidden="true" /> : <span style={{ width: CHECK_SLOT }} aria-hidden="true" />;

/** The arrangement menu: group by, sort by, which projects to show, new section, reset. Sections and group order are managed in the panel below the heading. */
export function SidebarLayoutControls({ mode, snapshot, groups, projectIds, pending, mutate, title }: {
  mode: ConversationMode; snapshot: SidebarSnapshot; groups: SidebarProjectionGroup[]; title: string;
  projectIds: readonly string[]; pending: boolean; mutate(patch: SidebarPatch): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const state = snapshot.layout.modes[mode];
  const projects = snapshot.layout.projects.filter(project => projectIds.includes(project.id));
  const hiddenProjects = projects.filter(project => state.hiddenProjectIds.includes(project.id));
  const defaultView = mode === "chat" ? "merged" : "project";
  const atDefaults = state.viewMode === defaultView && state.sortMode === "recent" && hiddenProjects.length === 0;
  const label = (group: SidebarProjectionGroup) => group.projectId || group.sectionId ? group.label
    : t(mode === "chat" || state.viewMode === "merged" ? "sidebar.recentTitle" : "sidebar.unboundProject");
  const moveGroup = (index: number, direction: number) => {
    const ids = groups.map(group => group.groupId);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    const visible = new Set(ids);
    const ordered = [...state.groupOrder, ...ids.filter(id => !state.groupOrder.includes(id))];
    let next = 0;
    const groupIds = ordered.map(id => visible.has(id) ? ids[next++] : id);
    void mutate({ mode, kind: "set-group-order", groupIds });
  };
  /** Applies patches one after another and stops at the first one that did not go through. */
  const applyInOrder = async (patches: SidebarPatch[]) => {
    for (const patch of patches) if (!(await mutate(patch))) return;
  };
  const unhide = hiddenProjects.map(project => ({ mode, kind: "set-project-visible", projectId: project.id, visible: true } as const));
  const resetDefaults = () => applyInOrder([
    ...(state.viewMode === defaultView ? [] : [{ mode, kind: "set-view", viewMode: defaultView } as const]),
    ...(state.sortMode === "recent" ? [] : [{ mode, kind: "set-sort", sortMode: "recent" } as const]),
    ...unhide,
  ]);
  const openManager = () => { setManageOpen(true); window.setTimeout(() => nameInput.current?.focus(), 0); };

  const viewLabel = t(state.viewMode === "project" ? "sidebar.viewProjectsShort" : "sidebar.viewMergedShort");
  const sortLabel = t(state.sortMode === "recent" ? "sidebar.recentSort" : "sidebar.manualSort");
  const items: MenuProps["items"] = [
    ...(mode === "chat" ? [] : [{
      key: "group-by", label: t("sidebar.groupBy"), extra: viewLabel, disabled: pending,
      children: (["project", "merged"] as const).map(view => ({
        key: `view:${view}`, icon: checked(state.viewMode === view), disabled: pending,
        label: t(view === "project" ? "sidebar.viewProjectsShort" : "sidebar.viewMergedShort"),
        onClick: () => { if (state.viewMode !== view) void mutate({ mode, kind: "set-view", viewMode: view }); },
      })),
    }]),
    {
      key: "sort-by", label: t("sidebar.sortBy"), extra: sortLabel, disabled: pending,
      children: (["recent", "manual"] as const).map(sort => ({
        key: `sort:${sort}`, icon: checked(state.sortMode === sort), disabled: pending,
        label: t(sort === "recent" ? "sidebar.recentSort" : "sidebar.manualSort"),
        onClick: () => { if (state.sortMode !== sort) void mutate({ mode, kind: "set-sort", sortMode: sort }); },
      })),
    },
    ...(mode === "chat" ? [] : [{
      key: "show", label: t("sidebar.show"), disabled: pending || projects.length === 0,
      children: projects.map(project => {
        const visible = !state.hiddenProjectIds.includes(project.id);
        return {
          key: `project:${project.id}`, icon: checked(visible), label: project.displayName, title: project.workspaceRoot, disabled: pending,
          onClick: () => { void mutate({ mode, kind: "set-project-visible", projectId: project.id, visible: !visible }); },
        };
      }),
    }]),
    { type: "divider" as const },
    { key: "new-section", label: t("sidebar.newSection"), disabled: pending, onClick: openManager },
    { key: "manage", label: t("sidebar.manageSections"), disabled: pending, onClick: () => setManageOpen(open => !open) },
    { type: "divider" as const },
    { key: "reset", label: t("sidebar.resetDefaults"), disabled: pending || atDefaults, onClick: () => { void resetDefaults(); } },
    ...(mode === "chat" ? [] : [{ key: "view-all", label: t("sidebar.viewAll"), disabled: pending || hiddenProjects.length === 0, onClick: () => { void applyInOrder(unhide); } }]),
  ];

  return <div className="ff-sidebar-layout">
    <div className="ff-sidebar-layout__head">
      <span className="ff-conversation-sidebar__title">{title}</span>
      <Dropdown menu={{ items, selectable: false, triggerSubMenuAction: "click" }} trigger={["click"]} placement="bottomRight" classNames={{ root: "ff-sidebar-menu" }}>
        <button type="button" className="ff-sidebar-layout__toggle" aria-label={t("sidebar.manageLayout")} title={t("sidebar.manageLayout")}
          aria-haspopup="menu">
          <SlidersHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Dropdown>
    </div>
    <div className="ff-sidebar-layout__panel" hidden={!manageOpen}>
      <div className="ff-sidebar-layout__management">
        <form className="ff-sidebar-layout__section" onSubmit={event => {
          event.preventDefault(); if (!name.trim() || pending) return;
          void mutate({ mode, kind: "create-section", name: name.trim() }).then(ok => { if (ok) setName(""); });
        }}>
          <input ref={nameInput} aria-label={t("sidebar.sectionName")} placeholder={t("sidebar.sectionName")} maxLength={120} value={name} onChange={event => setName(event.target.value)} />
          <button type="submit" disabled={pending || !name.trim()}>{t("sidebar.addSection")}</button>
        </form>
        {state.sections.map(section => <div className="ff-sidebar-layout__section" key={section.id}>
          <input aria-label={t("sidebar.sectionName")} maxLength={120} value={renames[section.id] ?? section.name}
            onChange={event => setRenames(current => ({ ...current, [section.id]: event.target.value }))} />
          <button type="button" disabled={pending || !(renames[section.id] ?? section.name).trim()}
            onClick={() => void mutate({ mode, kind: "rename-section", sectionId: section.id, name: (renames[section.id] ?? section.name).trim() })}>{t("sidebar.rename")}</button>
          <button type="button" disabled={pending} aria-label={t("sidebar.removeSection")}
            onClick={() => void mutate({ mode, kind: "delete-section", sectionId: section.id })}>×</button>
        </div>)}
        {groups.map((group, index) => <div className="ff-sidebar-layout__order" key={group.groupId}>
          <span>{label(group)}</span>
          <button type="button" aria-label={t("sidebar.moveUp")} disabled={pending || index === 0} onClick={() => moveGroup(index, -1)}>↑</button>
          <button type="button" aria-label={t("sidebar.moveDown")} disabled={pending || index === groups.length - 1} onClick={() => moveGroup(index, 1)}>↓</button>
        </div>)}
      </div>
    </div>
  </div>;
}
