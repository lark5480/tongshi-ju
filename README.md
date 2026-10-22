<div align="center">

# 《通识局》

**12 域通识知识闯关 · 好友同步抢答对战**

每天 5 道题，检验你在 12 个知识领域上的常识库存；
再开一局**同步抢答**，和朋友当场比出高下。

`Next.js 14` · `React 18` · `TypeScript` · `Tailwind 3` · `SSE`

[![CI](https://github.com/lark5480/tongshi-ju/actions/workflows/ci.yml/badge.svg)](https://github.com/lark5480/tongshi-ju/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-informational)](LICENSE)

</div>

---

## 快速开始

需要 **Node.js >= 18.17** 与 npm。

**第 1 步 —— 装依赖**

```bash
npm install
```

**第 2 步 —— 起服务**

```bash
npm run dev
```

打开 <http://localhost:3000> 就能玩了。首次进入会让你选 1–3 个「本命领域」，
或者直接点「随缘开局」让系统当天替你决定。

**第 3 步 —— 每天回来**

每天 5 道题，3 分钟。答错的题进**错题本**，按间隔重复计时，连对 2 次才毕业；
到期的题可在错题本里独立复习，不计分、不刷段位。规则见
[`docs/GAME-RULES.md`](docs/GAME-RULES.md) §6。

### 和朋友联机（Windows）

双击 **`play-online.bat`**：脚本会构建、启动服务、建立 cloudflared 隧道，
并把公网链接复制到剪贴板。把链接发给朋友，两人在对战页输入同一个房间码即可。

> 联机通道使用独立的 `.next-online` 产物目录，**和你正在跑的 `npm run dev` 不冲突**。
> `cloudflared.exe` **不随仓库分发**：根目录有就优先使用，没有时会去 `PATH` 找；
> 缺失时从 [cloudflared 官方文档](https://developers.cloudflare.com/cloudflared/) 下载后放回根目录。
> 端口被占用时脚本会自动换一个空闲端口；局域网调试可用 `npm run dev:lan`。
> 部署与隧道细节见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

---

## 四个亮点

### 影子对手 —— 和昨天的自己同场竞速

不用注册、不用排行榜。同一组领域下，系统记住你过去的最好成绩，
答题时把它画成一条**金色目标线**。规则见
[`docs/GAME-RULES.md`](docs/GAME-RULES.md) §4。

### 通识段位 —— 六段可见的成长线

见习 → 入门 → 通识 → 博闻 → 渊博 → 睿哲。
段位由生涯累计算出，前期升得快、后期慢，约三个月到顶；门槛见
[`docs/GAME-RULES.md`](docs/GAME-RULES.md) §5。

### 盲盒轮转 —— 每天两个意料之外的领域

只固定 1 个本命，另外 2 个由日期决定、当天全网一致、明天换新。
三种模式（本命 / 盲盒轮转 / 随缘开局）在选域页切换。规则见
[`docs/PRD.md`](docs/PRD.md) §4.3。

### 同题 PK —— 同一个码，同一份题

两个人输入同一个 4–6 位 PK 码，各自本地跑同一份纯函数，拿到完全相同的 5 道题；
最后用带 PK 码的成绩卡逐格对账。没有服务器撮合，没有账号注册。规则见
[`docs/PRD.md`](docs/PRD.md) §5.4。

---

## 12 个领域

游戏 / 动漫 / 科技 / 编程·算法 / 生活·柴米油盐 / 历史·文化 / 汽车 / 手机 / 电影·娱乐 / 科学·自然 / 语文·文学 / 地理·旅行。

500+ 道题，每道题都带**真解析**。题量与每域分布以 `npm run validate:content` 输出为准。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 产品定位、领域体系、玩法规则与验收标准、路线图 |
| [`docs/GAME-RULES.md`](docs/GAME-RULES.md) | 计分、连击、星级、段位、影子、间隔重复的公式与边界 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 引擎、房间状态机、SSE、已知限制 |
| [`docs/API.md`](docs/API.md) | 路由、入参、出参、错误码、SSE 事件 |
| [`docs/CONTENT.md`](docs/CONTENT.md) | 题库格式、写作原则、校验链、新增领域流程 |
| [`docs/TESTING.md`](docs/TESTING.md) | 测试约定、e2e 覆盖、常见陷阱 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 双轨部署手册与联机隧道 |
| [`docs/design/ui-system.md`](docs/design/ui-system.md) | 「星轨」视觉系统：token、组件、动效、文案 |
| [`AGENTS.md`](AGENTS.md) | AI 协作红线、技术栈、命令与文档路由 |

产品决策写在 PRD 对应章节；`docs/research/` 是带日期的一次性调研快照，只作时点证据。

---

## 状态

- 12 域全部上线；每日挑战、同题 PK、同步抢答 duel、错题复习、知识星图、战绩可用。
- 四个亮点玩法与「星轨」视觉系统已落地；AI 出题管线只进待审池。
- 单测、内容校验、构建与 Playwright 冒烟由 CI 守住，状态见顶部徽章。
- 待做：待审池运营界面、题库深度；排行榜已裁定不做（[`docs/PRD.md`](docs/PRD.md) §11.1），2v2 待裁决。

---

## 许可

MIT © [lark5480](https://github.com/lark5480) —— 正文见 [LICENSE](LICENSE)。
