// 新会话页背后的字符雨：一列列很淡的等宽字母数字往下落，尾巴渐隐，像参考视频里那样只在部分列出现。
// - 颜色取主题的次要文字色，透明度很低，不抢内容；
// - 约 20 帧每秒，窗口不可见时暂停；系统"减少动态效果"时只画一帧静止的；
// - 纯装饰：aria-hidden、不接收指针。
import { useEffect, useRef } from "react";
import "./CodeRain.css";

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CELL = 14;
const FRAME_MS = 50;
/** Share of columns raining at any moment; the rest stay empty so the rain comes in patches. */
const ACTIVE_SHARE = 0.32;

interface Drop { y: number; speed: number; active: boolean }

export function randomGlyph(random: () => number = Math.random): string {
  return GLYPHS[Math.floor(random() * GLYPHS.length)] ?? "a";
}

export function CodeRain({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let drops: Drop[] = [];
    let width = 0;
    let height = 0;
    let color = "rgb(128,128,140)";

    const readColor = () => {
      color = getComputedStyle(canvas).color || color;
    };
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `12px ui-monospace, "Cascadia Mono", Consolas, monospace`;
      const columns = Math.ceil(width / CELL);
      drops = Array.from({ length: columns }, () => ({
        y: Math.random() * height, speed: 0.6 + Math.random() * 0.9, active: Math.random() < ACTIVE_SHARE,
      }));
      readColor();
    };
    const step = () => {
      // Fade what is already there instead of clearing, which leaves each column a tail.
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "rgba(0,0,0,0.12)";
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = color;
      drops.forEach((drop, column) => {
        if (!drop.active) {
          if (Math.random() < 0.004) { drop.active = true; drop.y = -CELL * Math.random() * 10; }
          return;
        }
        context.fillText(randomGlyph(), column * CELL, drop.y);
        drop.y += CELL * drop.speed;
        if (drop.y > height + CELL * 4) {
          drop.y = -CELL * Math.random() * 20;
          drop.active = Math.random() < ACTIVE_SHARE;
          drop.speed = 0.6 + Math.random() * 0.9;
        }
      });
    };

    resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(canvas);
    if (reduced) {
      for (let index = 0; index < 40; index += 1) step();
      return () => observer?.disconnect();
    }
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      step();
    };
    frame = requestAnimationFrame(loop);
    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-theme", "data-theme", "class"] });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`ff-code-rain ${className ?? ""}`} aria-hidden="true" />;
}
