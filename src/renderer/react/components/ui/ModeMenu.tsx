import { Popover } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { SlidingTabs } from "./SlidingTabs";
import "./ModeMenu.css";

interface ModeMenuProps {
  value: string;
  onChange: (mode: string) => void;
  /** sidebar：侧栏顶部整行的滑动胶囊（三个模式一眼可见、一次点击切换）；compact：侧栏折叠时放在标题栏头像旁的小下拉。 */
  variant?: "sidebar" | "compact";
}

/** 模式身份保持 Work/Chat/Code。说明文案来自 i18n：下拉里是副标题，胶囊里是悬停提示。 */
const modes = [
  { key: "work", label: "Work", descriptionKey: "ui.modeWorkDescription" },
  { key: "chat", label: "Chat", descriptionKey: "ui.modeChatDescription" },
  { key: "code", label: "Code", descriptionKey: "ui.modeCodeDescription" },
];
/** 胶囊里的顺序：Chat、Work、Code（日常对话在前）。 */
const capsuleOrder = ["chat", "work", "code"];

function ChevronIcon() {
  return <svg className="ff-mode-menu__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;
}

interface ModeMenuListProps {
  value: string;
  onPick: (mode: string) => void;
  onClose: () => void;
}

/** 弹层内容：挂载时把焦点放到当前模式上，方向键在选项间移动，Esc 关闭。 */
function ModeMenuList({ value, onPick, onClose }: ModeMenuListProps) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, modes.findIndex(mode => mode.key === value));

  useEffect(() => { refs.current[selectedIndex]?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function focusAt(index: number) {
    refs.current[(index + modes.length) % modes.length]?.focus();
  }

  return (
    <div className="ff-mode-menu__list" role="menu" aria-label={t("ui.modeMenu")}
      onKeyDown={event => {
        const current = refs.current.findIndex(node => node === document.activeElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if (event.key === "ArrowDown") { event.preventDefault(); focusAt(current + 1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(current < 0 ? modes.length - 1 : current - 1); }
        else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
        else if (event.key === "End") { event.preventDefault(); focusAt(modes.length - 1); }
      }}>
      {modes.map((mode, index) => {
        const selected = index === selectedIndex;
        return (
          <button key={mode.key} ref={node => { refs.current[index] = node; }} type="button" role="menuitemradio"
            className={`ff-mode-menu__item${selected ? " is-active" : ""}`}
            aria-checked={selected} tabIndex={selected ? 0 : -1}
            onClick={() => onPick(mode.key)}>
            <span className="ff-mode-menu__text">
              <span className="ff-mode-menu__label">{mode.label}</span>
              <small>{t(mode.descriptionKey)}</small>
            </span>
            <svg className="ff-mode-menu__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </button>
        );
      })}
    </div>
  );
}

/** 侧栏顶部的模式切换：展开时是滑动胶囊；折叠时是下拉（触发器显示当前模式名和小箭头，点开后每行是模式名 + 一行说明，当前项带勾）。 */
export function ModeMenu({ value, onChange, variant = "sidebar" }: ModeMenuProps) {
  if (variant === "sidebar") return <ModeCapsule value={value} onChange={onChange} />;
  return <ModeDropdown value={value} onChange={onChange} variant={variant} />;
}

function ModeCapsule({ value, onChange }: Pick<ModeMenuProps, "value" | "onChange">) {
  const { t } = useTranslation();
  return (
    <div className="ff-mode-switch">
      <SlidingTabs
        stretch
        ariaLabel={t("ui.modeMenu")}
        activeId={value}
        onChange={(mode) => { if (mode !== value) onChange(mode); }}
        tabs={capsuleOrder.map((key) => {
          const mode = modes.find((item) => item.key === key)!;
          return { id: mode.key, label: mode.label, title: t(mode.descriptionKey), tabData: { "data-mode": mode.key } };
        })}
      />
    </div>
  );
}

function ModeDropdown({ value, onChange, variant }: ModeMenuProps & { variant: "sidebar" | "compact" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = modes.find(mode => mode.key === value) ?? modes[0];

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      arrow={false}
      rootClassName="ff-mode-popover"
      content={(
        <ModeMenuList value={value} onClose={() => close(true)}
          onPick={mode => { close(true); if (mode !== value) onChange(mode); }} />
      )}
    >
      <button ref={triggerRef} type="button" className={`ff-mode-menu__trigger is-${variant}${open ? " is-open" : ""}`}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={t("ui.modeSelector", { mode: current.label })}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); }
          else if (event.key === "Escape" && open) { event.stopPropagation(); close(false); }
        }}>
        <span>{current.label}</span>
        <ChevronIcon />
      </button>
    </Popover>
  );
}
