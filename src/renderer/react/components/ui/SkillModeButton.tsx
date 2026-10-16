import { Sparkles } from "lucide-react";
import { useTranslation } from "../../i18n";

interface SkillModeButtonProps {
  active?: boolean;
  onClick?: () => void;
}

export function SkillModeButton({ active = false, onClick }: SkillModeButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      className={`ff-side-action ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
      title={t("ui.skills")}
      aria-pressed={active}
    >
      <span className="ff-side-action-icon">
        <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="ff-side-action-label">{t("ui.skills")}</span>
    </button>
  );
}
