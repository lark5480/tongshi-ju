# 《通识局》部署手册

> **状态**：活文档。随部署形态变化更新。
> 架构说明见 [`../AGENTS.md`](../AGENTS.md)，产品需求见 [`PRD.md`](PRD.md)。

本项目采用**双轨部署**：

| 轨道 | 承载 | 平台 | 状态性 | 适合谁 |
|---|---|---|---|---|
| **云轨** | 每日挑战、错题本、知识星图、战绩 | EdgeOne Pages（Node Functions） | **完全无状态** | 想给所有人玩、想随时扩容 |
| **本地轨** | 同步抢答 duel | `play-online.bat` + cloudflared 隧道 | 房间态在**本机进程内存** | 想和朋友现场开一局 |

> **为什么 duel 不上 Serverless？**
> 房间状态（分数、连击、回合进度）在进程内存里，Serverless 多实例之间**不共享内存**。
> 同一个房间的两次请求落到不同实例，就会出现「分数丢了 / 回合错乱」。
> 每日挑战没有这个问题 —— 它被刻意设计成纯函数（题集 = f(daySeed, domains, count)），
> 客户端和服务端跑同一份代码，所以**云轨可以随便扩容**。

---

## 一、云轨：EdgeOne Pages（每日挑战）

### 1.1 平台约束（先读这个）

| 项 | 值 | 影响 |
|---|---|---|
| Node Functions 运行时上限 | **120s** | `edgeone.json` 的 `nodeFunctionsConfig.maxDuration = 120` **必须保留** |
| Edge Functions（V8） | 不支持 WebSocket，CPU 限 200ms | 本项目实时用 **SSE**，不依赖 WebSocket |
| KV Storage | 仅 Edge Functions 可用，最终一致性 ≤60s | 本项目**不用** KV |

### 1.2 部署步骤

1. **推代码**

   ```bash
   git init && git add -A && git commit -m "feat: 通识局 v1"
   git branch -M main
   git remote add origin <你的仓库>
   git push -u origin main
   ```

2. **EdgeOne Pages 控制台**

   - 新建项目 → 导入仓库 → 构建命令 `npm run build` → 输出目录 `.next`；
   - Node 运行时选择 **Node.js**（不是 Edge Functions）；
   - 确认平台侧函数超时 = 120s（与仓库里的 `edgeone.json` 保持一致）。

3. **验证**

   ```bash
   curl -I https://<你的域名>/daily          # 应 200
   curl -s https://<你的域名>/api/rooms/XYZ   # 应返回 JSON（房间不存在时也是 200/404，不要 5xx）
   ```

### 1.3 SSE 在云轨上的行为

云轨也能连 duel 的 SSE 流，但**房间状态不跨实例**，
所以**云轨上的 duel 只在单实例、无并发时勉强可用**，不作为推荐路径。
云轨的 SSE 主要服务于「同页多标签」这类轻量场景。

### 1.4 CI

`.github/workflows/ci.yml` 两个 job：

```
verify  ：lint → format:check → typecheck → validate:content → edgeone.json 检查 → test → build
e2e     ：needs: verify → 装 chromium → npm run test:e2e（失败时上传 report 与 trace）
```

`e2e` 起的是临时 `next dev -p 3100`，不碰生产构建产物。

其中 `edgeone.json` 检查确保 `maxDuration` 没被误删：

```bash
node -e "const c=require('./edgeone.json');if(c.nodeFunctionsConfig?.maxDuration!==120){process.exit(1)}"
```

### 1.5 `vercel.json` 的实际含义

仓库根有一份 `vercel.json`，为 SSE 路由单独设 `maxDuration: 60`。
**它是备选路径，不是当前云轨**：

| 项 | EdgeOne（当前云轨） | Vercel（`vercel.json`） |
|---|---|---|
| 函数硬超时 | 120s | **60s** |
| `STREAM_MAX_AGE_MS` | 100s —— 硬杀前 20s 主动轮换 ✅ | 100s —— **永远到不了**，连接先被平台硬杀 ❌ |
| 后果 | 清理必执行 | `cancel()` 不保证触发 → 僵尸订阅占配额 → 重连 429 |

> 如果真要上 Vercel，得把 `STREAM_MAX_AGE_MS` / `PING_INTERVAL_MS` / `STALE_SUBSCRIBER_MS`
> 三个值一起下调到 60s 以内（`lib/store/constants.ts`），并同步改 §1.1 与 ARCHITECTURE §4 的参数表 ——
> 三件套必须成套改，只改一个等于没改（ [`../AGENTS.md`](../AGENTS.md) 红线口径）。

---

## 二、本地轨：本地隧道（同步抢答 duel）

### 2.1 前置条件

| 条件 | 说明 |
|---|---|
| Node.js ≥ 18 | `npm install` 能跑起来即可 |
| cloudflared | **项目根目录已自带 `cloudflared.exe`**（51.7MB，`.gitignore` 已排除、不入库）；缺失时脚本会去 `PATH` 里找 |
| 端口 3000 空闲 | 不空闲时脚本**自动往后找一个空闲端口**（3001、3002…），并打印实际端口 |

cloudflared 下载：<https://developers.cloudflare.com/cloudflared/>

### 2.2 一键启动

```
双击 play-online.bat
```

脚本会依次完成：

1. 选端口：首选 3000，被占用就自动往后找一个空闲端口；
2. 检查构建产物：**源码比 `.next-online\BUILD_ID` 新就自动重编**（判据见 §2.5）；
3. 启动 `npm start`（最小化窗口），轮询端口直到就绪（最多 40s）；
4. 建立 cloudflared 隧道，正则抓取 `https://xxx.trycloudflare.com`；
5. 把 **`{链接}/duel`** 复制到剪贴板并打印；
6. 隧道退出后自动关掉本次启动的服务。

> **为什么产物在 `.next-online` 而不是 `.next`？**
>
> `next dev` 与 `next build` 共用同一个产物目录会**互相覆盖** ——
> build 把 dev 的 chunk 冲掉之后，dev 服务器上**部分页面**开始报
> `500 Internal Server Error`（表现为「有的页面正常、有的页面 500」，
> 因为 dev 已经编译过的路由还在内存缓存里，没编译过的就炸）。
>
> 反过来也成立：dev 启动时若目录里躺着上一次的生产构建，
> 首个请求要先跟它和解 —— 本机实测**首请求 112~124 秒**
> （表现就是「打开页面半天不出来」）。
>
> 所以本项目给四套场景各自分了一个目录（`next.config.mjs` 的 `distDir`，
> `NEXT_DIST_DIR` 可显式覆盖）：
>
> | 场景 | 产物目录 |
> |---|---|
> | `npm run dev` | `.next-dev` |
> | `npm run build` / `npm start` | `.next` |
> | `npm run test:e2e` | `.next-e2e` |
> | `play-online.ps1` | `.next-online` |
>
> **`npm run dev` 和联机通道可以同时跑**，互相不会冲掉对方的东西。

产物过期时脚本会自己重编（判据见 §2.5）。只有在「产物时间上比代码新、但你就是不信任它」时，
才需要手动强制重建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\play-online.ps1 -Rebuild
```

换端口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\play-online.ps1 -Port 3100
```

### 2.3 对战流程

1. 双方都打开 `{公网链接}/duel`；
2. 一方填昵称 → 「创建房间」 → 得到 **6 位房间码**；
3. 另一方填昵称 → 「加入房间」输入房间码；
4. 双方点「准备」→ 房主点「开始」；
5. 同步抢答：同一题、同一倒计时，先答对者独占该题分值。

### 2.4 注意事项

- **对局期间保持本机开机、不要睡眠** —— 服务跑在本机，机器睡了连接就断；
- **关掉窗口 = 断开通道**（隧道是前台进程）；
- `trycloudflare.com` 是**临时随机域名**，每次重启都会变，别把旧链接发出去；
- 房间态在内存里，**服务重启后房间全部消失**（这是设计如此，不是 bug）；
- 首次连接隧道可能需要十几秒。
- **每个请求约 1 秒**：quick tunnel 的边缘节点通常在海外（本机实测落在 `LAX`），
  国内过去单程就 150~250ms，加上 TLS 握手一个来回 ~1.07s（`GET /duel` 实测 1.07s，
  同一请求本机直连 4ms）。抢答是「先答到者独占分值」，这条通道上谁赢很大程度取决于**谁离边缘近**；
  想认真比一场，用同一 WiFi 的 `npm run dev:lan`，或走下面的云轨部署。
- **事件流走 POST，不走 `EventSource`**：quick tunnel 会整段缓冲 GET 的流式响应
  （实测 100 秒 0 字节，连接关闭才吐出），对战页面因此收不到实时事件。
  客户端已改为 `fetch(POST)` 读帧，原理与判据见 [`API.md`](API.md) §3 与 [`ARCHITECTURE.md`](ARCHITECTURE.md) §4。

### 2.5 产物过期判据

`play-online.ps1` 第 2 步不再只看 `.next-online\BUILD_ID` 存不存在，而是比较时间：

```
参与打包的源码里最新一次修改时间  >  BUILD_ID 的写入时间   →  重新构建
```

**范围**：`app/` · `components/` · `hooks/` · `lib/` · `types/` · `content/` 的文件，
加上根目录的 `next.config.mjs` / `package.json` / `package-lock.json` / `tsconfig.json` /
`tailwind.config.ts` / `postcss.config.mjs`。`content/` 必须在内 ——
`lib/content/server-bank.ts` 是**静态 import 题库 JSON**，改了题库不重编就等于没改。
**`docs/` · `__tests__/` · `e2e/` · `scripts/` 一律排除**：它们不进产物，
不该让你白等一次几十秒的构建。

**为什么这么改**：旧判据（有产物就跳过）让「改了代码但双击 .bat 忘了 `-Rebuild`」
变成**静默跑旧代码** —— 2026-10-22 实测踩过：SSE 改 POST 的修复已经进了仓库，
隧道上跑的还是昨天的 bundle（`POST /stream` 直接 405），
表现是「明明修好了，还是收不到事件」。触发构建时脚本会把**是哪个文件比产物新**打出来。

> `git checkout` / `git pull` 会重写工作区文件的修改时间，所以下一次双击通常会重编一次 ——
> 这是对的：拉下来的就是新代码。

---

## 三、AI 出题接口（可选）

默认**关闭**，不影响任何主链路功能。

```bash
# .env.local
AI_API_BASE=https://api.example.com/v1   # OpenAI 兼容协议；填 ollama 则走本地模型
AI_API_KEY=your-api-key
AI_MODEL=your-model-name
AI_ADMIN_TOKEN=your-admin-token          # 不设置时仅 development 环境可调
```

调用：

```bash
curl -X POST https://<域名>/api/ai/generate \
  -H "Content-Type: application/json" \
  -H "x-ai-admin-token: your-admin-token" \
  -d '{"domain":"gaming","topic":"经典作品","difficulty":2,"count":5}'
```

返回的 `accepted` 题目处于 **`status: "pending"`（待审池）**，
需要人工抽检后才可写入 `content/domains/<id>.json` 进入正式题库。

> AI 题**永不参与每日挑战** —— 每日挑战必须全网同题、可排行。

---

## 四、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `play-online.bat` 提示找不到 cloudflared | 根目录没有、也没进 PATH | 根目录已自带 `cloudflared.exe`；若被误删，从 <https://developers.cloudflare.com/cloudflared/> 下载后放回根目录 |
| 端口被占用 | 3000 上已有服务（如 `next dev`） | 脚本**自动换到下一个空闲端口**并打印实际端口；也可 `-Port 3100` 指定 |
| 部分页面 500 Internal Server Error（本地） | `next build` 覆盖了正在运行的 `next dev` 的 `.next`，dev 的 chunk 失效 | 关掉 dev 后重跑 `npm run build`；或直接用联机通道 —— 它的产物在 `.next-online`，与 dev 隔离 |
| **打开页面要等 1 秒多** | 隧道出口在境外边缘（实测 `CF-Ray` 落在 LAX），每个请求一个来回 ≈ 0.8–1.0s | 这是**物理延迟**，换协议参数无效；客户端已把「创建房间 → 首屏」压到 1 个往返（快照预取与跳转并行） |
| 答题偶发 409 | 慢链路下客户端回合号落后服务端一两个回合 | 已做三件事：提交用 ref 同步守卫防重复提交、倒计时归零后禁答、`stale_round`/`round_locked` 等**良性冲突静默重同步**（不再弹错误条） |
| 隧道建立失败 | 网络不通 / 被杀软拦截 | 手动跑 `cloudflared tunnel --url http://localhost:3000` 看原始日志 |
| SSE 每 ~100s 断一次 | **正常** —— 主动轮换 | 客户端会自动重连，不影响体验 |
| 加入房间报 404 | 房间码错 / 服务重启导致房间丢失 | 房间码 6 位大写；确认服务没重启过 |
| 云轨上 duel 分数异常 | 多实例内存不共享 | **别在云轨上打 duel**，用本地轨 |
| `npm test` 在 Linux 上 0 测试却退出 0 | 测试 glob 用了双星 `**` | 必须用单星 `__tests__/*.test.ts` |

---

## 五、备份与回滚

- 题库是纯 JSON，版本控制即备份；
- `docs/` 下是**活文档**（PRD / 架构 / 规则 / API / 内容 / 测试 / 设计 / 部署 / 团队章程）与
  **带日期的调研快照**（`docs/research/`），二者都随项目演进更新 —— 决策写在对应主题文档的决策小节里，不单独建档；
- 云轨回滚：平台侧切回上一个部署版本即可（无状态，无需数据迁移）；
- 本地轨回滚：`git checkout` 到旧 tag 后重新 `npm run build && npm start`。
