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
│ lib/ai/         AI provider / prompt / 校验链            │
│ lib/content/    指纹 / 题库加载 / 服务端题库             │
│ lib/storage.ts  localStorage 安全封装（客户端）           │
├─────────────────────────────────────────────────────────┤
│ content/domains/  seed 题库（12 域）                     │
│ content/ai/       已人工审核入库的 AI 题池（按域）       │
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

**没有服务端参与，也没有对应的结算 API** —— `app/api/` 下的路由是房间（duel）、AI 出题、
NPC（点评 / 重要度 / 周报）与健康检查，均不参与每日抽题与计分。
「同一份代码」靠的是 `lib/engine/*` 同时被客户端与服务端 import（duel 服务端抽题用的就是 `buildDailySet`）。
`buildDailySet` 还会用「局种子 + 题目 id」派生独立 PRNG 打乱选项（`lib/engine/options.ts`），
同一题 + 同一 seed 在客户端 / 服务端 / PK 双方得到同一顺序。

因此：

- 可以部署到任意 Serverless / 静态托管；
- 同一天同领域组合 → 全网同一份题（天然可比、可分享）；
- 客户端本地计时只用于**显示**。每日挑战没有排行榜、不做服务端结算，
  所以「改本地时间刷分」没有收益。**duel 才是服务端权威计时。**

**4+1 分轨**：每日挑战呈现「4 题公共 + 1 题个人加练」。前 4 题由 `buildDailySet`
（`cycle` 调度、默认只取 `seed` 来源）确定并计分，全网同题；第 5 题由 `lib/npc/core/practice.ts`
按本人熟练度另选，**不计分、不计排名、可跳过**，无 NPC 事实时回落为公共第 5 题。
结算常量与纯函数（`PUBLIC_DAILY_COUNT` / `settlePublicAnswers`）在 `lib/engine/scoring.ts`，
口径版本 v1/v2 与同版本比较规则见 [`GAME-RULES.md`](GAME-RULES.md) §3.7。
NPC 只读引擎产出的数据、只影响第 5 题（红线见 [`../AGENTS.md`](../AGENTS.md) §2.5）。

### 2.1 抽题调度：`legacy` 与 `cycle`

`buildDailySet` 有两种调度。**每日挑战与 PK 用 `cycle`，duel 保持 `legacy`**：

| 调用方 | 调度 | 原因 |
|---|---|---|
| 每日挑战 | `cycle` | 同一领域集合下整池轮转，把「某题重复」从 2–8 天拉到约一个周期 |
| 同题 PK | `cycle` | 与每日共用同一份题序；传入显式 seed（日期 + 房间码），同码同日同题 |
| duel | `legacy` | 房间只有房间 seed + 空 `dateKey`，没有日期游标语义；5 回合又由 `TOTAL_ROUNDS` 截断，保持旧抽题行为 |

`cycle` 的做法：领域集合 → 稳定种子（**不含日期**）→ 整池按难度曲线排成确定性序列 →
按日期块推进游标。周期长度 = `floor(题池总数 / 题数)` 天，一个周期内每题只出现一次。

取舍：

- **先保不重复，再保难度曲线**。某一档难度在池里用尽后，按既有退化规则放宽到任意难度；
  代价是周期后段不再是严格的 `1,1,2,2,3`，换来的是整池过一遍才重复。
- 30 天窗口是**内容量上限**，不是算法承诺：3 域约 150 题时约 30 天；2 域 20–24 天；
  单域 49–66 题只有 9–13 天。单域要撑满 30 天大约需要 150 题。
- 盲盒 / 随缘**跨领域集合不保证**不重复：每次换集合，游标与题序都换了。
  这是有意取舍 —— 不引入本地「近 N 天已出题」记录，因为那会破「纯函数 + 无状态」红线。

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

写入范围以 [`GAME-RULES.md`](GAME-RULES.md) §11.3 为准：只写本人实际作答过的回合，
不写 streak / 段位 / 影子 / 每日 session。

去重分两层：页面内用 ref 防同一快照重复触发，跨刷新用 localStorage 的
`duelSettled.<房间码>` 记住 `matchId`。rematch 换 seed → 换 `matchId` → 才会再次结算。

> 这是纯客户端落盘，不改变服务端权威：服务端不保存任何玩家的本地档案。

---

## 4. SSE 实时通道

| 机制 | 参数 | 不做会怎样 |
|---|---|---|
| 心跳 ping | 25s | 中间代理掐断连接 |
| 主动轮换 rotate | 100s | 平台硬杀（上限见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §1.1）→ `cancel()` 不触发 → 僵尸订阅占满配额 → **重连永远 429** |
| 僵尸回收 | 130s 判超龄 | 同上 |

平台的函数硬上限见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §1.1。
服务端在硬杀前主动优雅关闭，把「平台硬杀」变成「清理必然执行」；
具体常量以 `lib/store/constants.ts` 为准。

**通道取道**：客户端用 `POST` 建流（`fetch` + `ReadableStream` 自己解析帧，见 `lib/sse.ts`），
不用 `EventSource` —— 它只能发 GET，而 Cloudflare Quick Tunnel 会**整段缓冲 GET 的流式响应**，
帧要攒到连接关闭才吐出，对战页面因此永远收不到实时事件。
GET 路径仍然保留（同一个 handler），实测判据见 [`API.md`](API.md) §3。

### 4.1 帧格式

```
event: <type>
data: <json>

```

业务事件的 `event` 名与 `type` 一致；`rotate` 是**独立**事件名（不进入 `RoomEvent` 联合类型），
用于通知客户端立即静默重连；心跳是注释行 `: ping`，解析时跳过、不产生帧（`lib/sse.ts`）。

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

`playerId` 只在创建 / 加入房间的私有响应中下发，对外一律用 `slot`；
房间码、昵称校验、限流与错误码见 [`API.md`](API.md) §0。
红线见 [`../AGENTS.md`](../AGENTS.md) §2.3。

---

## 6. 内容管线

```
content/domains/<id>.json  （seed，磁盘紧凑格式） ─┐
content/ai/<id>.json       （已审核 AI 题）        ─┤
                                                     │ loader 注入 domain / origin / fingerprint
                                                     ▼
                                              Question[]
                                                     │
                       buildDailySet(allowedOrigins)  ← 每日/duel 默认 ["seed"]；PK 显式 ["seed","ai"]
                                                     ▼
                                              当日题集 / PK 题集
```

- seed 与 AI 分目录存储，`origin` **加载时注入**（磁盘上不存）：见 [`CONTENT.md`](CONTENT.md) §1、§7。
- `domainBank` / `bankPool` / `findQuestion` 保持 **seed-only**（duel 与每日天然隔离）；
  `aiBank` 供 PK / 错题复习 / 第 5 题加练。
- `findAnyQuestion` 供脚本 / e2e 按 id 反查 seed + AI；不参与 duel 与每日抽题。
- 每日不变量：批准 AI 题**不得改变任何一天的每日题集**，由 `__tests__/engine.daily.test.ts` 钉住。
- PK 的「同码同题」以双方运行**同一构建**为前提；AI 题入库会改变 PK 题序，每日/duel 不受影响。

实现：`lib/content/fingerprint.ts` · `lib/content/loader.ts` · `lib/content/server-bank.ts`

---

## 7. AI 出题

```
provider（OpenAI 兼容 / Ollama）→ prompt → 10 步校验链
                                             │
                                             ▼
                               .ai-pending/<batchId>.json（本地）
                                             │ npm run ai:review approve --write
                                             ▼
                               content/ai/<domain>.json（人工审核后入库）
```

- 生成逻辑唯一入口：`lib/ai/generate.ts`（HTTP 路由与审核 CLI 共用）；
- 待审池是本地目录（已 gitignore），不存 Key / prompt；批准时重新查重，冲突不覆盖；
- API 写盘失败返回 `pendingPersisted: false`，生成结果仍可用；
- 校验链细节与内容侧流程见 [`CONTENT.md`](CONTENT.md) §8；
- 配置与鉴权见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §3、[`API.md`](API.md) §4；
- 未配置 provider → **503**，主链路完全不受影响；
- AI 题**不进每日/duel**，只进 PK / 错题复习 / 第 5 题加练；边界见 [`../AGENTS.md`](../AGENTS.md) §2.1。

---

## 8. 部署形态（双轨）

云轨承载每日挑战、错题本、星图、战绩、影子、段位等无状态玩法；
本地轨承载同步抢答 duel（房间态在进程内存）。

平台约束、部署步骤与隧道操作见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

---

## 9. 已知限制

| # | 限制 | 说明 |
|---|---|---|
| 1 | **duel 不能上 Serverless** | 房间态在进程内存，多实例不共享 → 状态撕裂。必须走本地隧道。 |
| 2 | **SSE 依赖主动轮换** | 平台函数硬上限见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §1.1；服务端必须在硬杀前优雅关闭，否则僵尸订阅会占满配额。 |
| 3 | **AI 出题接口默认关闭** | 需配 provider；生产环境还需 `AI_ADMIN_TOKEN`，否则 503。 |
| 4 | **题库深度决定重复窗口** | `cycle` 按整池轮转，窗口 = `floor(题池 / 5)` 天：3 域约 30 天，2 域 20–24 天，单域 9–12 天；单域补到约 150 题才够 30 天。窗口内先保不重复、后放宽难度曲线。盲盒/随缘换域跨集合不保证不重复（不引入本地近期记录，避免破无状态红线）。 |
| 5 | **无账号体系、无跨设备同步** | 档案 / 错题 / 战绩 / 影子 / 段位全在 localStorage，换浏览器或清缓存即丢；这是零服务端成本的取舍。 |
| 6 | **npm 12 会拦 `esbuild` / `unrs-resolver` 的 install scripts** | 已实测 `tsx` 与 `node --import tsx --test` 正常工作，不影响工具链。 |
| 7 | **发布后新旧题集可能并存一天** | 当日 `DailySession.questionIds` 已锁定的用户保留旧题集，新用户/无 session 用户走新调度；**接受新旧题混用一天，不强制刷新**。PK 同码同日仍同题，但旧标签页可能与新客户端算出不同题 —— 发布时统一提示刷新一次页面（见 [`DEPLOYMENT.md`](DEPLOYMENT.md) §1.2）。 |
| 8 | **AI 题与 PK 有版本依赖** | PK 是本地确定性玩法，同码同题以双方运行同一构建为前提；批准 AI 题会改变 PK 题序。每日/duel 只取 seed，不受影响。 |
