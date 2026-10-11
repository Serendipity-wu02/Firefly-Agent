// General 面板 DOM 引用
// 从 settings.ts 抽离。ESM 静态导入保证查询在 settings.ts 顶层代码之前执行。

export const generalForm = document.getElementById("general-form") as HTMLElement;
export const languageSelect = document.getElementById("language-select") as HTMLElement;
export const segmentedOutputSelect = document.getElementById("segmented-output-select") as HTMLElement;
export const proactiveChatSelect = document.getElementById("proactive-chat-select") as HTMLElement;
export const proactiveDeliveryRow = document.getElementById("proactive-delivery-row") as HTMLElement;
export const proactiveDeliverySelect = document.getElementById("proactive-delivery-select") as HTMLElement;
export const chatSocialContextEnabledInput = document.getElementById("chat-social-context-enabled") as HTMLInputElement;
export const toastSoundEnabledInput = document.getElementById("toast-sound-enabled") as HTMLInputElement;
export const launchAtLoginInput = document.getElementById("launch-at-login") as HTMLInputElement;
export const desktopSaveStatus = document.getElementById("desktop-save-status") as HTMLElement;
