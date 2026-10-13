import { useEffect } from "react";
import {
  normalizeChatAppearance,
  type ChatAppearanceSettings,
} from "../../../shared/chat-appearance";

export function applyChatAppearance(input: unknown): void {
  const settings = normalizeChatAppearance(input);
  const style = document.documentElement.style;
  style.setProperty("--ff-chat-line-height", String(settings.chatLineHeight));
  style.setProperty("--ff-chat-para-spacing", `${settings.chatParaSpacing}em`);
  style.setProperty("--ff-ui-font-size", `${settings.uiFontSize}px`);
  style.setProperty("--ff-chat-font-size", `${settings.chatFontSize}px`);
  style.setProperty("--ff-code-font-size", `${settings.codeFontSize}px`);
}

export function useChatAppearance(): void {
  useEffect(() => {
    const api = window.fireflyAppearance;
    if (!api) return;

    let disposed = false;
    let receivedRealtimeChange = false;

    // 先监听，避免漏掉初始化期间发生的修改
    const unsubscribe = api.onChanged(
      (settings: ChatAppearanceSettings) => {
        if (disposed) return;

        receivedRealtimeChange = true;
        applyChatAppearance(settings);
      },
    );

    void api
      .get()
      .then((settings) => {
        // 若 get 期间已经收到更新，不让旧快照覆盖新值
        if (!disposed && !receivedRealtimeChange) {
          applyChatAppearance(settings);
        }
      })
      .catch((error: unknown) => {
        console.warn(
          "[ChatAppearance] Failed to load settings:",
          error,
        );
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
