// ComposerSuggestions — the "/" and "@" pickers of the composer, after the open-claude-ui RichComposerWithMentions.
// "/" lists the enabled skills and plugins, "@" browses the session's workspace files (one directory at a time).
// The text box keeps focus: arrow keys move the highlight, Enter / Tab apply it, Escape closes the list, and keys
// typed while an input method is composing never reach the picker.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useTranslation } from "../../../i18n";
import "./ComposerSuggestions.css";

export type SuggestionMode = "slash" | "mention";

export interface SuggestionItem {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  /** Text that replaces the trigger and query. */
  insert: string;
  /** A folder keeps the picker open one level down instead of finishing the mention. */
  keepOpen?: boolean;
}

export interface Trigger {
  mode: SuggestionMode;
  query: string;
  /** Index of the "/" or "@" in the text. */
  start: number;
}

/** Finds a "/" or "@" token that ends at the caret and starts the text or follows whitespace. */
export function detectTrigger(textBeforeCaret: string): Trigger | null {
  const slash = /(?:^|\s)\/([^\s/]*)$/.exec(textBeforeCaret);
  if (slash) return { mode: "slash", query: slash[1], start: textBeforeCaret.length - slash[1].length - 1 };
  const mention = /(?:^|\s)@([^\s]*)$/.exec(textBeforeCaret);
  if (mention) return { mode: "mention", query: mention[1], start: textBeforeCaret.length - mention[1].length - 1 };
  return null;
}

/** Replaces the trigger token with the chosen item; a finished item is followed by one space. */
export function applySuggestion(text: string, caret: number, trigger: Trigger, item: SuggestionItem): { text: string; caret: number } {
  const insert = item.keepOpen ? item.insert : `${item.insert} `;
  const next = text.slice(0, trigger.start) + insert + text.slice(caret);
  return { text: next, caret: trigger.start + insert.length };
}

interface SkillEntry { id: string; name: string; description?: string; enabled?: boolean }
interface PluginEntry { id: string; name: string; description?: string; enabled?: boolean }
interface FileEntry { name: string; relPath: string; isDir: boolean }

async function loadSlashItems(skillLabel: string, pluginLabel: string): Promise<SuggestionItem[]> {
  const [skills, plugins] = await Promise.all([
    Promise.resolve(window.settings?.getSkillCatalog?.()).catch(() => []),
    Promise.resolve(window.plugins?.list?.()).catch(() => []),
  ]);
  const skillItems = ((skills ?? []) as SkillEntry[]).filter(skill => skill.enabled !== false)
    .map(skill => ({ id: `skill:${skill.id}`, label: skill.name, detail: skill.description, badge: skillLabel, insert: `/${skill.name}` }));
  const pluginList = (Array.isArray(plugins) ? plugins : (plugins as { plugins?: PluginEntry[] } | undefined)?.plugins ?? []) as PluginEntry[];
  const pluginItems = pluginList.filter(plugin => plugin.enabled !== false)
    .map(plugin => ({ id: `plugin:${plugin.id}`, label: plugin.name, detail: plugin.description, badge: pluginLabel, insert: `/${plugin.name}` }));
  return [...skillItems, ...pluginItems];
}

export function filterItems(items: readonly SuggestionItem[], query: string): SuggestionItem[] {
  const q = query.toLowerCase();
  return items.filter(item => item.label.toLowerCase().includes(q) || item.detail?.toLowerCase().includes(q)).slice(0, 50);
}

export interface ComposerSuggestionsState {
  open: boolean;
  /** Feed every text change and caret move here. */
  update(text: string, caret: number): void;
  /** Call first in the composer's keydown; returns true when the picker consumed the key. */
  handleKeyDown(event: KeyboardEvent<Element>, composing: boolean): boolean;
  close(): void;
  view: ReactElement | null;
}

export function useComposerSuggestions({ sessionId, onApply }: {
  sessionId?: string;
  onApply(text: string, caret: number): void;
}): ComposerSuggestionsState {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [slashItems, setSlashItems] = useState<SuggestionItem[] | null>(null);
  const [folders, setFolders] = useState<Record<string, SuggestionItem[] | "error">>({});
  const textRef = useRef({ text: "", caret: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const dismissedAt = useRef<number | null>(null);

  const mentionDir = trigger?.mode === "mention" ? trigger.query.slice(0, trigger.query.lastIndexOf("/") + 1) : "";
  const mentionFilter = trigger?.mode === "mention" ? trigger.query.slice(mentionDir.length) : "";

  // Data is fetched once per open list kind and cached for the session of the composer.
  useEffect(() => {
    if (trigger?.mode !== "slash" || slashItems) return;
    let alive = true;
    void loadSlashItems(t("composer.suggestSkill"), t("composer.suggestPlugin")).then(items => { if (alive) setSlashItems(items); });
    return () => { alive = false; };
  }, [slashItems, t, trigger?.mode]);
  useEffect(() => {
    if (trigger?.mode !== "mention" || !sessionId || folders[mentionDir]) return;
    let alive = true;
    const dir = mentionDir.replace(/\/$/, "");
    void Promise.resolve(window.workspaceFiles?.list?.(sessionId, dir)).then(result => {
      if (!alive) return;
      const entries = result && result.ok ? (result.entries as FileEntry[]) : null;
      setFolders(current => ({ ...current, [mentionDir]: entries ? entries.map(entry => ({
        id: `file:${entry.relPath}`, label: entry.name, detail: entry.relPath,
        badge: entry.isDir ? t("composer.suggestFolder") : undefined,
        insert: `@${entry.relPath}${entry.isDir ? "/" : ""}`, keepOpen: entry.isDir,
      })) : "error" }));
    }).catch(() => { if (alive) setFolders(current => ({ ...current, [mentionDir]: "error" })); });
    return () => { alive = false; };
  }, [folders, mentionDir, sessionId, t, trigger?.mode]);
  // A new session has a different workspace.
  useEffect(() => { setFolders({}); }, [sessionId]);

  const source = trigger?.mode === "slash" ? slashItems : trigger?.mode === "mention" ? folders[mentionDir] : null;
  const items = useMemo(() => Array.isArray(source)
    ? filterItems(source, trigger?.mode === "slash" ? trigger.query : mentionFilter) : [], [mentionFilter, source, trigger]);
  const open = trigger !== null;

  useEffect(() => { setActive(0); }, [trigger?.mode, trigger?.query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const update = useCallback((text: string, caret: number) => {
    textRef.current = { text, caret };
    const next = detectTrigger(text.slice(0, caret));
    // Escape dismisses the current token until the caret leaves it.
    if (next && dismissedAt.current === next.start) { setTrigger(null); return; }
    dismissedAt.current = null;
    setTrigger(next);
  }, []);
  const close = useCallback(() => { setTrigger(null); }, []);

  const apply = useCallback((item: SuggestionItem) => {
    if (!trigger) return;
    const { text, caret } = textRef.current;
    const next = applySuggestion(text, caret, trigger, item);
    textRef.current = next;
    setTrigger(item.keepOpen ? detectTrigger(next.text.slice(0, next.caret)) : null);
    onApply(next.text, next.caret);
  }, [onApply, trigger]);

  const handleKeyDown = useCallback((event: KeyboardEvent<Element>, composing: boolean) => {
    if (!open || composing) return false;
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissedAt.current = trigger?.start ?? null;
      setTrigger(null);
      return true;
    }
    if (items.length === 0) return false;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      setActive(index => (index + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if (key === "Enter" || key === "Tab") {
      event.preventDefault();
      apply(items[Math.min(active, items.length - 1)]);
      return true;
    }
    return false;
  }, [active, apply, items, open, trigger?.start]);

  const status = !open ? null
    : trigger.mode === "mention" && !sessionId ? t("composer.suggestNeedProject")
    : source === undefined || source === null ? t("common.loading")
    : source === "error" ? t("composer.suggestFailed")
    : items.length === 0 ? t("composer.suggestEmpty") : null;

  const view = open ? (
    <div className="ff-suggest" role="listbox" ref={listRef} data-mode={trigger.mode}
      aria-label={trigger.mode === "slash" ? t("composer.suggestSlashTitle") : t("composer.suggestMentionTitle")}>
      <div className="ff-suggest__title">
        {trigger.mode === "slash" ? t("composer.suggestSlashTitle") : t("composer.suggestMentionTitle")}
        {trigger.mode === "mention" && mentionDir && <span className="ff-suggest__path">{mentionDir}</span>}
      </div>
      {status ? <div className="ff-suggest__status">{status}</div> : items.map((item, index) => (
        <div key={item.id} role="option" aria-selected={index === active} data-index={index} className="ff-suggest__item"
          onMouseEnter={() => setActive(index)}
          // Keep the text box focused while picking with the mouse.
          onMouseDown={event => { event.preventDefault(); apply(item); }}>
          <span className="ff-suggest__label">{trigger.mode === "slash" ? "/" : ""}{item.label}</span>
          {item.detail && <span className="ff-suggest__detail">{item.detail}</span>}
          {item.badge && <span className="ff-suggest__badge">{item.badge}</span>}
        </div>
      ))}
      <div className="ff-suggest__hint">{t("composer.suggestHint")}</div>
    </div>
  ) : null;

  return { open, update, handleKeyDown, close, view };
}
