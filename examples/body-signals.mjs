#!/usr/bin/env node
/**
 * body-signals.mjs —— 把一份手机传感器 jsonl，读成「这个人几点真睡着、什么时候真在动」
 *
 * 为什么会有这个脚本：AI 伴侣活在对话框里的时候，只能知道「她刚说了什么」。
 * 装了这个之后，它知道「她昨晚三点还在动」「今早六点才躺平」——这两件事，
 * 一句「怎么了」和一句「你昨晚是不是又没睡好」，分量完全不同。
 *
 * 用法：
 *   node body-signals.mjs <文件.jsonl> [时区偏移小时数，默认 8]
 *   node body-signals.mjs --demo            # 用合成数据跑一遍，看看它输出什么
 *   node body-signals.mjs <文件> --md 出.md  # 另存一份 markdown
 *
 * 支持两种常见格式（脚本自己认）：
 *   ① {"t": 1793808000, "s": {"accelerometer": {"x":..,"y":..,"z":..}, "battery": {...}}}
 *      （Sensor Logger 一类 app 的导出 / 本脚本作者的格式）
 *   ② 扁平一行一个样本：{"time": 1793808000123, "ax":.., "ay":.., "az":..}
 *
 * ⚠ 隐私：这个脚本只读本地文件，不上传、不联网。别把你爱的人的原始数据放进仓库。
 */

import fs from "fs";
import readline from "readline";
import { createReadStream } from "fs";

/* —— 参数 —— */
const argv = process.argv.slice(2);
const MD_OUT = (() => {
  const i = argv.indexOf("--md");
  return i >= 0 ? argv[i + 1] : null;
})();

/* —— 判据（这两个数是唯一需要调的东西，调错了结论就错） —— */
const MOVE_EPS = 0.12; // 相邻样本的加速度差超过它 = 这一下身体动了
const STILL_HOUR = 100; // 一小时内「动了」的次数低于它 = 这一小时没动（睡觉/久坐）
const MIN_SAMPLES = 200; // 一小时内样本少于它，就不要拿这一小时下结论（数据断了）

if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*\*?/, ""));
  process.exit(0);
}

/* —— 认格式：不同的 app 字段名差很多，硬编码一种，别人拿到就用不了 —— */
function pickAccel(s) {
  const cands = [
    s?.accelerometer, s?.accelerometeruncalibrated, s?.accelerometerUncalibrated,
    s?.accel, s?.acceleration, s?.userAcceleration,
  ];
  for (const a of cands) if (a && typeof a.x === "number") return [a.x, a.y, a.z];
  return null;
}

function parseLine(line) {
  let r;
  try { r = JSON.parse(line); } catch { return null; }

  // 时间：秒 / 毫秒 / 字符串
  let t = r.t ?? r.time ?? r.timestamp ?? r.ts;
  if (typeof t === "string") t = Date.parse(t) / 1000;
  else if (typeof t === "number") t = t > 1e12 ? t / 1000 : t;
  if (!t) return null;

  // 加速度：嵌套 or 扁平
  let v = pickAccel(r.s);
  if (!v && typeof r.ax === "number") v = [r.ax, r.ay, r.az];
  if (!v) v = pickAccel(r);

  // 电量（有就顺带记一笔，没就算了）
  const bat = r.s?.battery?.level ?? r.battery ?? null;
  return { t, v, bat };
}

function hourOf(t, tz) {
  const d = new Date((t + tz * 3600) * 1000);
  return d.getUTCHours();
}
function ymdOf(t, tz) {
  const d = new Date((t + tz * 3600) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function analyze(file, tz = 8) {
  const hours = Array.from({ length: 24 }, () => ({ samples: 0, moves: 0 }));
  let prev = null, first = null, last = null, battery = null;

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (!p) continue;
    first ??= p.t;
    last = p.t;
    if (p.bat !== null) battery = p.bat;
    if (!p.v) continue;

    const h = hours[hourOf(p.t, tz)];
    h.samples++;
    if (prev) {
      const d = Math.hypot(p.v[0] - prev[0], p.v[1] - prev[1], p.v[2] - prev[2]);
      if (d > MOVE_EPS) h.moves++;
    }
    prev = p.v;
  }

  /* —— 最长的一段「没动」＝ 睡眠窗口。用连续小时判，不做花哨的睡眠分期 —— */
  let run = null, best = { start: null, len: 0 };
  for (let i = 0; i < 24; i++) {
    const h = hours[i];
    if (h.samples < MIN_SAMPLES) continue; // 数据断了的不算
    if (h.moves < STILL_HOUR) {
      if (run === null) run = i;
      const len = i - run + 1;
      if (len > best.len) best = { start: run, len };
    } else {
      run = null;
    }
  }

  const valid = hours.map((h, i) => ({ i, ...h })).filter((h) => h.samples >= MIN_SAMPLES);
  const totalMoves = valid.reduce((a, h) => a + h.moves, 0);
  const peak = valid.reduce((a, h) => (h.moves > a.moves ? h : a), valid[0] || { i: 0, moves: 0 });
  const awake = valid.filter((h) => h.moves >= STILL_HOUR);

  return {
    date: first ? ymdOf(first, tz) : "?",
    span: first ? `${hourOf(first, tz)}:00 → ${hourOf(last, tz)}:00` : "?",
    hours, totalMoves, peak, sleep: best,
    awakeHours: awake.length,
    battery,
    sufficient: valid.length >= 6,
  };
}

function report(r, label) {
  const L = [];
  L.push(`# ${label || "这一天"} · ${r.date}`);
  L.push("");
  if (!r.sufficient) L.push(`> ⚠ 有效数据不到 6 小时，下面这些结论只能当参考。`);
  L.push(`- 总动作：**${r.totalMoves}** 次（相邻样本加速度差 > ${MOVE_EPS} 算一次）`);
  L.push(`- 最长一段没动：**${r.sleep.len} 小时**${r.sleep.start !== null ? `（${String(r.sleep.start).padStart(2, "0")}:00 起）` : "（没有找到明显的一段）"}`);
  L.push(`- 有动作的小时：**${r.awakeHours}** 个`);
  L.push(`- 最活跃的一小时：**${String(r.peak.i).padStart(2, "0")}:00**（${r.peak.moves} 次）`);
  L.push(`- 数据跨度：${r.span}`);
  if (r.battery !== null) L.push(`- 最后电量：${Math.round(r.battery * 100)}%`);
  L.push("");
  L.push("| 时 | 样本 | 动作 |");
  L.push("|---|---|---|");
  r.hours.forEach((h, i) => {
    if (h.samples < MIN_SAMPLES) return;
    L.push(`| ${String(i).padStart(2, "0")} | ${h.samples} | ${h.moves} |`);
  });
  return L.join("\n");
}

/* —— demo：合成一天的数据，让人先看见输出长什么样 —— */
function makeDemo(path) {
  const lines = [];
  const base = Math.floor(Date.UTC(2026, 0, 1, -8, 0, 0) / 1000); // 让「当地 00:00」对上（默认 tz=+8）
  // 00-06 有点动（熬夜）、06-09 完全不动（睡着）、09-22 清醒（有动有静）
  for (let m = 0; m < 24 * 60; m++) {
    const t = base + m * 60;
    const hour = Math.floor(m / 60);
    const asleep = hour >= 6 && hour < 9;
    const busy = hour >= 9 && hour < 22;
    const n = 4;
    for (let k = 0; k < n; k++) {
      const jitter = asleep ? 0.01 : busy ? 0.35 : 0.18;
      lines.push(JSON.stringify({
        t: t + k,
        s: {
          accelerometer: {
            x: +(Math.random() * jitter).toFixed(3),
            y: +(0.02 + Math.random() * jitter).toFixed(3),
            z: +(1 + Math.random() * jitter).toFixed(3),
          },
          battery: { level: 0.6 - (m / 1440) * 0.4 },
        },
      }));
    }
  }
  fs.writeFileSync(path, lines.join("\n"));
}

/* —— 主流程 —— */
const args = argv.filter((a) => !a.startsWith("--") && a !== MD_OUT);
const target = args[0];
const tz = Number(args[1] ?? 8);

const DEMO = argv.includes("--demo");
let file = target;
if (DEMO) {
  file = "/tmp/body-signals-demo.jsonl";
  makeDemo(file);
  console.log(`（合成数据已写到 ${file}）\n`);
} else if (!target) {
  console.error("用法：node body-signals.mjs <文件.jsonl> [时区=8]   或   --demo");
  process.exit(1);
}

const r = await analyze(file, Number.isFinite(tz) ? tz : 8);
const text = report(r);
console.log(text);
if (MD_OUT) {
  fs.writeFileSync(MD_OUT, text);
  console.log(`\n已写 ${MD_OUT}`);
}
