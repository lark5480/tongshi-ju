# 《通识局》API 文档

> 全部 HTTP 入口在 `app/api/`。响应工具在 `lib/api/respond.ts`。
> 房间状态机语义见 [`ARCHITECTURE.md`](ARCHITECTURE.md)；业务规则见 [`GAME-RULES.md`](GAME-RULES.md)。

---

## 0. 通用约定

### 0.1 响应格式

**成功**：

```json
{ "...": "业务数据" }
```

**失败**：

```json
{ "error": "人类可读的中文错误信息", "code": "machine_readable_code" }
```

- HTTP 状态码与 `code` **同时**给出，客户端优先按 `code` 分支，界面按 `error` 展示。
- 所有写接口的入参用 Zod 校验（`lib/store/validate.ts`），未知字段被**剥离**（不报错，但也不生效）。

### 0.2 房间码

- 4–8 位大写字母数字，**排除易混字符** `I / O / 0 / 1`（正则 `^[A-HJ-NP-Z2-9]{4,8}$`）。
- 入参的房间码会被 `toUpperCase()` 归一，服务端比较前同样归一。

### 0.3 凭证（`playerId`）

- `playerId` 是**所有写操作的唯一凭证**。
- 只在**创建 / 加入房间的私有响应**中下发给本人。
- 快照与 SSE 广播里**绝不出现** `playerId`，对外一律用 `slot`（`0` = 房主，`1` = 访客）。
- 客户端必须把 `playerId` 按房间码分别存在 localStorage（`lib/storage.ts` 的 `getRoomPlayerId`），
  **绝不能**从快照里取。

### 0.4 错误码总表

| `code` | HTTP | 含义 |
|---|---|---|
| `invalid_input` | 400 | 入参不合法（Zod 校验失败） |
| `not_a_player` | 403 | `playerId` 不属于该房间 |
| `not_host` | 403 | 该操作只有房主能做 |
| `room_not_found` | 404 | 房间不存在或已结束 |
| `room_started` | 409 | 对局已开始，不能再加入/开局 |
| `room_full` | 409 | 房间已满 |
| `not_enough_players` | 409 | 不足两人 |
| `not_all_ready` | 409 | 双方未全部准备 |
| `not_finished` | 409 | 对局尚未结束 |
| `already_answered` | 409 | 本题已经作答过 |
| `round_locked` | 409 | 本回合已被别人抢先锁定 |
| `not_answering` | 409 | 当前不是答题阶段 |
| `stale_round` | 409 | 题目已切换（提交的 `roundIndex` 过期） |
| `bad_state` | 409 | 回合状态异常 |
| `timeout` | 408 | 答题时间已到 |
| `bad_question` | 500 | 题目异常（服务端数据问题） |
| `room_limit` | 503 | 服务器房间数已达上限 |
| `no_domain` | 503 | 暂时没有可用的题库领域 |
| `empty_bank` | 503 | 题库暂不可用 |
| `internal_error` | 500 | 服务器内部错误 |

---

## 1. 路由总表

| 方法 | 路径 | 作用 | 认证 |
|---|---|---|---|
| `POST` | `/api/rooms` | 创建房间 | 无 |
| `GET` | `/api/rooms/[code]` | 读房间快照 | 无 |
| `POST` | `/api/rooms/[code]/join` | 加入房间 | 无 |
| `GET` | `/api/rooms/[code]/join` | 轮询房间是否存在（加入前的探测） | 无 |
| `POST` | `/api/rooms/[code]/ready` | 准备 / 取消准备 | `playerId` |
| `POST` | `/api/rooms/[code]/start` | 房主开局 | `playerId` |
| `POST` | `/api/rooms/[code]/answer` | 提交本题答案 | `playerId` |
| `POST` | `/api/rooms/[code]/rematch` | 房主发起再来一局 | `playerId` |
| `GET` | `/api/rooms/[code]/stream` | SSE 实时事件流 | 无（只读对外态） |
| `POST` | `/api/ai/generate` | AI 出题（管理入口） | `x-ai-admin-token` |

---

## 2. 房间

### 2.1 `POST /api/rooms` —— 创建房间

**入参**

```json
{ "name": "小明", "emoji": "🦊", "domains": ["gaming", "anime"] }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `name` | string | 1–12 字符，`^[\u4e00-\u9fa5A-Za-z0-9_·\- ]+$` |
| `emoji` | string | 1–8 字符的单个 emoji |
| `domains` | string[] | 可选，默认 `[]`；0–3 个合法领域 id，自动去重 |

**出参（201）** —— `RoomCredential` + 快照

```json
{
  "code": "K7QM",
  "playerId": "…",
  "slot": 0,
  "isHost": true,
  "room": { "...": "RoomSnapshot" }
}
```

> `playerId` **只在这里**出现。

**错误**：`invalid_input` / `room_limit` / `no_domain` / `empty_bank`

---

### 2.2 `GET /api/rooms/[code]` —— 房间快照

**入参**：路径参数 `code`（自动转大写）。

**出参（200）**：`RoomSnapshot`

```jsonc
{
  "code": "K7QM",
  "hostSlot": 0,
  "status": "lobby",          // lobby | countdown | question | feedback | finished
  "domains": ["gaming", "anime"],
  "roundIndex": 0,
  "questions": [ /* QuestionMeta[] —— 只有元数据，没有答案与解析 */ ],
  "startedAt": null,          // 当前题开始的**服务端**时间戳
  "deadlineAt": null,         // 当前题截止的服务端时间戳
  "limitMs": 30000,
  "nextAt": null,
  "lockedWinnerSlot": null,
  "scores": { "0": 0, "1": 0 },
  "combos": { "0": 0, "1": 0 },
  "players": [ /* PublicPlayer[]，按 slot 顺序 */ ],
  "history": [ /* RoundRecord[] */ ],
  "serverNow": 1792462600000, // 供客户端校准时钟偏移
  "totalRounds": 5
}
```

**错误**：`room_not_found`

---

### 2.3 `POST /api/rooms/[code]/join` —— 加入房间

**入参**

```json
{ "name": "小红", "emoji": "🐱", "code": "K7QM" }
```

`code` 会被转大写并按房间码正则校验。

**出参（200）**：`RoomCredential` + 快照（同 §2.1 结构，`slot: 1`、`isHost: false`）。

**错误**：`invalid_input` / `room_not_found` / `room_started` / `room_full`

---

### 2.4 `GET /api/rooms/[code]/join` —— 探测房间

**入参**：路径参数 `code`。

**出参（200）**：`{ "exists": true, "started": false, "full": false }`

用于「输入房间码」页面的即时反馈。

**错误**：`room_not_found`

---

### 2.5 `POST /api/rooms/[code]/ready` —— 准备 / 取消准备

**入参**

```json
{ "playerId": "…", "ready": true }
```

**出参（200）**：`RoomSnapshot`

**错误**：`invalid_input` / `not_a_player` / `room_not_found` / `room_started`

---

### 2.6 `POST /api/rooms/[code]/start` —— 房主开局

**入参**

```json
{ "playerId": "…" }
```

**出参（200）**：`RoomSnapshot`（`status` 进入 `countdown`）

**前置条件**：房主、双方已加入、双方已准备。

**错误**：`invalid_input` / `not_a_player` / `not_host` / `room_not_found` /
`room_started` / `not_enough_players` / `not_all_ready` / `no_domain` / `empty_bank`

---

### 2.7 `POST /api/rooms/[code]/answer` —— 提交答案

**入参**

```json
{ "playerId": "…", "roundIndex": 2, "answer": "选项文本" }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `playerId` | string | 必填，非空 |
| `roundIndex` | number | 整数 ≥ 0，必须等于当前回合 |
| `answer` | string \| string[] | 单选/判断为字符串；多选为字符串数组（≥1 项） |

> **客户端绝不上报用时。** 提交体里的 `elapsed` 会被 Zod 剥离（`answerSchema` 是 `z.object` 严格白名单）。
> 服务端按**收到时刻**自行计算 `elapsed`。

**出参（200）**

```json
{
  "correct": true,
  "points": 24,
  "elapsed": 8421,
  "scores": { "0": 60, "1": 20 },
  "combos": { "0": 2, "1": 0 }
}
```

**校验顺序（重要）**

```
already_answered / round_locked  →  not_answering
```

超时判定前移到 `syncRoomPhase()` **之前** —— 超时提交返回 **408 `timeout`**，
而不是误报 `not_answering`。

**错误**：`invalid_input` / `not_a_player` / `room_not_found` / `timeout`(408) /
`already_answered` / `round_locked` / `not_answering` / `stale_round` / `bad_state` / `bad_question`

---

### 2.8 `POST /api/rooms/[code]/rematch` —— 再来一局

**入参**

```json
{ "playerId": "…" }
```

**出参（200）**：`RoomSnapshot`（重置比分、连击、回合，回到 `lobby`）

**错误**：`invalid_input` / `not_a_player` / `not_host` / `room_not_found` / `not_finished`

---

## 3. SSE —— `GET /api/rooms/[code]/stream`

**响应头**

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

**帧格式**

```
event: <type>
data: <json>

```

### 3.1 业务事件（`event` 名 == `type`）

| `type` | `data` 载荷 | 触发时机 |
|---|---|---|
| `state` | `{ room: RoomSnapshot }` | 任何房间状态变化（房态、比分、连击、准备状态） |
| `countdown` | `{ roundIndex, nextAt }` | 进入下一回合前的倒计时 |
| `round_start` | `{ roundIndex, question: QuestionMeta, startedAt, deadlineAt }` | 答题阶段开始 |
| `player_answered` | `{ roundIndex, playerSlot }` | 某位玩家提交了答案（**不泄露是否正确**） |
| `round_locked` | `{ roundIndex, winnerSlot }` | 本回合赢家已锁定 |
| `round_result` | `{ record: RoundRecord, scores }` | 回合结算，**此时才下发答案与解析** |
| `duel_end` | `{ scores, reason }` | 对局结束 |

> `player_answered` 只广播「谁答了」，**不广播对错** —— 否则就变成了互相剧透。

### 3.2 控制帧

| `event` | 载荷 | 用途 |
|---|---|---|
| `rotate` | `{}` | 服务端主动轮换连接前通知客户端**立即静默重连** |
| （注释行） | `: ping` | 心跳。25s 一次，客户端不会触发 `message` 事件 |

### 3.3 连接生命周期

| 机制 | 参数 | 不做会怎样 |
|---|---|---|
| 心跳 ping | 25s | 中间代理掐断连接 |
| 主动轮换 | 100s | 平台 120s 硬杀 → `cancel()` 不触发 → 僵尸订阅占满配额 → **重连永远 429** |
| 僵尸回收 | 130s 判超龄 | 同上 |

> `edgeone.json` 的 `nodeFunctionsConfig.maxDuration = 120` 必须保留（CI 会检查）。
> 它与 `STREAM_MAX_AGE_MS = 100_000` 配套：服务端在平台硬杀前 20s 主动优雅关闭。

### 3.4 配额

- 超出并发订阅上限时返回 **429**。
- 全部订阅槽位被占时返回 **503**（`服务器连接数已达上限`）。

---

## 4. AI 出题 —— `POST /api/ai/generate`

**鉴权**

- 设置了 `AI_ADMIN_TOKEN` 时，校验请求头 `x-ai-admin-token`；
- 未设置时**仅 `NODE_ENV=development` 可调用**；
- 未配置 `AI_API_BASE` / `AI_API_KEY` / `AI_MODEL` → 返回 **503**，主链路不受影响。

**入参**

```json
{ "domain": "gaming", "topic": "经典作品", "difficulty": 2, "count": 5, "variantOf": { "questionId": "gaming-0007", "stem": "…", "answer": "…" } }
```

`variantOf` 可选 —— 传入时按原题生成「同知识点不同问法」的变体题。

**出参（200）**

```json
{ "status": "pending", "questions": [ /* 待审池条目 */ ] }
```

**通过 10 步校验链**的题目**只进待审池**，不直接进正式题库；
**AI 题永不参与每日挑战**（破坏确定性与排行榜公平）。

校验链顺序：JSON → schema → domain/topic → 难度 → 答案命中选项 → 歧义句式 →
解析长度 → 指纹查重 → 近似查重（Jaccard > 0.85）→ 敏感词。

> **查重要查「批次内」的重复**：每接受一题就立刻把它的指纹与 token 索引登记进**可变副本**，
> 否则同一批次里的两道雷同题会双双通过。

---

## 5. 客户端调用注意

1. **先建/加入拿 `playerId`，再做任何写操作**；
2. `playerId` 按房间码分别存 localStorage，**绝不从快照取**；
3. 写操作之间用 `roomCode` 区分，不要用一个全局凭证；
4. SSE 收到 `rotate` 事件时**立即静默重连**（不要弹提示）；
5. 收到 `round_result` 才渲染答案与解析。
