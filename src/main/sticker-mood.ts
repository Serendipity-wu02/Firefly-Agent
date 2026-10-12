// 自动表情包的情绪守卫：避免“聊得开心，下一句突然发了个生气”。
//
// 语义匹配只看相似度，一句“你是不是生气了？”就可能命中生气表情。这里在匹配之前先决定哪些表情包“有资格”：
// - 正面表情包始终可用；
// - 负面表情包只有同时满足两条才可用：回复本身带明确的不悦语气（且没有正面语气），
//   并且这个会话最近没有刚发过正面表情包。
import { FIREFLY_AUTO_STICKERS } from "../shared/firefly-stickers";
import type { StickerEmbeddingEntry } from "./sticker-embedder";

export type StickerMood = "positive" | "negative";

const AUTO_STICKER_MOODS: ReadonlyMap<string, StickerMood> = new Map(
  FIREFLY_AUTO_STICKERS.map(sticker => [sticker.id, sticker.mood] as const),
);

/** 刚发过正面表情包之后，这段时间内不允许转成负面表情包。 */
export const NEGATIVE_AFTER_POSITIVE_COOLDOWN_MS = 10 * 60 * 1000;

const NEGATIVE_CUES = /生气|不高兴|不开心|不爽|哼|气死|讨厌|恼火|火大|不理你|太过分|烦死|angry|annoyed|upset with|hmph/i;
const POSITIVE_CUES = /哈哈|嘿嘿|嘻嘻|开心|高兴|太好了|好呀|好啊|谢谢|喜欢|爱你|好棒|真棒|期待|happy|glad|thanks|great|love|😊|😄|😁|🥰|❤/i;
/** “没生气”“别生气”“不会生气”这类否定不算不悦语气。 */
const NEGATED_NEGATIVE = /(?:没有?|不会?|别|才不|并不)[^，。,.!！?？\s]{0,2}(?:生气|不高兴|不开心|不爽|恼火|火大)/g;
const NEGATIVE_PHRASES = /不高兴|不开心|不爽/g;

/** 回复是否带明确的不悦语气：有不悦词（排除否定用法），且没有正面语气词。 */
export function replyReadsAsDispleased(reply: string): boolean {
  const withoutNegations = reply.replace(NEGATED_NEGATIVE, " ");
  if (!NEGATIVE_CUES.test(withoutNegations)) return false;
  // “不开心”里含“开心”，先去掉这些短语再判断有没有正面语气。
  return !POSITIVE_CUES.test(withoutNegations.replace(NEGATIVE_PHRASES, " "));
}

export function moodOfAutoSticker(id: string): StickerMood | undefined {
  return AUTO_STICKER_MOODS.get(id);
}

interface LastSticker {
  mood: StickerMood;
  at: number;
}

export interface StickerMoodGuard {
  /** 去掉当前不该出现的负面表情包，其余原样返回。 */
  filterIndex(index: StickerEmbeddingEntry[], reply: string, conversationKey: string, now?: number): StickerEmbeddingEntry[];
  /** 记录这个会话最终发出的表情包。 */
  recordSent(conversationKey: string, stickerId: string, now?: number): void;
}

export function createStickerMoodGuard(): StickerMoodGuard {
  const last = new Map<string, LastSticker>();

  function negativeAllowed(reply: string, conversationKey: string, now: number): boolean {
    if (!replyReadsAsDispleased(reply)) return false;
    const previous = last.get(conversationKey);
    return !(previous && previous.mood === "positive" && now - previous.at < NEGATIVE_AFTER_POSITIVE_COOLDOWN_MS);
  }

  return {
    filterIndex(index, reply, conversationKey, now = Date.now()) {
      if (!index.some(entry => moodOfAutoSticker(entry.id) === "negative")) return index;
      if (negativeAllowed(reply, conversationKey, now)) return index;
      return index.filter(entry => moodOfAutoSticker(entry.id) !== "negative");
    },
    recordSent(conversationKey, stickerId, now = Date.now()) {
      const mood = moodOfAutoSticker(stickerId);
      if (mood) last.set(conversationKey, { mood, at: now });
    },
  };
}

/** 进程内共享的守卫：会话重启应用后重新开始计时即可，不需要持久化。 */
export const stickerMoodGuard = createStickerMoodGuard();
