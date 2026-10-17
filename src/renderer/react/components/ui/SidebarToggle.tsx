import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "../../i18n";

interface SidebarToggleProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SidebarToggle({ collapsed: controlledCollapsed, onToggle }: SidebarToggleProps) {
  const { t } = useTranslation();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const handleClick = () => {
    setInternalCollapsed((v) => !v);
    onToggle?.();
  };

  return (
    <button
      className={`ff-sidebar-toggle ${collapsed ? "is-collapsed" : ""} ${hovered ? "is-hovered" : ""}`}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={t("ui.toggleSidebar")}
      title={`${t("ui.toggleSidebar")} Ctrl+Shift+S`}
      aria-keyshortcuts="Control+Shift+S"
      aria-expanded={!collapsed}
      aria-controls="firefly-context-sidebar"
      type="button"
    >
      {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.6} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.6} aria-hidden="true" />}
    </button>
  );
}
