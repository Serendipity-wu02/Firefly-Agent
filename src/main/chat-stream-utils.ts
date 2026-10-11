export interface ChatRequestMessage {
  role: "user" | "model" | "assistant" | "system";
  content: string;
  at?: number;
}

export interface ChatCompletionChoice {
  message?: {
    content?: string;
  };
}

export interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
}

export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

export function createVisibleStreamFilter(): {
  push: (chunk: string) => string;
  flush: () => string;
} {
  let pending = "";
  let insideThink = false;
  const openTag = "<think>";
  const closeTag = "</think>";

  return {
    push(chunk: string): string {
      pending += chunk;
      let visible = "";

      while (pending) {
        const lower = pending.toLowerCase();

        if (insideThink) {
          const closeIndex = lower.indexOf(closeTag);
          if (closeIndex < 0) {
            pending = pending.slice(Math.max(0, pending.length - (closeTag.length - 1)));
            break;
          }

          pending = pending.slice(closeIndex + closeTag.length);
          insideThink = false;
          continue;
        }

        const openIndex = lower.indexOf(openTag);
        if (openIndex < 0) {
          const safeLength = Math.max(0, pending.length - (openTag.length - 1));
          visible += pending.slice(0, safeLength);
          pending = pending.slice(safeLength);
          break;
        }

        visible += pending.slice(0, openIndex);
        pending = pending.slice(openIndex + openTag.length);
        insideThink = true;
      }

      return visible;
    },
    flush(): string {
      if (insideThink) {
        pending = "";
        return "";
      }

      const rest = pending;
      pending = "";
      return rest;
    },
  };
}
