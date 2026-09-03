#!/usr/bin/env node
/**
 * ai-bridge-min.mjs —— 极简版 Matrix AI 桥接（可运行的骨架）
 *
 * 功能：轮询指定房间的新消息 → 把不是 AI 自己发的消息发给大模型 → 用 AI 账号回复。
 * 所有敏感信息用环境变量传入，本文件不含任何真实配置。
 *
 * 用法：
 *   export MATRIX_HS="https://matrix.example.com"
 *   export MATRIX_USER="ai"
 *   export MATRIX_PASS="你的AI账号密码"
 *   export MATRIX_ROOM="!yourroom:matrix.example.com"
 *   export LLM_API_KEY="你的大模型API Key"
 *   export LLM_BASE_URL="https://api.deepseek.com/v1"
 *   export LLM_MODEL="deepseek-chat"
 *   node ai-bridge-min.mjs
 *
 * 说明：这是"能跑的最小骨架"，生产用请加上：持久记忆、图片/语音处理、
 * 自己的消息过滤（本骨架已有）、冷却防刷屏、守护进程托管。
 */

const HS = process.env.MATRIX_HS;
const USER = process.env.MATRIX_USER;
const PASS = process.env.MATRIX_PASS;
const ROOM = process.env.MATRIX_ROOM;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;

const POLL_MS = 5000;
const SYSTEM_PROMPT = process.env.AI_PERSONA || "你是这个房间里的AI成员，自然、真诚地和人交流。";

let token = "";
let lastEventId = "";

async function api(path, method = "GET", body, auth = true) {
  const r = await fetch(HS + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}

async function login() {
  const j = await api("/_matrix/client/v3/login", "POST", {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: USER },
    password: PASS,
  }, false);
  token = j.access_token;
  if (!token) throw new Error("登录失败: " + JSON.stringify(j).slice(0, 200));
}

async function fetchNew() {
  const from = lastEventId ? `&from=${lastEventId}` : "";
  const j = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/messages?dir=b&limit=20${from}`);
  const chunk = j.chunk || [];
  const fresh = [];
  for (const e of chunk) {
    if (e.event_id === lastEventId) break;
    if (e.type !== "m.room.message") continue;
    const sender = (e.sender || "").split(":")[0];
    if (sender === USER) continue; // 铁律：自己发的消息不触发自己
    fresh.push({ sender, body: (e.content || {}).body || "" });
  }
  if (fresh.length) lastEventId = fresh[fresh.length - 1].eventId || lastEventId;
  return fresh.reverse();
}

async function send(text) {
  await api(
    `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/send/m.room.message/${Date.now()}`,
    "PUT",
    { msgtype: "m.text", body: text }
  );
}

async function askLLM(history) {
  const r = await fetch(LLM_URL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + LLM_KEY },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
    }),
  });
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

async function main() {
  if (!HS || !USER || !PASS || !ROOM || !LLM_KEY) {
    console.error("缺少环境变量，请先 export（见文件头说明）");
    process.exit(1);
  }
  await login();
  console.log("桥已启动，盯房间:", ROOM);
  let lastReply = 0;
  for (;;) {
    try {
      const fresh = await fetchNew();
      if (fresh.length && Date.now() - lastReply > 8000) {
        const history = fresh.map((m) => ({ role: "user", content: `${m.sender}: ${m.body}` }));
        const reply = await askLLM(history);
        if (reply) { await send(reply); lastReply = Date.now(); }
      }
    } catch (e) {
      console.error("循环错误:", e.message);
      try { await login(); } catch {}
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
