<div align="center">

# 《通识局》

**12 域通识知识闯关 · 好友同步抢答对战**

每天 5 道题，检验你在游戏 / 动漫 / 科技 / 编程 / 生活 / 历史 / 汽车 / 手机 / 电影 / 科学 / 语文 / 地理 上的常识库存；
再开一局**同步抢答**，和朋友当场比出高下。

`Next.js 14` · `React 18` · `TypeScript` · `Tailwind CSS` · `SSE` · `EdgeOne Pages`

</div>

---

## 亮点

- **每天的题全网一样** —— 题集是纯函数 `f(daySeed, domains, count)`，同一天同领域组合下全球完全一致，结果天然可比。
- **每日挑战完全无状态** —— 不需要服务端存储，Serverless 想扩就扩。
- **同步抢答，服务端权威** —— 计时、判分、回合推进全在服务端；客户端伪造用时无效。
- **答错的题会回来找你** —— 间隔 `1/3/7/15/30` 天重现，连对 2 次才算「毕业」。
- **12 域一次建对** —— 后续补域**只加数据、不改代码**。
- **AI 出题但不上主线** —— 过 10 步校验链才进待审池，AI 题永不进每日挑战（保住公平）。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:3000
```

联机对战（与朋友开一局）：

```
双击 play-online.bat
```

脚本会自动构建 → 启动服务 → 建立 cloudflared 隧道 → 把公网链接复制到剪贴板。
详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 领域体系

| 批次 | 领域 | 状态 | 题量 |
|---|---|---|---|
| 一 | 游戏 | ✅ | 40 |
| 一 | 动漫 | ✅ | 40 |
| 一 | 科技 | ✅ | 40 |
| 一 | 编程·算法 | ✅ | 46 |
| 一 | 生活·柴米油盐 | ✅ | 41 |
| 一 | 历史·文化 | ✅ | 53 |
| 二 | 汽车 / 手机 / 电影·娱乐 / 科学·自然 | ⬜ 骨架已建 | 0 |
| 三 | 语文·文学 / 地理·旅行 | ⬜ 骨架已建 | 0 |

首发合计 **260 题**，全部带解析。补域只需编辑 `content/domains/<id>.json` 并把 `enabled` 置 `true`。

## 玩法

### 每日挑战

5 题，难度曲线 `1 → 1 → 2 → 2 → 3`，末位是**彩蛋题**（强制换域）。
限时随难度递减（30s / 25s / 20s）。

```
base   = { 难度1: 10, 难度2: 20, 难度3: 30 }
speed  = clamp(1 - elapsed / limit, 0, 1) * 0.5 + 0.5
blitz  = elapsed <= limit / 3 ? 1.2 : 1.0
points = round(base * speed * blitz * comboMultiplier)
```

星级：≥60% 满分 ★★★，≥35% ★★，其余 ★。每天完成即累计 **streak**，断签归零。

### 同步抢答 duel

双方看到**同一道题、同一倒计时**，每人每题**只有一次提交机会**：

- 答对且先于对手 → 独占该题分值；
- 答错 → 立即锁定 0 分；
- 跨域抢先答对 → **连击 +1**（倍率最高 ×1.2）；同域不增不减；
- **对手抢先答对不算你失误** —— 连击保持不变。

## 目录结构

```
app/          页面（daily/domains/duel/map/wrong/history）+ API 路由（rooms / ai）
components/   ui / domain / quiz / result
hooks/        useCountdown · useRoomStream · useDailyChallenge
lib/engine/   纯函数：prng · date · answer · scoring · daily · repetition
lib/store/    房间状态机 · 常量 · 入参校验
lib/ai/       provider · prompt · 10 步校验链 · 去重
content/      12 域元数据 + 12 个题库 JSON
__tests__/    171 个测试
docs/         PRD · DEPLOYMENT · decisions/
```

## 常用命令

```bash
npm run dev              # 开发服务器
npm run typecheck        # tsc --noEmit
npm test                 # 单元测试
npm run validate:content # 题库校验（topic 白名单 / 答案 / 解析 / 指纹）
npm run build            # 生产构建
npm run lint             # ESLint
npm run format:check     # Prettier
```

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 产品需求：领域体系、三条产品线、计分与连击规则、路线图 |
| [`AGENTS.md`](AGENTS.md) | 开发指南：架构红线、机制细节、内容维护、测试约定、已知限制 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 双轨部署手册（EdgeOne Pages 云轨 + 本地隧道本地轨） |
| [`docs/decisions/`](docs/decisions/) | 历史决策归档（快照，不回改） |

## 状态

```
✅ 12 域结构 · 首发 6 域 260 题 · 每日挑战 · 同步抢答 duel · 错题本 · 知识星图 · 战绩
✅ AI 出题管线（10 步校验链 + 待审池）· 171 tests 全绿 · CI 流水线
⬜ 批次二补题（汽车 / 手机 / 电影 / 科学）
⬜ 批次三补题（语文 / 地理）
⬜ 服务端排行榜 · 2v2 模式
```

## 许可

MIT
