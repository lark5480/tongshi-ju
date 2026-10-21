# 《通识局》架构说明

> 业务规则见 [`GAME-RULES.md`](GAME-RULES.md)，API 见 [`API.md`](API.md)。
> 不可破坏的红线写在 [`../AGENTS.md`](../AGENTS.md)。

---

## 1. 全局分层

```
┌─────────────────────────────────────────────────────────┐
│ app/            页面（App Router）+ API 路由            │
├─────────────────────────────────────────────────────────┤
│ hooks/          客户端状态编排（useDailyChallenge 等）   │
├─────────────────────────────────────────────────────────┤
│ lib/engine/     纯函数：客户端与服务端共用，无 IO         │
│ lib/store/      房间状态机（服务端内存）+ 入参校验       │
│ lib/ai/         AI provider / prompt / 10 步校验链      │
│ lib/content/    指纹 / 题库加载 / 服务端题库             │
│ lib/storage.ts  localStorage 安全封装（客户端）           │
├─────────────────────────────────────────────────────────┤
│ content/domains/  12 域元数据 + 12 个题库 JSON           │
└─────────────────────────────────────────────────────────┘
```

**`lib/engine/*` 是纯函数层** —— 不碰 IO、不碰时间、不碰全局状态。
这一层是"客户端与服务端跑同一份代码"的前提，也是每日挑战无状态的基础。

---

## 2. 每日挑战的无状态链路

```
客户端（全部在此完成）
  ├─ dayKey()  ← lib/engine/date.ts          （本地按 Asia/Shanghai 取今天）
  ├─ resolveDailyDomains() ← blindbox.ts
  ├─ dailySeed() / buildDailySet() ← daily.ts
  └─ 抽题、答题、计分、结算
```

**没有服务端参与，也没有对应 API** —— `app/api/` 下只有房间（duel）与 AI 出题两类路由。
「同一份代码」靠的是 `lib/engine/*` 同时被客户端与服务端 import（duel 服务端抽题用的就是 `buildDailySet`）。

因此：

- 可以部署到任意 Serverless / 静态托管；
- 同一天同领域组合 → 全网同一份题（天然可比、可分享）；
- 客户端本地计时只用于**显示**。每日挑战没有排行榜、不做服务端结算，
  所以「改本地时间刷分」没有收益。**duel 才是服务端权威计时。**

---

## 3. 对战房间状态机

### 3.1 相位

```
lobby → countdown → question → feedback → (下一回合) → finished
```

推进采用「**惰性 + 定时器**」双保险：

- `syncRoomPhase()` 在**读快照 / 提交答案 / 定时器回调**三处调用；
- Serverless 定时器丢失时，靠下一次调用收敛。

> 改相位机时**别只依赖定时器**。

### 3.2 房间态与对外态

| 类型 | key | 用途 |
|---|---|---|
| `RoomState` | `playerId` | 服务端内部态（**含凭证**），定义在 `types/index.ts` |
| `RoomStateInternal` | `playerId` | `lib/store/room.ts` 里的实际存储形态：`RoomState` 同构 + 相位计时器引用（**不对外导出**） |
| `RoomSnapshot` | `slot` | 对外态（**脱敏**） |
| `RoundRecord` | `slot` | 对外态 |

`RoomState.questions` 只存 `QuestionMeta`（无答案、无解析），
答案与解析在回合结算（`round_result`）时才下发。

### 3.3 存储位置

房间态在**进程内存**（`lib/store/room.ts`，`globalThis` 单例）。

> ⚠️ **duel 不能上 Serverless** —— 多实例内存不共享，房间状态会撕裂。
> 必须走本地隧道（`play-online.bat`）。

### 3.4 过期回收

房间按 `lastActivity` 判定过期并清理；订阅者按 `STREAM_MAX_AGE_MS` 判定僵尸并回收。

### 3.5 对战结算落本地档案

对局结束后，客户端把**服务端权威快照**转换成一份本地结算计划
（`lib/engine/duel-settlement.ts`）：

- `RoundRecord.correct[slot]` 决定每个回合本人是否答对；
- `PublicPlayer.maxCombo` 提供本场最高连击；
- `RoomSnapshot.matchId = 房间码 + ":" + seed` 标记「哪一场」。

只处理**本人实际作答过**的回合（`elapsed[slot] != null`）——被对手抢先 / 未作答的题
既不刷熟练度，也不进错题本。写入项只有 `history`（`mode: "duel"` + `roomCode`）、
熟练度与错题本；**不写** streak、lifetime/段位、影子、每日 session。

去重分两层：页面内用 ref 防同一快照重复触发，跨刷新用 localStorage 的
`duelSettled.<房间码>` 记住 `matchId`。rematch 换 seed → 换 `matchId` → 才会再次结算。

> 这是纯客户端落盘，不改变服务端权威：服务端不保存任何玩家的本地档案。

---

## 4. SSE 实时通道

| 机制 | 参数 | 不做会怎样 |
|---|---|---|
| 心跳 ping | 25s | 中间代理掐断连接 |
| 主动轮换 rotate | 100s | 平台 120s 硬杀 → `cancel()` 不触发 → 僵尸订阅占满配额 → **重连永远 429** |
| 僵尸回收 | 130s 判超龄 | 同上 |

`edgeone.json` 的 `nodeFunctionsConfig.maxDuration = 120` **必须保留**（CI 会检查）。
它与 `STREAM_MAX_AGE_MS = 100_000` 配套：服务端在平台硬杀前 20s 主动优雅关闭，
把「平台硬杀」变成「清理必然执行」。

### 4.1 帧格式

```
event: <type>
data: <json>

```

业务事件的 `event` 名与 `type` 一致；`rotate` 是**独立**事件名（不进入 `RoomEvent` 联合类型），
用于通知客户端立即静默重连；心跳是注释行 `: ping`，客户端不触发 `message`。

实现：`lib/events.ts` · `lib/realtime.ts`

### 4.2 订阅表

`lib/realtime.ts` 用 `globalThis` 单例存订阅表。
**Serverless 多实例不共享** —— 这也是 duel 只能本地跑的原因之一。

### 4.3 客户端不能把「相位」押在事件上

轮换 / 断线重连的间隙里会**漏事件**：`rotate` 后新连接的第一帧是 `state`，
中间的 `round_start` 不会补发。所以任何"进入下一回合就该重置"的本地态，
必须以**快照里的 `roundIndex`** 为准，而不是只监听事件 ——
`app/duel/room/[code]/page.tsx` 里那段 `seenRoundRef` 效果就是这条规则的落地：
只按 `round_start` 重置过一次踩坑（答完第 1 题后选项永久停在禁用态，第 2–5 题再也答不了）。

相位本身仍然权威在服务端：`syncRoomPhase()` 的惰性收敛保证即使事件全丢，
下一次读快照也会拿到正确的 `status` / `roundIndex` / `deadlineAt`。

---

## 5. 凭证与安全

| 机制 | 说明 |
|---|---|
| `playerId` | 所有写操作的唯一凭证，只在创建/加入的**私有响应**下发 |
| `slot` | 对外一律用座位号（`0`=房主，`1`=访客），绝不暴露 `playerId` |
| Zod 剥离 | 提交体中的未知字段被剥离，客户端伪造 `elapsed` 无效 |
| 昵称白名单 | `^[\u4e00-\u9fa5A-Za-z0-9_·\- ]+$`，1–12 字符 |
| 房间码 | 生成固定 **6 位**，字符集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（排除 `I/L/O/0/1`）；入参正则 `^[A-HJ-NP-Z2-9]{4,8}$`（未排除 `L`） |
| 限流 | `lib/rate-limit.ts` |

> 一旦 `playerId` 泄漏进快照或广播，任何订阅者（含第三方观战者）都能冒充该玩家
> 提交答案、认输、发起再来一局。

---

## 6. 内容管线

```
content/domains/<id>.json  （磁盘紧凑格式）
        │  lib/content/loader.ts 注入 domain / origin / fingerprint
        ▼
Question[]  （运行时完整格式）
```

**磁盘上不存** `domain` / `origin` / `fingerprint` 三个字段 ——
这样「改了题干忘了更新指纹」这类脏数据**整类消失**。

指纹：题干归一化（**先**全角转半角、英文小写，**再**去空白与标点）后 FNV-1a 32 位哈希，输出 8 位十六进制。

实现：`lib/content/fingerprint.ts` · `lib/content/loader.ts`

---

## 7. AI 出题

```
provider（OpenAI 兼容 / Ollama）→ prompt → 10 步校验链 → 待审池
```

**10 步**：JSON → schema → domain/topic → 难度 → 答案命中选项 → 歧义句式 →
解析长度 → 指纹查重 → 近似查重（Jaccard > 0.85）→ 敏感词。

- 未配置 provider → **503**，主链路完全不受影响；
- 设置 `AI_ADMIN_TOKEN` 时校验 `x-ai-admin-token`；未设置时仅 `NODE_ENV=development` 可调；
- **AI 题永不参与每日挑战**（破坏确定性与排行榜公平）。

---

## 8. 部署形态（双轨）

| 轨道 | 承载 | 平台 | 状态性 |
|---|---|---|---|
| **云轨** | 每日挑战、错题本、星图、战绩、影子、段位 | EdgeOne Pages（Node Functions） | 完全无状态 |
| **本地轨** | 同步抢答 duel | `play-online.bat` + cloudflared 隧道 | 房间态在进程内存 |

详见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

---

## 9. 已知限制

| # | 限制 | 说明 |
|---|---|---|
| 1 | **duel 不能上 Serverless** | 房间态在进程内存，多实例不共享 → 状态撕裂。必须走本地隧道。 |
| 2 | **EdgeOne Node Functions 120s 硬上限** | SSE 必须主动轮换（100s）后再优雅关闭。 |
| 3 | **Edge Functions（V8）不支持 WebSocket** | 本项目实时用 SSE；Edge Functions 的 CPU 限 200ms、KV 最终一致性 ≤60s，都不适合实时。 |
| 4 | **AI 出题接口默认关闭** | 需配 provider + `AI_ADMIN_TOKEN`，否则 503。 |
| 5 | **题库深度** | 每域 40–53 题，每日挑战（5 题/天）在单域上会重复。引擎会兜底重复而非空面。 |
| 6 | **无账号体系** | 档案/错题/战绩/影子/段位全在 localStorage，换浏览器即丢；清缓存即丢。 |
| 7 | **npm 12 会拦 `esbuild` / `unrs-resolver` 的 install scripts** | 已实测 `tsx` 与 `node --import tsx --test` 正常工作，不影响工具链。 |
| 8 | **（已迁出：本机删除工具边界）** | 原先这里是「`rm` 只到会话 workspace 内 / 外部目标改走回收站启动器」。它讲的是**我这台机器的 shell 行为**，不是《通识局》的架构限制，2026-10-20 移到仓库外的个人笔记。空壳保留是为了不打乱本表行号。 |
| 9 | **（已迁出：目录清点方式）** | 原先这里是「`Get-ChildItem -Recurse -File` 看不到空目录」。同上，属本机工具而非本项目，已一并移出。 |
| 10 | **无跨设备同步** | 影子对手、段位都是**本地**的 —— 换设备就没有了。这是"零服务端成本"的代价，也是有意的取舍。 |
