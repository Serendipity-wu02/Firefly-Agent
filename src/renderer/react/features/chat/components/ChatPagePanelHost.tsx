import type { ChatPagePanel } from "./ChatPageNavigation";
import { ModelModePanel } from "./ModelModePanel";
import { PluginModePanel } from "./PluginModePanel";
import { ScheduledTaskPanel } from "./ScheduledTaskPanel";
import { SkillModePanel } from "./SkillModePanel";
import { ToolModePanel } from "./ToolModePanel";

export function ChatPagePanelHost({ panel }: { panel: ChatPagePanel }) {
  switch (panel) {
    case "model": return <ModelModePanel />;
    case "plugin": return <PluginModePanel />;
    case "scheduled": return <ScheduledTaskPanel />;
    case "skill": return <SkillModePanel />;
    case "tool": return <ToolModePanel />;
  }
}
