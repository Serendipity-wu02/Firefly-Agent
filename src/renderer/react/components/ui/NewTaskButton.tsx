import { SquarePen } from "lucide-react";
import { useTranslation } from "../../i18n";

interface NewTaskButtonProps {
  label?: string;
  onClick?: () => void;
}

export function NewTaskButton({ label, onClick }: NewTaskButtonProps) {
  const { t } = useTranslation();
  return (
    <button className="ff-side-action" onClick={onClick} type="button">
      <span className="ff-side-action-icon">
        <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="ff-side-action-label">{label ?? t("ui.newButton")}</span>
    </button>
  );
}
