// 用户时区白名单。设置页只暴露下列选项；保存时只接受这里的 value（空串/非法/不在白名单一律回退 Asia/Shanghai）。
// 显示 label 形如"北京时间（UTC+08:00）"，value 用 IANA 时区名；偏移取标准时间（与既有选项一致，不随夏令时变化）。
// 主进程 resolveChatContextTimezone 只用 Intl 校验 IANA 名，不另设列表：新增选项无需改主进程，value 须是 Intl 认可的 Area/City 形式。
// 任何主进程格式化位置都不直接吃 profile.timezone，必须先经 resolveChatContextTimezone 校验再喂 Intl。

export interface TimezoneOption {
  label: string;
  value: string;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { label: "北京时间（UTC+08:00）", value: "Asia/Shanghai" },
  { label: "东京时间（UTC+09:00）", value: "Asia/Tokyo" },
  { label: "台北时间（UTC+08:00）", value: "Asia/Taipei" },
  { label: "首尔时间（UTC+09:00）", value: "Asia/Seoul" },
  { label: "香港时间（UTC+08:00）", value: "Asia/Hong_Kong" },
  { label: "新加坡时间（UTC+08:00）", value: "Asia/Singapore" },
  { label: "印度时间（UTC+05:30）", value: "Asia/Kolkata" },
  { label: "迪拜时间（UTC+04:00）", value: "Asia/Dubai" },
  { label: "伦敦时间（UTC+00:00）", value: "Europe/London" },
  { label: "巴黎时间（UTC+01:00）", value: "Europe/Paris" },
  { label: "柏林时间（UTC+01:00）", value: "Europe/Berlin" },
  { label: "莫斯科时间（UTC+03:00）", value: "Europe/Moscow" },
  { label: "纽约时间（UTC-05:00）", value: "America/New_York" },
  { label: "芝加哥时间（UTC-06:00）", value: "America/Chicago" },
  { label: "洛杉矶时间（UTC-08:00）", value: "America/Los_Angeles" },
  { label: "圣保罗时间（UTC-03:00）", value: "America/Sao_Paulo" },
  { label: "檀香山时间（UTC-10:00）", value: "Pacific/Honolulu" },
  { label: "悉尼时间（UTC+10:00）", value: "Australia/Sydney" },
  { label: "奥克兰时间（UTC+12:00）", value: "Pacific/Auckland" },
] as const;

/** 加载时校验：空串/非法/不在白名单都回退 Asia/Shanghai。 */
export const FALLBACK_TIMEZONE = "Asia/Shanghai";

export function normalizeTimezoneOptionValue(raw: string | null | undefined): string {
  if (!raw) return FALLBACK_TIMEZONE;
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK_TIMEZONE;
  return TIMEZONE_OPTIONS.some((o) => o.value === trimmed) ? trimmed : FALLBACK_TIMEZONE;
}