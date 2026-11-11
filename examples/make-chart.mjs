#!/usr/bin/env node
/**
 * make-chart.mjs —— 把几天的分析结果画成一张 SVG（不依赖任何绘图库）
 *
 * 为什么手搓 SVG 而不是装 matplotlib/chart.js：
 *   仓库要塞进 GitHub，别人 clone 下来应该一条命令就能重新生成图，
 *   不该为了画一张柱状图去装 300MB 的依赖。SVG 是文本，能 diff，也能直接显示。
 *
 * 用法：
 *   node make-chart.mjs <目录> [输出.svg] [时区=8]
 *   目录里放 sense-YYYY-MM-DD.jsonl(.gz)，最多取 14 天
 *
 * 判据和 body-signals.mjs 完全一致（同一套 MOVE_EPS / STILL_HOUR）。
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import readline from "readline";
import { createReadStream } from "fs";

const MOVE_EPS = 0.12;
const STILL_HOUR = 100;
const MIN_SAMPLES = 200;

const DIR = process.argv[2] || ".";
const OUT = process.argv[3] || "chart.svg";
const TZ = Number(process.argv[4] ?? 8);

function hourOf(t) {
  return new Date((t + TZ * 3600) * 1000).getUTCHours();
}

function parse(line) {
  let r;
  try { r = JSON.parse(line); } catch { return null; }
  let t = r.t ?? r.time ?? r.timestamp ?? r.ts;
  if (typeof t === "string") t = Date.parse(t) / 1000;
  else if (typeof t === "number") t = t > 1e12 ? t / 1000 : t;
  if (!t) return null;
  let v = null;
  for (const k of ["accelerometer", "accelerometerUncalibrated", "accel", "userAcceleration"]) {
    const a = r.s?.[k] ?? r[k];
    if (a && typeof a.x === "number") { v = [a.x, a.y, a.z]; break; }
  }
  if (!v && typeof r.ax === "number") v = [r.ax, r.ay, r.az];
  return t && v ? { t, v } : { t, v: null };
}

async function oneDay(file) {
  const hours = Array.from({ length: 24 }, () => ({ n: 0, moves: 0 }));
  const input = file.endsWith(".gz")
    ? createReadStream(file).pipe(zlib.createGunzip())
    : createReadStream(file);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let prev = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = parse(line);
    if (!p?.v) continue;
    const h = hours[hourOf(p.t)];
    h.n++;
    if (prev) {
      const d = Math.hypot(p.v[0] - prev[0], p.v[1] - prev[1], p.v[2] - prev[2]);
      if (d > MOVE_EPS) h.moves++;
    }
    prev = p.v;
  }
  const valid = hours.map((h, i) => ({ i, ...h })).filter((h) => h.n >= MIN_SAMPLES);
  if (!valid.length) return null;

  let run = null, best = { start: null, len: 0 };
  for (let i = 0; i < 24; i++) {
    if (hours[i].n < MIN_SAMPLES) continue;
    if (hours[i].moves < STILL_HOUR) {
      if (run === null) run = i;
      if (i - run + 1 > best.len) best = { start: run, len: i - run + 1 };
    } else run = null;
  }
  return {
    total: valid.reduce((a, h) => a + h.moves, 0),
    hours,
    sleep: best,
    date: (file.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "?",
  };
}

/* —— 画图：上面柱状（每天总动作），下面一条带（睡眠窗口） —— */
function svg(days) {
  const W = 900, H = 380, PAD = { l: 70, r: 30, t: 50, b: 70 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const max = Math.max(...days.map((d) => d.total)) * 1.1;
  const bw = iw / days.length;

  const e = [];
  e.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`);
  e.push(`<rect width="${W}" height="${H}" fill="#0f1115"/>`);
  e.push(`<text x="${PAD.l}" y="28" fill="#e6e6e6" font-size="17">一天的形状：动作量 vs 最长一段不动</text>`);
  e.push(`<text x="${PAD.l}" y="46" fill="#8a8f98" font-size="12">柱子＝这天总动作次数　｜　下方条＝最长一段「没动」的时间窗（睡觉/久坐）</text>`);

  // y 轴刻度
  for (let k = 0; k <= 4; k++) {
    const y = PAD.t + ih - (ih * k) / 4;
    e.push(`<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#242832" stroke-width="1"/>`);
    e.push(`<text x="${PAD.l - 10}" y="${y + 4}" fill="#6b7280" font-size="11" text-anchor="end">${Math.round((max * k) / 4 / 1000)}k</text>`);
  }

  days.forEach((d, i) => {
    const x = PAD.l + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const h = (d.total / max) * ih;
    const y = PAD.t + ih - h;
    e.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#4f9cf9" rx="3" opacity="0.85"/>`);
    // 睡眠窗口：在柱底画一条短线，标出起止
    if (d.sleep.len) {
      const sx = x, sw = w;
      const sy = PAD.t + ih + 10;
      const a = d.sleep.start, b = d.sleep.start + d.sleep.len;
      e.push(`<rect x="${sx}" y="${sy + 18}" width="${sw}" height="8" fill="#2b3040" rx="4"/>`);
      e.push(`<rect x="${sx}" y="${sy + 18}" width="${sw}" height="8" fill="#7c5cff" rx="4" opacity="0.9"/>`);
      e.push(`<text x="${sx + sw / 2}" y="${sy + 42}" fill="#8a8f98" font-size="10" text-anchor="middle">${a}h→${b}h</text>`);
    }
    e.push(`<text x="${x + w / 2}" y="${H - 14}" fill="#6b7280" font-size="10" text-anchor="middle">${d.date.slice(5)}</text>`);
  });

  e.push(`</svg>`);
  return e.join("\n");
}

/* —— 主流程 —— */
const files = fs.readdirSync(DIR)
  .filter((f) => /^sense-\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$/.test(f))
  .sort()
  .slice(-14);

if (!files.length) {
  console.error(`在 ${DIR} 里没找到 sense-YYYY-MM-DD.jsonl(.gz)。先放几天数据再跑。`);
  process.exit(1);
}

const days = [];
for (const f of files) {
  const d = await oneDay(path.join(DIR, f));
  if (d) { days.push(d); console.log(`${d.date}  动作 ${d.total}  不动 ${d.sleep.len}h（${d.sleep.start ?? "-"} 点起）`); }
}

fs.writeFileSync(OUT, svg(days));
console.log(`\n画好了：${OUT}`);
