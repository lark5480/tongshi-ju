# 《通识局》内容维护手册

> 题库是**产品的知识密度来源**。这份文档说明怎么加题、怎么写好题、怎么不出事。
> 校验脚本：`scripts/validate-content.ts`（`npm run validate:content`，CI 必跑）。

---

## 1. 磁盘格式

题库存放在 `content/domains/<id>.json`：

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
      "options": ["选项一", "选项二", "选项三", "选项四"],
      "answer": "选项二",
      "explanation": "至少 10 字的解析（AI 校验链要求 ≥15 字）。",
      "source": { "title": "可选出处" }
    }
  ]
}
```

已审核入库的 AI 题存 `content/ai/<id>.json`，结构与 seed 文件相同，但每题多三个字段：

```json
{
  "id": "gaming-ai-1a2b3c4d",
  "batchId": "ai-m3k2-7x",
  "reviewedAt": "2026-11-10",
  "variantOf": "gaming-0041"
}
```

- `id` 由 schema 强制为 `<domain>-ai-<8 位十六进制>`；
- `batchId` / `reviewedAt` 是人工审核证据，必填；
- `variantOf` 可选，记录它改写自哪道原题。

### 1.1 磁盘上**不存**的三个字段

| 字段 | 为什么不在磁盘上 |
|---|---|
| `domain` | 由文件名决定，加载时注入 |
| `origin` | 磁盘上不存：seed 文件加载时注入 `seed`，`content/ai` 文件注入 `ai` |
| `fingerprint` | 由题干归一化后**在加载时计算** |

> 这样做的收益：**「改了题干忘了更新指纹」这类脏数据整类消失**。
> 指纹永远和题干一致，因为根本不存在手写指纹。

实现：`content/domains/schema.ts` · `lib/content/loader.ts` · `lib/content/fingerprint.ts`

---

## 2. 硬性校验规则

`npm run validate:content` 会强制以下全部规则：

| # | 规则 | 级别 |
|---|---|---|
| 1 | 文件结构符合 schema（字段齐全、类型正确、**未知字段被拒**） | 错误 |
| 2 | `id` 形如 `<domain>-0007`，**全局唯一**，前缀与领域一致 | 错误 |
| 3 | 归一化题干指纹**全局唯一** | 错误 |
| 4 | `topic` 必须**逐字**命中该域白名单 | 错误 |
| 5 | 答案必须命中选项；单选/判断答案唯一；多选答案 ≥2 且不重复 | 错误 |
| 6 | 选项无重复 | 错误 |
| 7 | 解析非空（长度 ≥10 字；**校验链要求 ≥15 字**） | 错误 |
| 8 | 多选答案按**原始字符串字典序**排序 | 错误 |
| 9 | 判断题 `options` 固定为 `["正确", "错误"]` | 错误 |
| 10 | 题量 < 40 | 警告 |
| 11 | 缺难度 1 或难度 3 | 警告 |
| 12 | 同域近似重复（Jaccard > 0.85） | 警告 |
| 13 | 文件名与 `domain` 字段一致；每个已登记领域都要有对应文件；**未登记领域的 JSON 视为错误** | 错误 |
| 14 | 命中**阻断级**内容安全词（`lib/content/sensitive.ts` 的 `SENSITIVE_BLOCK_PATTERNS`） | 错误 |
| 15 | 命中**警示级**时政 / 领土 / 民族 / 宗教表述（同文件的 `SENSITIVE_REVIEW_PATTERNS`） | 警告（人工复核） |
| 16 | `content/ai/` 必须有 12 个域文件；AI 题 id 形如 `<domain>-ai-<8 位十六进制>`，且带 `batchId` / `reviewedAt` | 错误 |
| 17 | AI 题的 id / 指纹与 seed 题**跨目录全局唯一**；AI 题与同域 seed 题做近似查重 | 错误 / 警告 |

> AI 题是补充，不是主库：不套用「每域 ≥40 题」与难度分布警告。

---

## 3. 选题原则

### 3.1 解析是产品的命脉

> **解析是产品的知识密度来源**，不要写「答案是 B」这种废话。

一份合格的解析要回答两个问题：

1. **为什么是这个答案**（排除其他选项的理由）；
2. **这个知识点本身是什么**（让没选对的玩家也学到东西）。

```jsonc
// ❌ 差
"explanation": "答案是 B，因为 B 是正确的。"

// ✅ 好
"explanation": "《只狼：影逝二度》的开发方是 FromSoftware，2019 年发售，以高难度动作与「死亡即重来」的循环著称。它的日式发音是 shishigami，与游戏中的苇名一心相连。"
```

### 3.2 题干避免歧义

校验链会直接拒收这些句式：

> 以上都对 / 以下哪个不是 / 下列说法正确的是 / 都不对 / 下列哪项正确

因为它们**没有唯一正确答案**。

### 3.3 跨域条目要干净

> 生活域的题不要偷偷考历史，地理域的题不要偷偷考宫廷秘闻。

`topic` 白名单是第一道闸，但白名单挡不住"表面是汽车、实际考化学"。
**写完检查一遍：这题换个领域答得对吗？**

### 3.4 只考稳定事实

| 该写 | 不该写 |
|---|---|
| 经典作品上映年份 | 当年票房榜 |
| 某项技术的原理 | 现任某公司的 CEO |
| 某发明的年代 | 最新旗舰机参数 |
| 教科书级的物理常数 | 最新天文探测数据 |

**时效性内容会过期**。题库是要用好几年的。

### 3.5 不确定就不写

宁可少写一道题，也不要编一个**似是而非**的数字、年份或人名。
一道错题会永久污染产品的可信度。

### 3.6 安全合规（重要）

**人工题库现在有自动化卡口了** —— `npm run validate:content` 的规则 14 / 15 会扫描
题干、选项、解析与 topic，词表在 `lib/content/sensitive.ts`（AI 校验链第 10 步共用同一份）。

| 级别 | 拦什么 | 后果 |
|---|---|---|
| 阻断 `block` | 明确违法违规：制毒贩毒、赌博网站、色情（含未成年人）、自制武器、种族灭绝 / 纳粹 | **报错，退出码 1，进不了主干** |
| 警示 `review` | 时政 / 领土 / 民族 / 宗教的**评价性句式**：主权争议、独立公投、领导人评价… | 只打警告，**人来判** |

> 为什么警示级不直接判死：一道「《南京条约》签订于哪一年」是合规的教材事实，
> 一道「某地主权归属如何评价」才是要命的。**自动化只做观测，不做结论。**

**加词的铁律：中文没有词边界。**
实测教训 —— `台独` 命中过「第一部在流媒体**平台独**家发行的剧集」。
所以新增条目必须 ① 语义明确、优先 4 字以上的长短语（不用裸地名、不用裸双字）；
② **全库实测 0 误伤**。`__tests__/content.sensitive.test.ts` 把这条钉住了：
只要新词击穿现有题目，测试就红 —— 那种词要么换更长的说法，要么放弃。

写作要求不变：

- 不涉及**争议性政治议题**、领导人评价、敏感事件；
- 问**事实**（年代、成因、影响），不站队、不评价；
- 避开宗教、民族、领土争议的敏感表述。

> 业界教训：同类答题产品曾因"部分题目涉政"被主管部门暂停服务。
> 题库规模越大，**被抽检的概率越高** —— 宁可不写，不要冒险。

---

## 4. 题型规范

| 题型 | `options` | `answer` | 配比建议 |
|---|---|---|---|
| `single` | 3–4 个 | 单个字符串（与选项**逐字符一致**） | 主体（≥70%） |
| `multi` | 3–4 个 | 数组，**按原始字符串字典序排序**，≥2 项 | 少量（4–6 题/域，以 2 个正确项为主） |
| `judge` | **固定** `["正确", "错误"]` | 其中之一 | 少量（5–8 题/域，正误尽量各半） |

> 上表的 `options` 个数与配比是**写作目标**，`npm run validate:content` 不检查配比
> （schema 只限制选项 2–6 个）。实际分布以该脚本输出为准，不在本文写死。
>
> 两个容易失衡的地方要人工盯：**多选别全写成 3 个正确项**（玩家会形成"选三个"的
> 惯性，2 个正确项应占多数）；**判断题的真假要接近各半**，否则一路选「正确」也能拿分。
>
> duel 题池会排除多选，抢答只出单选/判断；新增多选主要服务每日挑战与同题 PK。

### 4.1 答案用文本，不用字母

```jsonc
"answer": "《幽灵公主》"   // ✅
"answer": "B"              // ❌ 客户端可能对选项排序，字母会失效
```

### 4.2 多选题的"全对才得分"

少选、多选、错选**都算错**。所以多选题的干扰项要设计得像样 ——
不能出现"排除法一看就剩一个"的送分题。

### 4.3 正确项位置由引擎打乱

题库写作时**不需要手工搬动正确项**：`buildDailySet` 会按「局种子 + 题目 id」
确定性打乱选项，同一题在同一局中客户端 / 服务端 / 双方设备顺序一致。
校验脚本不检查位置，但请保证答案文本与选项文本逐字符一致。

---

## 5. 难度曲线

| 难度 | 含义 | 建议配比（每域 40 题） |
|---|---|---|
| 1 | 大众常识，人人都该会 | ≥12 题 |
| 2 | 需要一点了解 | ≥12 题 |
| 3 | 爱好者向，冷知识或细节 | ≥8 题 |

> 全库实际分布以 `npm run validate:content` 输出为准。
> 难度 2 偏多时，引擎的难度曲线会放宽（见 [`GAME-RULES.md`](GAME-RULES.md) §2.1）。

**必须同时有难度 1 和难度 3**，否则：
- 没有难度 1 → 新玩家上手曲线太陡；
- 没有难度 3 → 难度曲线覆盖不到，老玩家没东西追。

每日挑战的难度曲线与彩蛋题规则见 [`GAME-RULES.md`](GAME-RULES.md) §2.1。

---

## 6. 新增一个领域

领域体系一次建对，后续**只加数据、不改代码**：

1. 在 `content/domains/index.ts` 登记元数据（id / name / color / emoji / topics / batch）；
2. 补齐 `content/domains/<id>.json`（≥40 题，通过本文全部规则）；
3. `npm run validate:content` 必须 **0 错误**；
4. 把 `enabled` 置 `true`。

**选域页、随缘开局、盲盒轮转、题库加载、校验脚本全部按 12 域写好** ——
不需要改任何代码。

---

## 7. 指纹与去重

| 概念 | 口径 |
|---|---|
| **归一化** | 见 [`GAME-RULES.md`](GAME-RULES.md) §9.1（实现 `lib/engine/answer.ts`） |
| **指纹** | 归一化后 FNV-1a 32 位哈希（8 位十六进制） |
| **近似查重** | 中文按 **2-gram** 切分 + 英文数字按连续片段切分，算 Jaccard 相似度 |
| **阈值** | 同域内 Jaccard > **0.85** 告警 |

> 指纹查重抓"只差标点空白的重复题"；近似查重抓"换了个说法的同一道题"。

---

## 8. AI 题产线

`POST /api/ai/generate` 与 `npm run ai:review gen` 都是**内容补充工具**，不是每日挑战的题源。

### 8.1 流程

1. **生成**：`lib/ai/generate.ts` 调模型，结果过 **10 步校验链**（JSON → schema → domain/topic →
   难度 → 答案命中选项 → 歧义句式 → 解析长度 → 指纹查重 → 近似查重 → 敏感词）。
2. **落盘**：通过校验的题写入 `.ai-pending/<batchId>.json`（本地目录，已 gitignore；
   不存 Key / prompt）。
3. **审核**：`npm run ai:review list` / `show <batchId>` 人工看题。
4. **入库**：`npm run ai:review approve <batchId> --write` 重新查重后写入
   `content/ai/<domain>.json`；默认 dry-run，只有 `--write` 才改文件。
5. **CI**：`npm run validate:content` 把 seed 与 AI 一起校验（id / 指纹全局唯一、topic 白名单、
   答案命中选项、敏感词、近似查重）。

### 8.2 边界

- AI 题**永不进每日挑战 / duel**；只进 PK / 错题复习 / 第 5 题加练。
- 批准 AI 题**不得改变任何一天的每日题集**；`__tests__/engine.daily.test.ts` 有单测钉住。
- 待审池只留在本地；批准后的题才进仓库。
- 每日挑战题源边界见 [`../AGENTS.md`](../AGENTS.md) §2.1。

> ⚠️ **批次内查重要查"可变副本"**：每接受一题就立刻把它的指纹与 token 索引登记进去。
> 否则同一批次里的两道雷同题会双双通过。

### 8.3 产线自检（不接模型也能跑完 approve → validate）

不调用真实模型，手工造一个待审批次，验证 `list → show → approve → validate` 全链路：

1. 在 `.ai-pending/manual-smoke-1.json` 写入单题批次（字段对齐 `pendingBatchSchema`，
   `status: "pending"`，`accepted` 里放一题；`id` / `fingerprint` 是占位，
   approve 时会按题干重算并生成 `<domain>-ai-<8位十六进制>`）。
2. `npm run ai:review -- list` → 应看到该批次为 `pending`。
3. `npm run ai:review -- show manual-smoke-1` → 打印题干 / 选项 / 答案。
4. **守卫**：`node --import tsx scripts/ai-review.ts approve manual-smoke-1 --write --ids`
   → 必须报错「--ids 后必须跟至少一个题目 id」，且 `content/ai` 未被修改。
5. `node --import tsx scripts/ai-review.ts approve manual-smoke-1`（dry-run）
   → 打印将批准的题与生成的稳定 id。
6. `node --import tsx scripts/ai-review.ts approve manual-smoke-1 --write`
   → 写入 `content/ai/<domain>.json`。
7. `npm run validate:content` → 0 错误 0 警告。
8. `node --import tsx --test __tests__/engine.daily.test.ts` → 来源过滤与
   「批准 AI 题不改变当日题集」全绿。
9. 收尾：把 `content/ai/<domain>.json` 还原为空题池、删除该待审批次，再跑一次
   `npm test` 与 `npm run validate:content` 确认回到基线。

> ⚠️ 带 `--xxx` 参数时直接用 `node ... scripts/ai-review.ts`：npm 12 会把脚本参数里的
> `--write` / `--ids` 当成自己的 CLI flag 并报 `Unknown cli flag`。
> 不带 flag 的子命令仍可用 `npm run ai:review -- list` / `show <batchId>`。
> 自检题入库期间，`__tests__/content.loader.test.ts` 的「空 AI 题池」基线会按设计失败，
> 还原后必须重新转绿。

> 自检题**不得提交**：`content/ai/` 的试验题与 `.ai-pending/` 都只留在本地。
