import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n";
import { AskUserPanel, PermissionPanel, PopQuizPanel } from "./InteractionPanel";
import { resolveComposerSlot, type ComposerInteraction } from "./run-presentation";
import type { PopQuizGradedQuestion, PopQuizSubmission } from "../../../../../shared/pop-quiz";
import "./RunExperience.css";

export function ComposerSlot({
  composer,
  interaction,
  interactionBusy = false,
  interactionPending = 0,
  onAnswer,
  onIgnore,
  onPermissionDecision,
  onQuizSubmit,
  onQuizSkip,
}: {
  composer: ReactNode;
  interaction?: ComposerInteraction;
  interactionBusy?: boolean;
  /** 已到达、排在当前卡片之后的待处理数量。 */
  interactionPending?: number;
  onAnswer?: (interactionId: string, answer: unknown) => void;
  onIgnore?: (interactionId: string) => void;
  onPermissionDecision?: (interactionId: string, allowed: boolean) => void;
  onQuizSubmit?: (submission: PopQuizSubmission) => Promise<{ ok: boolean; error?: string; graded?: PopQuizGradedQuestion[] }>;
  onQuizSkip?: (quizId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t } = useTranslation();
  const slot = resolveComposerSlot(interaction);

  return (
    <div className={`ff-composer-slot is-${slot}`}>
      <div className="ff-composer-slot__composer" aria-hidden={interaction ? true : undefined}>
        {composer}
      </div>
      {interaction && interactionPending > 0 && (
        <span className="ff-composer-slot__pending" role="status">
          {t("interaction.pendingMore", { count: interactionPending })}
        </span>
      )}
      {interaction?.kind === "ask" && (
        <div className="ff-composer-slot__interaction">
          <AskUserPanel
            interaction={interaction}
            disabled={interactionBusy}
            onAnswer={(answer) => onAnswer?.(interaction.id, answer)}
            onIgnore={() => onIgnore?.(interaction.id)}
          />
        </div>
      )}
      {interaction?.kind === "permission" && (
        <div className="ff-composer-slot__interaction">
          <PermissionPanel
            interaction={interaction}
            disabled={interactionBusy}
            onDecision={(allowed) => onPermissionDecision?.(interaction.id, allowed)}
          />
        </div>
      )}
      {interaction?.kind === "quiz" && (
        <div className="ff-composer-slot__interaction">
          <PopQuizPanel
            interaction={interaction}
            disabled={interactionBusy}
            onSubmit={onQuizSubmit}
            onSkip={onQuizSkip}
          />
        </div>
      )}
    </div>
  );
}
