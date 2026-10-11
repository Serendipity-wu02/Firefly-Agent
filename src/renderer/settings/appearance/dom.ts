// Appearance 面板 DOM 引用
// 从 settings.ts 抽离。ESM 静态导入保证查询在 settings.ts 顶层代码之前执行。

export const appearanceForm = document.getElementById("appearance-form") as HTMLFormElement;
export const appearanceSaveStatus = document.getElementById("appearance-save-status") as HTMLElement;
export const petAlwaysOnTopInput = document.getElementById("pet-always-on-top") as HTMLInputElement;
export const petVisibleInput = document.getElementById("pet-visible") as HTMLInputElement;
export const petZoomInput = document.getElementById("pet-zoom") as HTMLInputElement;
export const petZoomVal = document.getElementById("pet-zoom-val") as HTMLElement;
export const chatLineHeightInput = document.getElementById("chat-line-height") as HTMLInputElement;
export const chatLineHeightVal = document.getElementById("chat-line-height-val") as HTMLElement;
export const chatParaSpacingInput = document.getElementById("chat-para-spacing") as HTMLInputElement;
export const chatParaSpacingVal = document.getElementById("chat-para-spacing-val") as HTMLElement;
export const uiFontCurrent = document.getElementById("ui-font-current") as HTMLElement;
export const uiFontSelect = document.getElementById("ui-font-select") as HTMLSelectElement;
export const uiFontCustomOption = document.getElementById("ui-font-custom-option") as HTMLOptionElement;
export const uiFontImportButton = document.getElementById("ui-font-import") as HTMLButtonElement;
export const uiFontResetButton = document.getElementById("ui-font-reset") as HTMLButtonElement;
export const uiFontSizeInput = document.getElementById("ui-font-size-input") as HTMLInputElement;
export const chatFontSizeInput = document.getElementById("chat-font-size-input") as HTMLInputElement;
export const codeFontSizeInput = document.getElementById("code-font-size-input") as HTMLInputElement;
export const uiIconSelect = document.getElementById("ui-icon-select") as HTMLElement;
export const uiThemeSelect = document.getElementById("ui-theme-select") as HTMLElement;
export const screenshotHotkeyInput = document.getElementById("screenshot-hotkey-input") as HTMLInputElement | null;
