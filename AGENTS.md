# AGENTS.md —— 《通识局》AI 协作指南

> **本文只放 AI 必读的东西**：不可破坏的红线、技术栈、极简命令、文档索引。
> **业务逻辑、计分规则、题库规范、API 细节全部在 `docs/`** —— 不要往本文塞。
> 人类请看 [`README.md`](README.md)。

**项目**：《通识局》/ `tongshi-ju` —— 12 域通识知识闯关 + 好友同步抢答对战
**目录**：`F:/other/code/ai/tongshi-ju`

---

## 1. 技术栈

Next.js 14 (App Router) · React 18 · TypeScript 5.5 · Tailwind 3 · SSE
依赖**仅限** `zod` / `nanoid` / `lucide-react`（`react` / `react-dom` / `next` 是框架自带）。
状态一律用 React 自身 + localStorage，**没有状态库** —— `zustand` 曾因"列在允许清单里"而被装着但零引用，已移除。

---

## 2. 四条红线

> 违反任何一条都会破坏产品本身，不是"风格问题"。

### 2.1 每日挑战必须无状态

题集 = `f(daySeed, domains, count)`，**纯函数**（`lib/engine/daily.ts`），客户端与服务端跑**同一份代码**。

这是双轨部署的支点：Serverless 多实例内存不共享，只有每日挑战无状态，云轨才能随便扩容。
**任何把每日挑战改成「服务端存当天题集」的做法都会直接破坏它。**

> 改 `lib/engine/daily.ts` 前必须确认：客户端与服务端仍然得到**逐题相同**的结果。

### 2.2 服务端权威

计时、答案判定、回合推进、胜负判定**一律在服务端**。
客户端**只提交答案**，不上报用时；`elapsed` 由服务端按收到时刻计算；
提交体中的未知字段被 Zod 剥离，客户端伪造 `elapsed` 无效。

### 2.3 凭证纪律

`playerId` 是所有写操作的唯一凭证，**绝不能出现在对外数据里**。

| 位置 | 允许出现 |
|---|---|
| 创建/加入房间的**私有响应** | `playerId` ✅ |
| `RoomSnapshot` / `RoundRecord` / SSE 广播 | **只有 slot**（`0`=房主，`1`=访客） |

`RoomState.questions` 同样只存 `QuestionMeta`（不含答案与解析），答案与解析在回合结算时才下发。

### 2.4 依赖克制

**PRNG、题库、计分、日期全部自实现**，不引入游戏 / 随机 / 日期库。
新增依赖需要先说明为什么现有能力做不到。

---

## 3. 目录速查

```
app/         页面与 API 路由（App Router）：/ · /daily · /domains · /pk · /duel · /map · /wrong · /wrong/practice · /history
components/  ui / domain / quiz / result
hooks/       useCountdown · useRoomStream · useDailyChallenge · usePkChallenge
lib/engine/  纯函数：prng · date · answer · scoring · daily · repetition · practice · rank · ghost · blindbox · pk · duel-settlement
lib/store/   房间状态机 · 常量 · 入参校验
lib/ai/      provider · prompt · 10 步校验链 · 去重
lib/content/ fingerprint · loader · server-bank · sensitive（内容安全词表）
content/domains/  12 域元数据 + 12 个题库 JSON
scripts/     validate-content.ts
__tests__/   单元测试（单星 glob，必须平铺）
e2e/         Playwright 浏览器冒烟（daily / pk / duel / 窄屏）
docs/        PRD · 架构 · 业务规则 · API · 内容 · 测试 · 设计 · 部署 · 团队 · 调研
```

---

## 4. 极简命令

```bash
npm install
npm run dev            # 本地开发 :3000
npm run dev:lan        # 监听 0.0.0.0（局域网联机调试）

npm run typecheck          # tsc --noEmit
npm test                   # node --import tsx --test __tests__/*.test.ts（纯函数层 + 服务端）
npm run test:e2e           # Playwright 浏览器冒烟（自己起 next dev -p 3100，跑完关闭）
npm run validate:content   # 题库校验（含内容安全词表）
npm run build              # next build（须在 dev / e2e 停下之后再跑，两者共用 .next）
npm run lint               # next lint
npm run format:check       # prettier --check .
```

联机对战：双击 `play-online.bat`（构建 → 启动 → cloudflared 隧道 → 复制公网链接）。

---

## 5. 改代码前必读

| 你要改什么 | 先读 |
|---|---|
| 计分 / 连击 / 星级 / 段位 / 影子 / 间隔重复 | [`docs/GAME-RULES.md`](docs/GAME-RULES.md) |
| 引擎 / 房间状态机 / SSE / 部署形态 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 路由 / 入参 / 错误码 / SSE 事件 | [`docs/API.md`](docs/API.md) |
| 题库格式 / 写作原则 / 校验链 | [`docs/CONTENT.md`](docs/CONTENT.md) |
| 测试约定 / 重置钩子 | [`docs/TESTING.md`](docs/TESTING.md) |
| 视觉 / token / 组件 / 文案 | [`docs/design/ui-system.md`](docs/design/ui-system.md) |
| 产品需求 / 玩法规则 / 验收标准 | [`docs/PRD.md`](docs/PRD.md) |
| 部署 / 联机隧道 / 双轨形态 | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| 团队角色 / 流水线 / 交付规范 | [`docs/TEAM.md`](docs/TEAM.md) |

---

## 6. 改动纪律

1. **先看现状再改** —— 读邻近文件，沿用既有命名与模式。
2. **共享逻辑改一侧要测两侧** —— `lib/engine/*` 是客户端与服务端共用的。
3. **新逻辑补单测** —— 断言写**不变量**，不写"应该等于我算出来的值"；不依赖毫秒精度与本机时间。
4. **有外部状态的模块**（`lib/realtime.ts`、`lib/store/room.ts`）用 `globalThis` 单例，
   测试里**必须**调用重置钩子（`__resetRoomsForTest()` / `__resetSubscribersForTest()`）。
5. **文档分层** —— 新增内容先判断它属于 `README.md`（人类）、`AGENTS.md`（AI）还是 `docs/`（长文）。
   `docs/` 下再分两类：**活文档**（PRD / 架构 / 规则 / API / 内容 / 测试 / 设计 / 部署 / 团队章程）
   与**带日期的一次性快照**（`docs/research/` 调研报告）。
6. **重大决策不单独建档** —— 决策的**结论**写进对应主题的活文档（玩法进 PRD、计分进 GAME-RULES、
   架构进 ARCHITECTURE、部署进 DEPLOYMENT），**理由**写在该文档的决策小节里。
   原始调研依据留在 `docs/research/`。**不要**为决策新建独立文档 —— 同一个事实有两个真相来源，
   迟早会打架。
