# AGENTS.md —— 《通识局》开发指南

> **本文是活文档**，随代码演进持续更新。
> 产品需求见 [`docs/PRD.md`](docs/PRD.md)，部署手册见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)，
> 历史决策快照见 [`docs/decisions/`](docs/decisions/)（**不回改**）。

**项目**：《通识局》/ `tongshi-ju` —— 12 域通识知识闯关 + 好友同步抢答对战
**栈**：Next.js 14 (App Router) · React 18 · TypeScript 5.5 · Tailwind 3 · SSE
**目录**：`F:/other/code/ai/tongshi-ju`

---

## 0. 快速开始

```bash
npm install
npm run dev            # 本地开发 :3000
npm run dev:lan        # 监听 0.0.0.0（局域网联机调试用）

npm run typecheck      # tsc --noEmit
npm test               # node --import tsx --test __tests__/*.test.ts
npm run validate:content   # 题库校验（topic 白名单 / 答案 / 解析 / 指纹）
npm run build          # next build
npm run lint           # next lint
npm run format:check   # prettier --check .
```

联机对战：双击 **`play-online.bat`**（一键：构建 → 启动 → cloudflared 隧道 → 复制公网链接）。
参数：`play-online.ps1 -Rebuild`（改过代码强制重建）、`-Port 3000`（换端口）。

---

## 1. 目录地图

```
app/                     页面与 API 路由（App Router）
  api/rooms/…            房间 API：创建/快照/加入/准备/开局/答题/再来一局/SSE 流
  api/ai/generate/       AI 出题（管理入口）
  daily/ domains/ duel/ map/ wrong/ history/ page.tsx
components/              ui / domain / quiz / result
hooks/                   useCountdown / useRoomStream / useDailyChallenge
lib/
  engine/                prng · date · answer · scoring · daily · repetition  ← 纯函数，客户端与服务端共用
  store/                 room 状态机 · constants · validate（Zod 入参）
  ai/                    provider · prompt · validate（10 步校验链）· dedupe
  content/               fingerprint（归一化+哈希+分词）· loader · server-bank
  realtime.ts            SSE 订阅表（globalThis 单例）
  events.ts              SSE 帧编码 / 心跳 / 轮换
  rate-limit.ts  api/respond.ts  storage.ts
content/domains/         12 域元数据（index.ts + schema.ts）+ 12 个题库 JSON
scripts/validate-content.ts
__tests__/               16 个测试文件（单星 glob）
docs/                    PRD（活）· DEPLOYMENT · decisions/（归档）
```

---

## 2. 不可破坏的架构红线

### 2.1 每日挑战必须无状态

题集 = `f(daySeed, domains, count)`，**纯函数**（`lib/engine/daily.ts`）。
客户端与服务端跑**同一份代码**，因此同一天同领域 → 全网同题。

> 这不是「优化」，是**双轨部署的支点**：Serverless 多实例内存不共享，
> 只有把每日挑战做成无状态，云轨才能随便扩容。
> 任何把每日挑战改成「服务端存当天题集」的做法都会直接破坏它。

**改 `lib/engine/daily.ts` 前必须确认**：客户端与服务端仍然得到**逐题相同**的结果。
一旦两侧算法分叉，全网同题立刻失效。

### 2.2 服务端权威

计时、答案判定、回合推进、胜负判定**一律在服务端**。

- 客户端**只提交答案**，不上报用时；
- `elapsed` 由服务端按收到时刻自行计算；
- 提交体中的未知字段被 Zod **剥离**（`lib/store/validate.ts`），客户端伪造 `elapsed` 无效。

### 2.3 凭证纪律（安全红线）

`playerId` 是所有写操作的唯一凭证，**绝不能出现在对外数据里**。

| 位置 | 允许出现 |
|---|---|
| 创建/加入房间的**私有响应** | `playerId` ✅ |
| `RoomSnapshot` / `RoundRecord` / SSE 广播 | **只有 slot**（`0`=房主，`1`=访客） |

一旦 `playerId` 泄漏进快照或广播，任何订阅者（含第三方观战者）都能冒充该玩家提交答案、
认输、发起再来一局。

> `RoomState.questions` 同样只存 `QuestionMeta`（不含答案与解析），
> 答案与解析在回合结算时才下发。

### 2.4 答案用选项文本，不用字母

`answer` 存**选项文本**（`"《幽灵公主》"`）而非 `"A"`。
客户端可能对选项排序，字母会失效。

多选题答案入库时按**原始字符串字典序**排序，比较时按**归一化后**排序 —— 两套顺序分开，
因为归一化理论上会改变相对次序。

### 2.5 依赖克制

依赖仅限 `zod` / `zustand` / `nanoid` / `lucide-react`。
**PRNG、题库、计分、日期全部自实现**，不引入游戏 / 随机 / 日期库。

---

## 3. 关键机制

### 3.1 种子与日期

```ts
daySeed  = hashSeed("daily:" + dateKey + ":" + canonicalDomains(domains).join(","))
dateKey  = "YYYY-MM-DD"  // Asia/Shanghai
```

日期口径是 **Asia/Shanghai**（`lib/engine/date.ts`），不是 UTC。
跨零点自动换题。修改时区口径会改变所有人的当日题目 —— 慎改。

> **领域是集合，不是列表。** `canonicalDomains()` 会先排序再参与种子计算与轮转，
> 因此用户 A 先点游戏再点动漫、用户 B 先点动漫再点游戏 —— 选的是同一组领域，
> 当天拿到的题**完全相同**。这是「全网同题」的前提，改动时不要把排序去掉。

`buildDailySet` 支持显式 `seed` 参数：duel 用**房间 seed**，
保证双方从同一 seed 派生同一份题序（双方看到的题必须完全一致）。

### 3.2 计分

见 `lib/engine/scoring.ts` 文件头公式。关键裁定：

- **跨域连击是纯正向激励**：只在跨域抢先答对时增长，同域不增不减；
- **对手抢先答对不算你失误** → 连击保持不变（这解掉了 plan 里两处冲突条目）；
- 答错 / 超时未答 → 归零。

### 3.3 SSE 三件套（缺一不可）

| 机制 | 参数 | 不做会怎样 |
|---|---|---|
| 心跳 ping | 25s | 中间代理掐断连接 |
| 主动轮换 rotate | 100s | 平台 120s 硬杀，`cancel()` 不触发 → 僵尸订阅占满配额 → **重连永远 429** |
| 僵尸回收 | 130s 判超龄 | 同上 |

`edgeone.json` 的 `nodeFunctionsConfig.maxDuration = 120` **必须保留**
（CI 会检查）。它与 `STREAM_MAX_AGE_MS = 100_000` 是配套的：
服务端在平台硬杀前 20s 主动优雅关闭，把「平台硬杀」变成「清理必然执行」。

### 3.4 相位推进：惰性 + 定时器 双保险

`syncRoomPhase()` 在**读快照 / 提交答案 / 定时器回调**三处调用。
Serverless 定时器丢失也能靠下一次调用收敛。改相位机时别只依赖定时器。

### 3.5 配额判定顺序

提交答案的校验顺序是 **`already_answered` / `round_locked` → `not_answering`**，
超时判定前移到 `syncRoomPhase` 之前（超时提交返回 408 `timeout`，而不是误报 `not_answering`）。

---

## 4. 内容维护

### 4.1 加题

编辑 `content/domains/<id>.json`：

```json
{
  "domain": "gaming",
  "questions": [
    {
      "id": "gaming-0041",
      "topic": "经典作品",
      "difficulty": 2,
      "type": "single",
      "stem": "题干",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "至少 15 字的解析。"
    }
  ]
}
```

> **磁盘格式不存 `domain` / `origin` / `fingerprint` 三个字段** —— 加载时由
> `lib/content/loader.ts` 注入。这样「改了题干忘了更新指纹」这类脏数据整类消失。

必须满足（`npm run validate:content` 强制）：

- `topic` 命中该域白名单（见 `content/domains/index.ts`）；
- `answer` 必须在 `options` 里（多选为数组，全部命中）；
- `explanation` ≥ 10 字（校验链的「链内检查」阈值是 15 字）；
- 题干指纹在库内唯一；
- `judge` 题的 `options` 固定为 `["正确", "错误"]`。

### 4.2 上线一个新领域

1. 在 `content/domains/index.ts` 里把该域的 `enabled` 置 `true`；
2. 补齐 `content/domains/<id>.json`（≥40 题为佳）；
3. `npm run validate:content` 必须 0 错误；
4. **不需要改任何代码** —— 选域页、随缘开局、题库加载、校验脚本全部按 12 域写好。

### 4.3 选题原则

- **解析是产品的知识密度来源**，不要写「答案是 B」这种废话；
- 题干避免歧义句式（`以上都对` / `以下哪个不是` / `下列说法正确的是`）——
  校验链会直接拒收；
- 跨域条目要干净：生活域的题不要偷偷考历史。

---

## 5. AI 管线

`POST /api/ai/generate` —— 管理入口。

- 未配置 `AI_API_BASE` / `AI_API_KEY` / `AI_MODEL` → 返回 503，主链路不受影响；
- 设置 `AI_ADMIN_TOKEN` 时校验 `x-ai-admin-token`；未设置时仅 `NODE_ENV=development` 可调；
- 通过 10 步校验链的题目只进**待审池**，不直接进正式题库；
- **AI 题永不参与每日挑战**（破坏确定性与排行榜公平）。

10 步校验链（`lib/ai/validate.ts`）：JSON → schema → domain/topic → 难度 → 答案命中选项 →
歧义句式 → 解析长度 → 指纹查重 → 近似查重（Jaccard > 0.85）→ 敏感词。

> **查重要查「批次内」的重复**：每接受一题就立刻把它的指纹与 token 索引登记进**可变副本**，
> 否则同一批次里的两道雷同题会双双通过。

---

## 6. 测试约定

- glob 用**单星** `__tests__/*.test.ts`。
  **双星 `**` 在 Linux CI 下会假绿灯**（shell 不展开 `**`，某些环境下匹配到零个文件却仍然退出 0）。
- 依赖外部状态的模块用 `globalThis` 单例（`lib/realtime.ts`、`lib/store/room.ts`），
  因此**必须提供并调用测试重置钩子**：
  - `__resetRoomsForTest()`（房间态）
  - `__resetSubscribersForTest()`（订阅表）
  不重置就会跨用例泄漏，配额与回收断言会变成时序赌博。
- 时间相关断言**不要依赖毫秒精度**。`reclaimZombies` 的超龄判定用 `>=`，
  传 `staleMs = 0` 即可让全部订阅判为超龄。
- 当前规模：**171 tests / 16 个文件**。

---

## 7. 已知限制与坑

| # | 限制 | 说明 |
|---|---|---|
| 1 | **duel 不能上 Serverless** | 房间态在进程内存，多实例不共享 → 状态撕裂。必须走本地隧道。 |
| 2 | **EdgeOne Node Functions 120s 硬上限** | SSE 必须主动轮换（100s）后再优雅关闭，否则连接会被平台硬杀。 |
| 3 | **Edge Functions（V8）不支持 WebSocket** | 本项目实时用 SSE；Edge Functions 的 CPU 限 200ms、KV 最终一致性 ≤60s，都不适合实时。 |
| 4 | **AI 出题接口默认关闭** | 需配 provider + `AI_ADMIN_TOKEN`，否则 503。 |
| 5 | **题库量少** | 首发 260 题，题量少的域在每日挑战里可能重复出题（引擎会兜底重复而非空面）。 |
| 6 | **无账号体系** | 档案/错题/战绩全在 localStorage，换浏览器即丢；清缓存即丢。 |
| 7 | **npm 12 会拦 `esbuild` / `unrs-resolver` 的 install scripts** | 已实测 `tsx` 与 `node --import tsx --test` 正常工作，不影响工具链。 |
| 8 | **删除受会话 workspace 边界限制** | `rm --` 只允许删**会话 workspace 内**的目标；目标在外部（本项目位于 `F:\other\code\ai\`，通常不等于会话 workspace）时 `rm` 会被拒。改用**同一个受信任启动器**：`& "$env:USERPROFILE\.minimax\bin\mavis-trash.cmd" -- "<target>"`（进 Windows 回收站，可恢复）。**绝不要**改用 `Remove-Item -Recurse -Force` / `rmdir /s` 之类的永久删除。 |
| 9 | **删目录前要连空目录一起清点** | `Get-ChildItem -Recurse -File` **看不到空目录**。清点用 `-Force` 且不限定 `-File`，否则会漏判「这个项目到底有没有代码」——`math-physics-quest` 就是靠这个才发现 4 个空目录。 |

---

## 8. 文档地图

| 文档 | 性质 | 内容 |
|---|---|---|
| [`docs/PRD.md`](docs/PRD.md) | **活** | 产品需求：12 域体系、三条产品线、计分与连击规则、页面清单、路线图 |
| [`AGENTS.md`](AGENTS.md) | **活** | 本文：架构红线、机制细节、内容维护、测试约定、已知限制 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **活** | 双轨部署手册：EdgeOne Pages 云轨 + 本地隧道本地轨 |
| [`docs/decisions/2026-10-20-original-prd.md`](docs/decisions/2026-10-20-original-prd.md) | **归档** | 旧 `math-physics-quest` PRD 快照，不回改 |
| [`docs/decisions/2026-10-20-product-decisions.md`](docs/decisions/2026-10-20-product-decisions.md) | **归档** | 四项产品决策（改名 / 12 域 / 同步抢答 / 双轨）快照，不回改 |
| [`docs/decisions/2026-10-20-retire-original-project.md`](docs/decisions/2026-10-20-retire-original-project.md) | **归档** | 旧项目 `math-physics-quest` 退役并删除的决策快照，不回改 |
| [`README.md`](README.md) | **活** | 面向人的快速上手 |

**文档分层原则**：`docs/PRD.md` 与 `AGENTS.md` 是**活文档**（持续更新）；
`docs/decisions/*.md` 是**归档快照**（记录当时的决定与理由，**不回改**）。
新增重大决策时，往 `docs/decisions/` 加一份带日期的快照，而不是改旧文件。
