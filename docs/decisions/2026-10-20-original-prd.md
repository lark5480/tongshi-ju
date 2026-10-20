---
status: archived
archived_at: 2026-10-20
superseded_by: docs/PRD.md
---

# 归档：Math-Physics Quest 原始 PRD 快照

> **这是一份归档快照，不再回改。**
> 原项目目录 `F:/other/code/ai/math-physics-quest` 保留不动，此处仅留一份内容快照，
> 用于追溯《通识局》的产品起点与后续改名/改方向的决策依据。
>
> 现行 PRD 见 [`docs/PRD.md`](../PRD.md)。

---

# Math-Physics Quest: Daily Challenge & Multiplayer Q&A Game

## Product Vision
一个结合脑筋急转弯、数学物理逻辑与在线多人对战的每日挑战游戏。玩家每日可获得1-3道随机混合题目，答题快慢和正确率决定排名。支持本地游玩与通过cloudflared隧道与朋友联机对战。

## Target Audience
- 休闲玩家：每日一道脑筋急转弯，打发时间
- 学生/知识竞赛爱好者：数物逻辑挑战，提升思维
- 朋友圈对战：通过隧道分享房间码，互相比拼速度

## Core Features

### 1. Daily Challenge (每日挑战)
- 每日随机抽取1道题（70%脑筋急转弯/生活类，20%数物理类，10%逻辑进阶）
- 计时答题，答对得分，答错扣除/不扣（可配置）
- 记录 连答天数 streak
- 错题本地记忆，下次优先出现变体

### 2. Multiplayer (在线对战)
- 继承 gomoku-game play-online.bat 模式
- 双击 play-online.bat 启动本地服务 + Cloudflare 隧道
- 生成公网链接（自动复制到剪贴板）
- 房间码制度：创建房间 → 发给朋友 → 朋友输入房间码加入
- 实时对战：双人同步作答，看谁答得快

### 3. Question Types (题目类型)
- **脑筋急转弯**：生活逻辑谜题（如：倒着数到1只能用数字8几次？）
- **数学计算**：小学/初中水平计算（如：13×17+5=?）
- **物理常识**：日常物理现象判断（如：自行车转弯为什么要倾斜？）
- **逻辑推理**： syllogism 或图推理（如：A>B，B>C，则A__C）

### 4. AI Generation (AI动态生成 - 自己的特色)
- 使用本地小模型（如ollama或rule-based）根据场景生成新题目
- 每周至少生成5道新题，保持新鲜感
- 用户可在设置里切换题目主题：编程/历史/生物等

### 5. Ranking & Records (排行与记录)
- 本地历史纪录榜（按 streak/总得分）
- 好友对战后可查看对战记录
- 分享结果：一键生成成绩图片，发朋友圈/群聊

## Tech Stack (技术栈)
- **Frontend**：Next.js 14 + React 18 + Tailwind CSS（参考 chess-arena）
- **Game Logic**：HTML5 Canvas（参考 gomoku-game）或 SVG 交互
- **Real-time**：WebSocket（参考 gomoku-game ws）
- **Multiplayer Deployment**：cloudflared.exe 隧道（参考 gomoku-game play-online.bat）
- **AI Generation**：本地 rule-based 或 ollama（可选）

## Non-Goals (不在本次范围)
- 复杂的物理物理引擎
- 移动端原生APP
- 账号体系和登录（首次使用游客模式）
- 付费订阅（免费开源为原则）

## Success Criteria (成功标准)
1. ✅ 双击 play-online.bat 可启动游戏并生成公网链接
2. ✅ 可与朋友通过房间码进行在线对战
3. ✅ 每日挑战每天刷新，包含混合题目类型
4. ✅ 移动端浏览器可访问（响应式设计）
5. ✅ 代码可在 EdgeOne Makers 部署

## Assumptions (假设)
- 用户已安装 Node.js 环境
- cloudflared.exe 位于项目根目录（首次需手动下载）
- 用户对数学物理有基本兴趣，而非专业要求

---
*Last updated: 2026-10-20*
