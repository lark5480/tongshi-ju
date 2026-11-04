# NPC 引擎 · 架构与契约

> **本文是 `lib/npc/` 的权威源**（冻结契约）。
> 产品需求见 [`docs/PRD.md`](docs/PRD.md) §NPC 章节。

---

## 0. 一句话

**老师 NPC 是一个难度调节器**：它读既有引擎产出的数据（熟练度 / 错题本 / 历史），
算出「你该练哪个域」，并给出一句点评。**它不改前 4 题、不裁决规则、不接受自由聊天**；
只影响第 5 题（个人加练、不计分）。

---

## 1. 分层

```
lib/npc/
├─ types.ts          共享类型（AnswerEvent / NpcFacts / NpcEpisode / NpcContext / NpcDecision）
├─ core/             纯函数内核 —— 无 IO、无网络、不读时钟
│  ├─ importance.ts  重要度打分（LLM 分 / 规则替身，同一 [1,10] 标度）
│  ├─ facts.ts       事实层（语义记忆）构造与更新
│  ├─ episodes.ts    情景层（记忆流）只追加
│  ├─ retrieve.ts    三段式检索（recency × importance × relevance）
│  ├─ policy.ts      选域权重 + 领域内选题排序（难度调节器核心）
│  └─ commentary.ts  降级点评模板
├─ narrate.ts        LLM 台词层（唯一调模型的地方之一）+ 降级编排
├─ storage.ts        宿主接入层：读写 NPC 情景层（按用户分区）
├─ client.ts         浏览器侧：请求点评 / 记录事件（永不抛错）
└─ index.ts          对外出口
```

服务端路由在 `app/api/npc/`（不在 `lib/npc/` 内，避免把 Next 依赖带进纯函数内核）：

- `app/api/npc/coach/route.ts` —— 点评（模型只在这里生成台词）；
- `app/api/npc/importance/route.ts` —— 单题事件的重要度打分（模型不可用 → 200 + `degraded: true`）。

**依赖方向（单向）**：
```
types ← core ← narrate ← client / route
                  ↑
              storage（只读既有引擎数据）
```

- `core/` **不得** import `client.ts` / `route.ts`；
- `core/` **不得**发起 IO、读时钟、读全局状态（时间由入参注入）；
- `core/` **不得**修改 `lib/engine/*` 的任何东西。

---

## 2. 冻结契约

| # | 契约 | 位置 | 变更纪律 |
| --- | --- | --- | --- |
| ① | `AnswerEvent` / `NpcFacts` / `NpcEpisode` / `NpcContext` / `NpcDecision` 形状 | `lib/npc/types.ts` | 只增不改 |
| ② | 记忆检索评分公式 `α_rec·recency + α_imp·importance + α_rel·relevance` | `core/retrieve.ts` | 权重变更须在裁决清单追加条目 |
| ③ | 重要度标度 **[1,10]**，两个来源同标度 | `core/importance.ts` | 改标度 = 改行为，须追加裁决 |
| ④ | 领域权重口径 `weakness×0.5 + errorRate×0.3 + recency×0.2` | `core/policy.ts` | 同上 |
| ⑤ | 前 4 题**全网同题**、逐题不变；NPC 只影响第 5 题（个人加练、不计分） | `core/practice.ts` + `hooks/useDailyChallenge.ts` | 红线：改前 4 题即破坏"全网同题" |
| ⑥ | 降级契约：模型不可用/超时/失败 → 模板点评 + `degraded: true` + 原因 | `narrate.ts` | 不可静默降级 |

---

## 3. 记忆模型（两层，不是三层）

```
facts/       结构化事实（语义记忆）—— 每次都加载，不看主题
episodes/    情景记忆（记忆流）—— 只追加，按需检索
```

**为什么没有向量层**（裁决 7）：通识局的"相关"是**结构化**的 ——
"这题属于哪个域、难度是否匹配"是确定的。引入嵌入会多一个外部依赖与不确定性，
且违反依赖克制红线（`AGENTS.md` §2.4）。

**结构化事实层是必需的，不是可选项**（依据：工程综述 —— 语义检索会漏掉
"每次都相关"的事实，如玩家的名字、做过的承诺）。通识局里对应的是：
熟练度 / 累计答错 / 累计答题 / 最近答题时刻。

### 3.1 事实层来源（**只读**既有引擎，不复制）

| NPC 事实 | 既有来源 |
| --- | --- |
| `mastery` | `getMastery()`（`domain\|topic` → 熟练度），同域多知识点取**算术平均** |
| `topicMastery` | 同一份 `getMastery()` 的**单知识点原值**（键 `domain\|topic`）；域内选题顺序优先用它，缺失时才回落域均值 |
| `wrongCounts` | `getWrongEntries()` 的 `wrongCount` 求和 |
| `attemptCounts` | **NPC 情景层**（单题粒度，唯一精确来源）；history 仅在情景层无该域记录时按"涉及该域的场次数"做**下限补位** |
| `lastSeenAt` | NPC 情景层的最近 `at` |

> **口径说明**：`mastery` 的源值是既有引擎的**单知识点净答对数**（`recordMastery`
> 每次 +1 / −1，下界 0），不是 0-1 概率；领域级 0-1 化由 `policy.ts` 的 `clamp01` 完成，
> `buildFacts` 不做二次归一。
>
> **归一刻度**：0-1 化按**满星刻度**（`MASTERY_FULL_MARKS = 10`，
> 沿用既有引擎 `masteryStars` 的 `value / 2` → 满星 5 星 = 10 次净答对）。
>
> ⚠️ **不能直接 `1 - clamp01(mastery)`** —— 那会把「净答对 1 次」当成"完全掌握"
> （`clamp01(1) = 1` → 薄弱度 0 → 该域权重掉到 0.167 ≈ "几乎不用练"）。
> 实测踩到过这条，已修正为 `1 - clamp01(mastery / MASTERY_FULL_MARKS)`。
> 同一口径贯穿 `policy.ts`（权重、领域内选题）与 `commentary.ts`（点评分档）。
>
> **不重复计入**：history 是**每局汇总**（无法拆到具体域），且与情景层覆盖同一批近期作答 ——
> 每日挑战每题进情景层、结算时同一局又进 history。两者相加会让同一次作答被计两次，
> 故 history 不参与叠加，只保底证明"该域曾经碰过"。

> **首次答题的域从熟练度 0.5 起算**，而不是 0 ——
> 否则首次答错 `0 − 0.15` 被钳到 0，与"完全没碰过"无法区分，
> 最该记住的信号会被抹平。

### 3.2 情景层来源

既有历史（`pushHistory`）是**每局一条汇总**，粒度太粗。
NPC 另存一份**单题事件流**（`npc-episodes` 存储键，按玩家名分区），
与既有 `recordAttempt` **并行**调用 —— 两者共享同一次作答，不重复造轮子。

容量上限 200 条（≈ 40 天），超出丢弃最旧的。

条目上的两个来源标记（都是**只增不改**的可选字段）：

- `source: "public" | "practice"` —— 公共题 / 第 5 题加练；旧条目缺省按 `public`；
- `importanceSource: "model" | "rule"` + `importanceDegradedReason` ——
  模型打分失败 / 未配置时保持规则分，并留下降级原因（不静默降级）。

重要度采用**先同步落盘、模型回来再升级**：作答当下先按规则分写一条
（用户立刻关页也不丢事件），模型返回后按 `questionId + at` 定位同一条目
就地升级；条目已被容量上限淘汰时**不重建**（避免复活过期记忆），
模型失败则保持规则分、只更新降级原因。

---

## 4. 检索评分

```
score = recency + importance + relevance        （三项等权）
```

| 分量 | 计算 | 依据 |
| --- | --- | --- |
| `recency` | `γ^(距上次访问的小时数)`，`γ = 0.995` | Generative Agents（Park et al., UIST 2023） |
| `importance` | 记忆的 1-10 分，归一到 [0,1] | 同上（LLM 打分 / 规则替身） |
| `relevance` | 领域一致 = 1.0；跨域 = 0.0；难度不匹配 = 0.6 | 本项目的结构化替代（无嵌入） |

**三项等权的理由**：论文等权；且权重的取舍需要真实使用数据标定，
本项目尚无标定数据 —— 拍一个"看起来合理"的权重比等权更不可解释。

**两条硬约束**：
- `topK = 3`（上限 4）—— 无关回忆浪费 token 且让角色混乱；
- `minRelevance = 0.2` —— 低于阈值直接丢弃。

**可解释**：每个命中带 `reason`（如「答错过 · 同域(gaming) · 难度匹配 · 近期」），
写进报告供复盘"为什么想起这条"。

---

## 5. 决策（难度调节器）

```
weights[domain] = weakness×0.5 + errorRate×0.3 + recency×0.2     （归一到 [0,1]）
  weakness = 1 - clamp01(mastery / MASTERY_FULL_MARKS)   ← mastery 是净答对数，满星刻度 10
domainOrder     = 按权重降序（同权重用确定性 tie-break：hash(seed, domain) → id 字典序）
questionOrder   = 领域内：错题优先 → 低熟练度知识点优先 → 同分用种子稳定排序
```

> **权重语义**：**越高 = 越该练**（越薄弱）。全新域薄弱度满格（1.0）——
> 这是设计意图（`buildCommentary`："新领域的记忆最值钱"），不是 bug。

### ⚠️ 4+1 分轨：前 4 题全网同题，第 5 题个人加练（红线 5）

每日挑战的**前 4 题**必须全网一致（同日期 + 同领域集合 → 同一份题），
否则红榜与同题 PK 失去意义。**第 5 题是破例条款**（AGENTS.md §2.1）：

- **前 4 题**：仍由 `dailySeed(dateKey, domains)` 决定，NPC 不参与；逐题不得变化；
- **第 5 题**：`lib/npc/core/practice.ts` 的 `pickPracticeQuestion` 按 `domainOrder`
  选最弱域，域内按 `topicMastery` 选最生疏知识点，并**排除前 4 题已出现的题**；
- **计分**：引擎只结算前 4 题（`PUBLIC_DAILY_COUNT` / `settlePublicAnswers`）。
  第 5 题不计分、不计排名、不影响 duel/PK；**只写 `mastery`，不写错题本**
  （`recordAttempt({ wrong: false })`），情景事件标注 `source: "practice"`
  并随条目落盘（历史条目无该字段 → 读取方按 `public` 处理，不回溯改写）。

**接线位置**（`hooks/useDailyChallenge.ts`）：先 `buildDailySet` 取公共 5 题，
前 4 题原样使用；第 5 题在有 NPC 事实时由 `pickPracticeQuestion` 替换。
首次使用（`touchedDomains === 0`）或上下文构造失败 → 不选加练题，
第 5 题**回落**为公共题的原第 5 题（有回归基线测试保证）。
同一天内重复请求走已锁定的 `DailySession`，5 题完全一致。

**口径版本与埋点（v2 起）**：历史记录带 `scoringVersion`（缺失 = v1 旧版 5 题计分，
新记录 = v2 4 题计分）；旧记录**不重算、不补齐"第 5 题"归属**，生涯累计 / 段位 /
影子对比只比同版本。加练题在当日 `DailySession.practiceFunnel` 记四态
（展示 / 作答 / 正确 / **跳过**）与结算曝光；`getPracticeFunnelSummary(fromDate, toDate)`
按日期区间返回展示数、作答率、正确率、跳过率（仅本地，无远端上报）。
**跳过与作答互斥**：跳过不记 `answered`（否则会把没做的人算进作答率、
又拉低正确率），只记 `skipped`；汇总据此单列跳过率。
答对时结算页给「你的 <域> 熟练度 +1」的弱反馈，**不改分数 / 排名 / 连击**；
跳过只给不打扰提示，不惩罚，也不会强制答完。

**出题可复现靠 PRNG，不靠模型**（裁决 14）：模型只决定"说什么"。
确定性模板路径（无模型 / 降级）在**同 seed + 同答题序列**下可复现；
模型路径不保证逐字相同（受采样与模型版本影响）。

---

## 6. 降级契约（红线：不可静默降级）

| 触发 | 行为 |
| --- | --- |
| 无模型端点 | 模板点评 + `degraded: true` + 原因 |
| 模型超时（15s） | 同上 |
| 模型抛错 | 同上 |
| 模型返回非法内容 | 同上 |
| 点评服务 HTTP 不可用 | 客户端本地模板兜底 |
| 客户端网络失败 | 客户端本地模板兜底 |
| 重要度模型打分不可用 / 失败 | 保持规则分；条目记 `importanceSource: "rule"` + `importanceDegradedReason`（200，不阻塞答题） |

**降级后 NPC 仍然完整可用**：能给出领域排序、能选第 5 题、能给基于事实的真实诊断 ——
只是措辞机械。**降级信息必须显式出现在报告与界面上**。

---

## 7. 治理证据

| 证据 | 载体 |
| --- | --- |
| 决策依据 | `NpcDecision.rationale`（写进界面与报告） |
| 领域权重 | `NpcDecision.weights` |
| 降级状态与原因 | `NpcDecision.degraded` / `degradedReason` |
| 检索命中原因 | `RetrievalHit.reason` |
| 模板底稿 | 接口返回 `templateCommentary`（便于对照模型版本改了没有） |

> 与 aiwarden 的治理面接入是**后续增强**（裁决 6）：浏览器游戏连 Java 治理服务
> 在架构上是错配的，且 aiwarden 侧无 NPC 相关工具。MVP 先把**本地可复现**的
> 证据链做实。

---

## 8. 已知边界

| 边界 | 现状 |
| --- | --- |
| 真实模型接入 | 客户端 → `/api/npc/coach`（点评）/ `/api/npc/importance`（重要度）→ 服务端 `getProvider()`；未配置时走模板 / 规则分 |
| 自由意图分类 | **未做** —— 通识局没有玩家自由输入入口（NPC 不是聊天机器人） |
| 反思机制 | **未做**（裁决 11）—— 拟人度增强，不是本项目的差异化 |
| 向量检索 | **不做**（裁决 7） |
| 记忆跨设备同步 | **不做** —— 纯前端 localStorage |
| aiwarden 治理接入 | **后续增强**（裁决 6） |
