// 坐在输入框上沿的像素流萤：配色取自 Live2D 模型（银灰长发、深色发带带青色饰、紫粉渐变眼、深色外套配青色领口与橙色扣）。
// 每个字符是一格像素，"." 为透明；用 SVG 方块画，放大后依然锐利。轻微上下浮动，偶尔眨眼；减少动态效果时静止。
import { memo, useEffect, useState } from "react";
import "./PixelFirefly.css";

export const PIXEL_PALETTE: Record<string, string> = {
  o: "#4a3a42", // outline
  h: "#e6e2e6", // hair
  H: "#b4adb6", // hair shade
  b: "#2f2b3a", // hairband
  t: "#62bfae", // teal ornament
  s: "#fdeee8", // skin
  p: "#f4aaa3", // blush
  e: "#6e4fae", // eye, upper
  E: "#d78ad8", // eye, lower (pink)
  w: "#ffffff", // eye highlight
  m: "#b9545a", // mouth
  j: "#3b3547", // jacket
  J: "#585070", // jacket light
  c: "#7fcabd", // collar
  r: "#ec9440", // orange clasp
  l: "#2b2731", // tights
  k: "#efeaf2", // shoes
};

export const PIXEL_FIREFLY: readonly string[] = [
  "........oooooooo........",
  "......oohhhhhhhhoo......",
  ".....ohhhhhhhhhhhho.....",
  "....obbbbbbbbbbbbbbo....",
  "...obtthhhhhhhhhhhhho...",
  "...ohhhhhhhhhhhhhhhho...",
  "..ohhhHhhhhHHhhhhHhhho..",
  "..ohhHhhsHhssssHshhHho..",
  "..ohHhssssssssssssshHho.",
  ".ohhHsssssssssssssssHho.",
  ".ohhHsoowssssssoowsshHo.",
  ".ohhHseeesssssseeeshHho.",
  ".ohhHsEEEsssssssEEEshHo.",
  ".ohhHspsssssmmsssspsshHo",
  ".ohhhHssssssssssssssHho.",
  ".ohhhhHosssssssssoHhhho.",
  ".ohhhHo.oojjccjjoo.ohho.",
  ".ohhHo.ojJjcrrcjJjo.oHo.",
  "..oHHo.ojjjjccjjjjo.oo..",
  "...oo.osojjjjjjjjoso....",
  "......ooojjjjjjjjooo....",
  "........ollo..ollo......",
  "........ollo..ollo......",
  "........okko..okko......",
];

/** Rows 10-12 are the eyes; while blinking they become a closed line. */
const EYE_ROWS = [10, 11, 12];
const CLOSED: Record<number, string> = {
  10: ".ohhHssssssssssssssshHo.",
  11: ".ohhHsoooossssooooshHho.",
  12: ".ohhHssssssssssssssshHo.",
};

export const PixelFirefly = memo(function PixelFirefly({ size = 3, className }: { size?: number; className?: string }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => { setBlink(false); schedule(); }, 140);
      }, 2800 + Math.random() * 3200);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  const rows = PIXEL_FIREFLY.map((row, y) => (blink && EYE_ROWS.includes(y) ? CLOSED[y]! : row));
  const width = rows[0]!.length;
  return (
    <svg className={`ff-pixel-firefly ${className ?? ""}`} width={width * size} height={rows.length * size}
      viewBox={`0 0 ${width} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) => [...row].map((cell, x) => cell === "." ? null
        : <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill={PIXEL_PALETTE[cell]} />))}
    </svg>
  );
});
