# AGENTS.md —— 《通识局》AI 协作指南

> 本文只放 AI 必读的内容：不可破坏的红线、技术栈、日常命令、文档路由。
> 业务规则、计分、题库规范、API 细节一律在 `docs/`；人类请看 [`README.md`](README.md)。

**项目**：《通识局》/ `tongshi-ju` —— 12 域通识知识闯关 + 好友同步抢答对战
**远端**：`github.com/lark5480/tongshi-ju` —— MIT 许可，**公开仓库**

---

## 1. 技术栈

Next.js 14 (App Router) · React 18 · TypeScript 5.5 · Tailwind 3 · SSE
依赖**仅限** `zod` / `nanoid` / `lucide-react`（`react` / `react-dom` / `next` 是框架自带）。
状态一律用 React 自身 + localStorage，**没有状态库**。

---

## 2. 四条红线

> 违反任何一条都会破坏产品本身，不是"风格问题"。

### 2.1 每日挑战必须无状态

题集必须由「日期 + 领域集合」的纯函数确定（`lib/engine/daily.ts`），
客户端与 duel 服务端共用同一份实现；**不得**改成服务端保存当天题集。
**AI 题永不进入每日挑战。** 说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §2。

### 2.2 服务端权威（仅限 duel 房间）

同步抢答 duel 的计时、答案判定、回合推进、胜负判定**全在服务端**；
客户端只提交答案，不上报用时。每日挑战与同题 PK 是客户端本地确定性玩法，
没有服务端权威计时。细节见 [`docs/API.md`](docs/API.md) §2.7、
[`docs/GAME-RULES.md`](docs/GAME-RULES.md) §3。

### 2.3 凭证纪律（房间写操作）

`playerId` 是**房间内写操作**（准备 / 开局 / 答题 / 再来一局）的唯一凭证，**绝不能出现在对外数据里**。

| 位置 | 允许出现 |
|---|---|
| 创建/加入房间的**私有响应** | `playerId` ✅ |
| `RoomSnapshot` / `RoundRecord` / SSE 广播 | **只有 slot**（`0`=房主，`1`=访客） |

`RoomState.questions` 只存 `QuestionMeta`；答案与解析在回合结算时才下发。
细节见 [`docs/API.md`](docs/API.md) §0.3。

### 2.4 依赖克制

**PRNG、题库、计分、日期全部自实现**，不引入游戏 / 随机 / 日期库。
新增依赖需要先说明为什么现有能力做不到。

---

## 3. 目录速查

```
app/          页面 + API 路由（路由清单见 docs/PRD.md §6）
components/   ui / domain / quiz / result
hooks/        客户端状态编排
types/        共享类型（内部 Question / 对外 QuestionMeta、RoomSnapshot）
lib/engine/   纯函数（客户端与服务端共用，无 IO）
lib/store/    房间状态机 + 入参校验
lib/ai/       provider / prompt / 校验
lib/content/  指纹 / 题库加载 / 敏感词
content/domains/  12 域元数据 + 题库 JSON
__tests__/    单元测试；e2e/ Playwright 冒烟；scripts/ 内容校验
docs/         长文（索引见 §5）
```

---

## 4. 极简命令

```bash
npm install
npm run dev            # 本地开发 :3000（产物在 .next-dev）
npm run dev:lan        # 监听 0.0.0.0（局域网联机调试）

npm run typecheck
npm test
npm run test:e2e
npm run validate:content
npm run build
npm run lint && npm run format:check
```

产物目录由 `next.config.mjs` 隔离（`.next-dev` / `.next` / `.next-e2e` / `.next-online`），
**不要让 dev 与 build 共用目录**；联机通道见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §2。
完整脚本以 `package.json` 为准。

---

## 5. 改代码前必读

| 你要改什么 | 先读 |
|---|---|
| 计分 / 连击 / 星级 / 段位 / 影子 / 间隔重复 | [`docs/GAME-RULES.md`](docs/GAME-RULES.md) |
| 引擎 / 房间状态机 / SSE / 已知限制 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
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
2. **共享逻辑改一侧要测两侧** —— `lib/engine/*` 是客户端与服务端共用的，
   确保 daily / PK / duel 得到一致结果。
3. **新逻辑补单测** —— 测试约定见 [`docs/TESTING.md`](docs/TESTING.md) §2–4。
   改动 `hooks/**`、`components/quiz/**`、`app/{daily,pk,duel,wrong}/**` 需补/改 e2e（判据见 TESTING §5.4）。
4. **一个事实一个权威源** —— 决策结论写进对应主题的活文档，不单独建档；
   `docs/research/` 是带日期的一次性快照，只作时点证据，不回改。
5. **文档分层** —— 人类入口 `README.md`、AI 入口 `AGENTS.md`、长文与规则 `docs/`；
   改完跑 `npm run format:check` 与链接检查。

---

## 7. 仓库与流水线

**分支**：`dev` 是开发主干，`master` 是 GitHub 默认分支（发布口径）。
改动一律在 `dev` 上做 → 提 PR → 合入 `master`；**不直推 `master`**。

**CI**：push / PR 到 `master` / `main` / `dev` 均触发；
`verify`（静态检查 + 单测 + 构建）→ `e2e`（Playwright），
细节以 `.github/workflows/ci.yml` 为准。**CI 绿灯 = 可合并判据**。

**公开仓库纪律**：

- 仓库**已公开**，凭证、真实用户数据、内部地址一律不得入库。
  提交前用 `git ls-files` 自查 `.env`、构建产物（`.next*`）、`cloudflared.exe`、`*.tsbuildinfo`。
- `edgeone.json` 的 `maxDuration` 有 CI 卡口 —— **别删、别降**
  （值见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §1.1）。
- `vercel.json` 是**备选路径**；真要上 Vercel，超时三件套必须成套下调
  （见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §1.5）。
