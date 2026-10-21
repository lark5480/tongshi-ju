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
| cloudflared | 放在项目根目录，或已装进 `PATH`（脚本会自动找） |
| 端口 3000 空闲 | 被占用时脚本会**复用**已有服务并提示 |

cloudflared 下载：<https://developers.cloudflare.com/cloudflared/>

### 2.2 一键启动

```
双击 play-online.bat
```

脚本会依次完成：

1. 检查构建产物 `.next\BUILD_ID`（缺失则自动 `npm run build`）；
2. 启动 `npm start`（最小化窗口），轮询端口直到就绪（最多 40s）；
3. 建立 cloudflared 隧道，正则抓取 `https://xxx.trycloudflare.com`；
4. 把 **`{链接}/duel`** 复制到剪贴板并打印；
5. 隧道退出后自动关掉本次启动的服务。

改过代码后想强制重建：

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
| `play-online.bat` 提示找不到 cloudflared | 没放根目录也没进 PATH | 下载后放根目录，或 `winget install --id Cloudflare.cloudflared` |
| 端口被占用脚本直接复用 | 3000 上已有服务 | 关掉旧窗口，或用 `-Port` 换端口 |
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
