import "../ui/base.css";
import "./sidebar.css";
import "../ui/theme";

interface ModelConfig {
  mode: "auto" | "manual";
  provider: string;
  displayName?: string;
  shortName: string;
  model: string;
  connected: boolean;
}

interface SidebarApi {
  minimize: () => void;
  close: () => void;
  toggleAlwaysOnTop: () => Promise<boolean>;
  openSettings: (section?: string) => void;
}

declare global {
  interface Window {
    sidebar?: SidebarApi;
  }
}

// 没有 preload 时给浏览器跑留个 no-op，方便 vite 单独打开 sidebar 调试
if (!window.sidebar) {
  (window as unknown as { sidebar: SidebarApi }).sidebar = {
    minimize: () => {},
    close: () => {},
    toggleAlwaysOnTop: () => Promise.resolve(false),
    openSettings: (_section?: string) => {},
  };
}

const root = document.querySelector(".sidebar") as HTMLElement | null;
const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const pinBtn = document.getElementById("pin-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const modelSwitchBtn = document.getElementById("model-switch-btn") as HTMLButtonElement;
const openChatBtn = document.getElementById("open-chat-btn") as HTMLButtonElement;
const onlineStatusLabel = document.getElementById("online-status-label") as HTMLElement;

const onlineBadge = onlineStatusLabel.closest(".profile__online") as HTMLElement | null;
function applyModelConfig(config: ModelConfig | null): void {
  const connected = Boolean(config?.connected);
  onlineStatusLabel.textContent = connected ? "在线" : "离线";
  onlineBadge?.classList.toggle("is-offline", !connected);
}

async function initModelConfig(): Promise<void> {
  try {
    const config = await window.modelConfig?.get();
    applyModelConfig(config ?? null);
  } catch {
    applyModelConfig(null);
  }
  window.modelConfig?.onChanged((config) => applyModelConfig(config));
}
// 置顶 toggle：点 📌 切换 alwaysOnTop，按钮高亮态反映当前是否已置顶。
pinBtn.addEventListener("click", async () => {
  const pinned = await window.sidebar?.toggleAlwaysOnTop();
  const isPinned = Boolean(pinned);
  pinBtn.classList.toggle("is-active", isPinned);
  pinBtn.setAttribute("aria-label", isPinned ? "取消置顶" : "置顶");
  pinBtn.setAttribute("title", isPinned ? "取消置顶" : "置顶");
});

minBtn.addEventListener("click", () => {
  window.sidebar?.minimize();
});

closeBtn.addEventListener("click", () => {
  window.sidebar?.close();
});

settingsBtn.addEventListener("click", () => {
  window.sidebar?.openSettings();
});

modelSwitchBtn.addEventListener("click", () => {
  // "切换模型"直奔 API 配置标签，而不是默认的通用标签
  window.sidebar?.openSettings("api");
});

// "打开聊天"：拿到最近一条会话 id，让 main 打开聊天窗口并加载它；
// 没有任何会话时先建一个再打开，保证点按钮总能进到一个具体会话。
openChatBtn.addEventListener("click", async () => {
  const chatStore = (window as unknown as {
    chatStore?: {
      list: () => Promise<Array<{ id: string }>>;
      create: (payload?: { identityId?: string | null }) => Promise<{ id: string } | null>;
      openInReactChatWindow: (sessionId: string) => Promise<unknown>;
    };
  }).chatStore;
  if (!chatStore) return;
  try {
    const list = await chatStore.list();
    let latestId = list.length > 0 ? list[0].id : "";
    if (!latestId) {
      const created = await chatStore.create({ identityId: null });
      latestId = created?.id ?? "";
    }
    if (latestId) await chatStore.openInReactChatWindow(latestId);
  } catch (err) {
    console.warn("[sidebar] 打开聊天失败:", err);
  }
});

void initModelConfig();
