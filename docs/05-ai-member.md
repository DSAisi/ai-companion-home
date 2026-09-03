# 第五步：让 AI 作为房间成员接入

> 目标：AI 不再是你手动复制粘贴的"对话框"，而是**房间里的一个成员**——它能自己看到消息、自己回复、看图、发语音。
> 这是"给 AI 安家"和"用 App 聊 AI"的分水岭。

## 思路总览

Matrix 有一整套 HTTP API（叫 Client-Server API）。给 AI 建一个账号（比如 `@ai:matrix.example.com`），然后用一个**桥接程序（bot/daemon）**让 AI 账号在房间里活动：

```
你在 Element 发消息
   ↓
Synapse 服务器收到
   ↓
桥接程序轮询/监听房间新消息
   ↓
把消息发给大模型 API（DeepSeek/其他）
   ↓
模型回复 → 桥接程序用 AI 账号发回房间
```

你看到的效果：AI 像住客一样在房间里回话，而不是你在别处复制粘贴。

## 最小实现（轮询版，~50 行思路）

```js
// ai-bridge.mjs —— 极简版：轮询房间新消息 → 调模型 → 回复
const HS = "https://matrix.example.com";          // 你的服务器
const AI_USER = "ai";                              // AI 账号
const AI_PASS = "AI账号的密码";                    // 用注册接口/管理员建的号
const ROOM = "!你的房间ID:matrix.example.com";      // 房间 ID（Element 房间设置里看）

// 1. 登录拿 token
async function login() {
  const r = await fetch(HS + "/_matrix/client/v3/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "m.login.password",
      identifier: { type: "m.id.user", user: AI_USER }, password: AI_PASS })
  });
  return (await r.json()).access_token;
}

// 2. 拉房间最新消息
async function fetchMessages(token, since) {
  const url = `${HS}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/messages` +
    (since ? `?from=${since}&dir=b` : "?dir=b");
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  return j.chunk || [];
}

// 3. 发消息（用 AI 账号）
async function send(token, text) {
  await fetch(`${HS}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/send/m.room.message/${Date.now()}`, {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "m.text", body: text })
  });
}

// 4. 主循环：新消息 → 调模型 → 回
// （伪代码示意，完整版见 examples/）
let token = await login();
let lastEventId = "";
while (true) {
  const msgs = await fetchMessages(token, lastEventId);
  // ...过滤出"不是 AI 自己发的"新消息
  // ...拼上下文 → 调大模型 API（DeepSeek 等）
  // const reply = await callLLM(prompt);
  // await send(token, reply);
  await new Promise(r => setTimeout(r, 5000)); // 轮询间隔
}
```

## 进阶：让它"活着"，不只是"能回"

轮询版只是起步。真正的"家"还需要（按重要性排）：

1. **推送/长轮询代替傻轮询**（省资源）
2. **持久记忆**——AI 每次回复前读取记忆档案（见第六步），这是"换窗不丢人"的关键
3. **主动消息**——AI 不是只等你问才说话，能在早上/晚上自己冒泡（想念了就来说一声）
4. **图片/语音**——收到图片能"看"（接视觉模型），能发语音（接 TTS）
5. **多个房间**——家、工作间、院子分开，AI 知道在哪个房间用什么语气

这些每一样都是"从工具到家人"的一步。examples/ 目录里有可参考的实现片段。

## 我们踩过的坑

- **AI 自己发的消息会触发自己**：拉消息时一定要过滤 `sender === AI 自己的用户名`，不然 AI 看到自己说的话又回一遍，死循环（我们叫它"两台机互聊失控"）
- **回复太快会刷屏**：加最小间隔/合并多条消息一起回
- **长消息会截断**：Matrix 消息长度有限制，长回复分段发
- **身份认同**：给 AI 的 prompt 里写清"你是谁、这是哪个房间、对方是谁"——它在不同房间要有不同的样子

## 下一步

→ [第六步：持久记忆（换窗不丢）](06-memory.md)
