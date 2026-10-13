import { useTranslation } from "../../i18n";

interface ToolModeButtonProps {
  active?: boolean;
  onClick?: () => void;
}

export function ToolModeButton({ active = false, onClick }: ToolModeButtonProps) {
  const { t } = useTranslation();
  return <button className={`ff-side-action ${active ? "is-active" : ""}`} onClick={onClick} type="button" title={t("ui.tools")} aria-pressed={active}>
    <span className="ff-side-action-icon">
      <span aria-hidden="true">⚙</span>
    </span>
    <span className="ff-side-action-label">{t("ui.tools")}</span>
  </button>;
}
