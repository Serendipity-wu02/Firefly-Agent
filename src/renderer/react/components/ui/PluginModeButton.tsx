import { Puzzle } from "lucide-react";
import { useTranslation } from "../../i18n";

interface PluginModeButtonProps {
  active?: boolean;
  onClick?: () => void;
}

export function PluginModeButton({ active = false, onClick }: PluginModeButtonProps) {
  const { t } = useTranslation();
  return <button className={`ff-side-action ${active ? "is-active" : ""}`} onClick={onClick} type="button" title={t("ui.plugins")} aria-label={t("ui.plugins")} aria-pressed={active}>
    <span className="ff-side-action-icon">
      <Puzzle size={16} strokeWidth={1.8} aria-hidden="true" />
    </span>
    <span className="ff-side-action-label">{t("ui.plugins")}</span>
  </button>;
}
