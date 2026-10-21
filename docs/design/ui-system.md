# 《通识局》UI 设计系统 —— 「星轨 / Orbit」

> **本文是设计阶段的活文档**，随实现演进更新。
> 实现落点：[`../../tailwind.config.ts`](../../tailwind.config.ts) · [`../../app/globals.css`](../../app/globals.css) · [`../../components/`](../../components/)

---

## 0. 设计命题

《通识局》不是一个"答题表单"，它是一张**每天翻开一次的知识星图**。
所有视觉决策都服务于一个问题：**让用户明天还想再来一次。**

### 0.1 现状诊断（改造前）

| 症状 | 证据 | 影响 |
|---|---|---|
| **低能量** | 全站只有 1 个强调色 `#FF5C1A`，其余全是灰阶 `#8b93a1` / `#2a2f3a` | 看起来像一个后台管理页，不是一款游戏 |
| **emoji 当图标** | `NavBar` 用 🏠📅⚔️🌌📕📊，`DomainCard` 用 emoji | 跨平台字形不一致，与 lucide 混搭，风格不统一 |
| **背景是死的** | `body` 纯色 `#0f1115` | 12 个领域各有主题色，界面却完全没体现 —— 特色浪费 |
| **无动效层** | 只有 `fade-in` 一个 0.25s 淡入 | 作答反馈、连击、得分全部"啪"地一下出现，没有游戏感 |
| **无障碍缺口** | 没有 `prefers-reduced-motion`；选项按钮无 min-height | 前庭敏感用户不适；触屏命中率偏低 |
| **图标冗余** | 12 域 emoji 与 lucide 混用 | 视觉噪声 |

### 0.2 设计目标

1. **能量感** —— 每个领域都把自己的颜色"烧"进界面，12 域 = 12 种氛围。
2. **手感** —— 每一次作答都有即时的、可读的反馈（对/错/连击/得分）。
3. **克制** —— 动效服务于"看懂发生了什么"，不表演。
4. **可读优先** —— 答题页的任何装饰都不得降低题干与选项的对比度。

---

## 1. 视觉母题：「星轨 / Orbit」

> 12 个领域 = 12 颗星。选中的领域会在背景里亮成星云，每答对一题就点亮一颗。

这条母题把三个已有资产缝成一体：
- **知识星图**（`/map` 已有）—— 玩家的领域强弱分布；
- **领域主题色**（`content/domains/index.ts` 已有 12 色）—— 选域即换氛围；
- **跨域连击**（`lib/engine/scoring.ts` 已有）—— 连击 = 连成一条轨道。

---

## 2. 设计 Token

### 2.1 颜色

> 语义色一律走 token，**组件里不写裸 hex**（Tailwind `colors` 扩展是唯一入口）。
> 唯一例外：`components/result/ShareCard.tsx` 用 Canvas 绘图，`fillStyle` 拿不到 class，
> 只能写 hex —— 这些值必须与本表的 token 对齐。

| Token | 值 | 角色 |
|---|---|---|
| `bg` | `#080A11` | 页面底色（深空） |
| `bg-soft` | `#0D1018` | 次级底色（导航条） |
| `surface` | `#141826` | 卡片面 |
| `surface-2` | `#1C2132` | 卡片内嵌面、按钮 secondary |
| `surface-3` | `#252B3E` | 悬浮/按下态 |
| `border` | `#29304A` | 常规细边 |
| `border-strong` | `#3A4363` | 强调边、聚焦环底 |
| `fg` | `#EEF1F8` | 主文本（`text-fg`） |
| `muted` | `#99A3BD` | 次要文本（`text-muted`） |
| `dim` | `#66708C` | 三级文本、占位（`text-dim`） |
| `accent` | `#FF6A2B` | 主 CTA、分数、连击 |
| `accent-soft` | `#FF9257` | accent 的悬停/渐变尾 |
| `gold` | `#FFC24B` | 星级、里程碑、连胜 |
| `success` | `#34D399` | 答对 |
| `danger` | `#FB7185` | 答错、超时 |
| `info` | `#5FA8FF` | 中性提示 |

**12 域主题色保持不变**（`content/domains/index.ts`）—— 它们是用户可识别的身份标识，改色等于换品牌。

**对比度红线**：`fg` / `muted` 在 `surface` 上必须 ≥ 4.5:1；
`accent` 只用于**大字号或实心按钮底**，不用于 `surface` 上的小字（橙底白字对比度合格，橙字浅底不合格）。

### 2.2 背景：星云层

三层叠加，全部用 `body` 的两个 `fixed` 伪元素 + 一个客户端 `<Aurora />` 注入 CSS 变量实现
（`app/globals.css`）：

```
html      底色   纯色 #080A11（画在 html 上，body 保持透明以便伪元素分层）
body::before  星云   3 个 radial-gradient，色由 --nebula-1/2/3 提供（alpha .22 / .16 / .14）
body::after   星场   5 个 1–1.4px 白点 radial-gradient，opacity .55，
                     background-size 260/340/200/420/300px（互不同，避免可见的网格重复）
```

- 星云位置固定（左上 `10% 4%` / 右上 `92% 12%` / 底部居中 `50% 104%`），
  **没有** `filter: blur()` —— 柔化靠渐变本身的 `transparent` 尾（68% / 70% / 72%），
  比 blur 便宜且不会让整页进合成层；
- `body` 用 `isolation: isolate` 建独立层叠上下文，`z-index: -1` 的伪元素不会穿透到 `html` 之下；
- 两层伪元素都 `pointer-events: none`，不影响任何点击命中；
- 颜色来源：`<Aurora />` **优先用当日锁定会话的领域**（含盲盒轮换的两个域），
  没有会话才回落到档案里的本命；
- **未选领域时**退化为橙 / 蓝 / 紫三色微光（`#FF6A2B` `#5FA8FF` `#7C3AED`，
  与 `:root` 的默认值相同），保证不空；
- 星云与星场都是 `fixed`，**不随滚动移动**，不制造视差眩晕。

### 2.3 字体与排版

无新依赖（项目红线：不引字体库），沿用系统栈：

```
ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif
```

| 层级 | 落地写法 | 实际像素 | 用途 |
|---|---|---|---|
| Display | `text-4xl font-bold` | `36px / 1` | 分数（`/daily`、`/pk` 结算与顶栏） |
| Title | `text-xl font-bold tracking-tight` | `20px` | 页面标题（`/domains` `/duel` `/map` `/history` 的 `h1`） |
| Question | `text-[18px] font-semibold leading-[1.7]` | `18px / 1.7` | 题干（**行高要松**，长题干才不累） |
| Body | `text-[15px] leading-[1.65]` | `15px / 1.65` | 解析正文 |
| Label | `text-xs` / `text-sm` | `12px` / `14px` | 标签、按钮 |
| Caption | `text-xs` | `12px` | 次要说明（`text-dim` / `text-muted`） |

- 数字一律 `.tabular`（`font-variant-numeric: tabular-nums`）—— **倒计时与分数不许跳字**；
- 标题的字距走 Tailwind `tracking-tight`（`-0.025em`），**不做**全局 `letter-spacing`；
  中文正文不加字距（会散）。
- **已知不一致**：首页 `h1` 用 `text-2xl`（24px），其余四个页面用 `text-xl`（20px）。
  两档都在可接受范围内，但要么统一到一档，要么把"首页更大"当成有意的层级差异写进来 —— 别让它继续是偶然。

### 2.4 圆角 · 阴影 · 层级

| Token | 值 | 用途 |
|---|---|---|
| `rounded-sm` | `10px` | 小徽标、输入框 |
| `rounded-md`（= `DEFAULT`） | `14px` | 按钮、选项 |
| `rounded-lg` | `20px` | 卡片、面板 |
| `rounded-xl` | `24px` | 大面板 |
| `rounded-pill` | `999px` | 标签、头像 |
| `shadow-card` | `0 1px 0 rgba(255,255,255,.05) inset, 0 12px 32px -20px rgba(0,0,0,.95)` | 卡片 |
| `shadow-glow` | `0 10px 34px -14px var(--glow-color, #FF6A2B)` | 强调态（`--glow-color` 由领域色内联注入） |
| `shadow-glow-sm` | `0 6px 20px -10px var(--glow-color, #FF6A2B)` | 弱一档的同色发光 |
| `shadow-pop` | `0 0 0 1px rgba(255,255,255,.08), 0 6px 18px -8px rgba(0,0,0,.8)` | 悬浮 |

**层级规则**：页面底（无边框）< 卡片（细边 + 阴影）< 卡片内嵌面（更亮的 surface）< 悬浮/强调（发光边）。

### 2.5 动效

**过渡时长**（`tailwind.config.ts` 的 `transitionDuration`，用 `duration-fast` 等 class）：

| Token | 时长 | 用途 |
|---|---|---|
| `fast` | `120ms` | hover、按下（选项/按钮） |
| `base` | `180ms` | 展开、淡入、卡片抬升 |
| `slow` | `280ms` | 较慢的状态变化 |

> `transitionDuration` 里**没有** `pop` —— 回弹感由下面的关键帧承担，不要写成 `duration-pop`。

**关键帧动画**（`animation`，均已在 `tailwind.config.ts` 定义）：

| class | 时长 / 曲线 | 引用处 |
|---|---|---|
| `animate-pop-in` | `320ms cubic-bezier(.34,1.56,.64,1)` | 选项反馈回弹（`QuestionCard`） |
| `animate-shake` | `280ms`，`translateX ±4px → ±2px` | 答错抖动（`QuestionCard`） |
| `animate-pulse-soft` | `1.2s` 循环，`scale 1→1.04` | 倒计时告急脉冲（`QuestionCard`、对战房间） |
| `animate-fade-in` | `0.25s ease-out` | 通用淡入（`QuestionCard`、`/map`） |

> **只保留有组件引用的关键帧。** 2026-10-20 清掉了 `rise` / `chain-fill` / `star-pop` / `flame` /
> `pulse-ring` 五个定义了但零引用的动画 —— 知识链与影子条走 `transition-transform` + `scaleX`，
> 不需要关键帧。要新动效就**连同引用一起提**，不要先往配置里塞一个等着用。

**硬规则（来自 `ui-ux-pro-max` 规则库）**：

1. **一屏最多 2 个关键动效** —— 答题时只允许「选项反馈」+「进度变化」动，其余静止。
2. **禁止 0ms 状态突变** —— 任何状态切换都要有 `dur-fast` 以上的过渡。
3. **动效必须表达含义** —— 动效不能只为了"好看"；看不懂在表达什么就删掉。
4. **禁止动 width/height** —— 用 `transform: scaleX()`，避免布局抖动。

### 2.6 无障碍

| 项 | 要求 |
|---|---|
| 降低动效 | `@media (prefers-reduced-motion: reduce)` → 所有 `animation`/`transition` 归零（`0.01ms`），`transform` 动效不执行 |
| 焦点可见 | `:focus-visible` 保留 2px accent 环 + 2px 偏移，**不得移除** |
| 触屏尺寸 | 可点击目标最小 **44×44px**（Web 基线 24px + WCAG 间隔例外，但本项目统一取 44px） |
| 触屏间距 | 相邻可点击元素间距 ≥ **8px** |
| 色彩非唯一线索 | 答对/答错**同时**给图标（✓/✗）与文案，不只靠颜色 |
| 图标 | 装饰性图标 `aria-hidden`；纯图标按钮必须有 `aria-label` |

---

## 3. 组件规格

### 3.1 `Button`（`components/ui/Button.tsx`）

| Variant | 视觉（`components/ui/Button.tsx` 的 `VARIANTS`） |
|---|---|
| `primary` | `bg-gradient-to-b from-accent-soft to-accent`（上浅下深），白字，`shadow-glow`；`hover:brightness-110` / `active:brightness-95`；禁用时降为 `surface-3` 灰底 `text-dim` 无发光 |
| `secondary` | `bg-surface-2` + `border`，`text-fg`；hover → `border-strong` + `surface-3` |
| `ghost` | 透明，`text-muted` 字，hover → `bg-surface-2` + `text-fg` |
| `danger` | `bg-danger`，白字，`hover:brightness-110` |

- `size="lg"` → 最小高度 **48px**，`size="md"` → **44px**，`size="sm"` → **36px**（仅非主路径）；
- 圆角 `rounded-md`；字重 600；`active:scale-[.98]`（`reduced-motion` 下失效）；
- `buttonClass(variant, size, block)` 单独导出，让 `<Link>` 直接长得像按钮 ——
  `<a>` 里嵌 `<button>` 是非法 HTML，而且外层 `<a>` 会退化成行内盒，命中区只剩 20px 高。

### 3.2 `QuestionCard`（`components/quiz/QuestionCard.tsx`）—— 最高频组件

结构自上而下：

```
┌────────────────────────────────────────┐
│ [域色胶囊: ⬤SVG 图标 游戏 · 经典作品]  23s│   ← 胶囊底色 = 域色 12%（`{color}1f`）+ 内描边 27%
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   ← 剩余时间条（transform: scaleX，不动 width）
│                                        │
│  题干（18px/1.7，左对齐）               │
│                                        │
│  ┌ 选项 A ──────────────────────┐      │
│  │ 2023 年《博德之门 3》获……      │      │   ← 3px 左侧色条：常态 opacity .55，dimmed .18
│  └──────────────────────────────┘      │
│  ┌ 选项 B ──────────────────────┐      │
│  └──────────────────────────────┘      │
│                                        │
│  ┌ 解析面板 ─────────────────────┐      │   ← 提交后 `animate-fade-in` 出现，左侧 3px 域色边框
│  │ ✓ 答对了   正确答案：……          │      │
│  │ 解析正文……（15px/1.65）         │      │
│  └──────────────────────────────┘      │
└────────────────────────────────────────┘
```

- 多选题在选项前置一个 `h-5 w-5` 勾选框（选中态 accent 实心 + ✓）；
- 倒计时三档：常态 `text-muted` → 预警 `text-gold` → 告急 `text-danger` + `animate-pulse-soft`；
  提交后显示 `—`。

**状态机**（`data-state` 属性驱动，与现有实现对齐）：

| 状态 | 视觉 | 动效 |
|---|---|---|
| 默认 | `surface-2` 底 + `border` 边 | — |
| hover | 边框转 60% 域色，底色微亮 | `dur-fast` |
| 选中（多选） | 域色描边 + 域色 12% 底 | `dur-fast` |
| `correct` | `success` 边 + 15% 绿底 + 左侧 ✓ 图标 | `animate-pop-in`（320ms，0.94→1.02→1 回弹） |
| `wrong` | `danger` 边 + 15% 红底 + 左侧 ✗ 图标 | `animate-shake`（`translateX ±4px → ±2px`，280ms） |
| `dimmed` | 透明度 45%（`.option-btn[data-state="dimmed"]`） | 无 |

**倒计时**：剩余 ≤ 5s 时数字转 `danger` 并加 1.2s 循环的 4% 缩放脉冲；≤ 0 视为超时。

### 3.3 `NavBar`（`components/ui/NavBar.tsx`）

- **用 lucide-react 图标替代 emoji**（`lucide-react` 已是依赖，无需新增）。当前 7 个入口与图标：

  | 入口 | `/` 首页 | `/daily` 每日 | `/pk` 同题 | `/duel` 对战 | `/map` 星图 | `/wrong` 错题 | `/history` 战绩 |
  |---|---|---|---|---|---|---|---|
  | 图标 | `House` | `Calendar` | `Users` | `Swords` | `Orbit` | `NotebookPen` | `BarChart3` |

- 容器：`sticky top-0 z-40` + `bg-bg-soft/85` + `backdrop-blur-xl` + 底部 1px `border`；
  左侧另有一枚 `h-7 w-7` 的 accent 渐变品牌块；
- 激活项：`bg-accent/15` + `font-semibold` + `text-accent`，图标 `size=15`、
  `strokeWidth` 激活 `2.3` / 未激活 `1.9`，并带 `aria-current="page"`；
- 每项 `min-h-[44px]`（命中区达标），横向 `px-2.5`，相邻项间距 `gap-2`（**8px**，达 §2.6 下限；
  原来是 `gap-1` = 4px，2026-10-20 提到 8px）。
- 移动端横向滚动且**隐藏滚动条**（`.no-scrollbar`）。

### 3.4 `DomainCard`（`components/domain/DomainCard.tsx`）

- 顶部 3px 域色条（保留，改为 `rounded-t` 融合）；
- 域色光晕仅在 **hover / 选中**时出现（`shadow-glow` 用域色内联注入）—— 静态页面 12 张卡全发光会失控；
- 熟练度星点用域色填充（保留）；
- "筹备中"状态：降透明度 + `cursor-not-allowed`，**不可点**（保留现有逻辑）。

### 3.5 `ShareCard`（`components/result/ShareCard.tsx`）

Canvas 手绘 1200×630，色值取自 §2.1 的 token（Canvas 拿不到 class，只能写 hex）：

| 元素 | 落地值 |
|---|---|
| 背景 | 对角渐变 `#080A11 → #141826` |
| 顶部条 | 8px，**当日第一个领域的真实色** → `#FF9257` 渐变 |
| 标题 | `bold 54px`，`{玩家头像 emoji} 通识局 [· 副标题]` |
| 日期 | `30px` `#99A3BD` |
| 分数 | `bold 150px` `#FF6A2B` + 尾部 `30px` 灰「分」 |
| 星级 | `drawStar()` 矢量五角星，半径 24，`#FFC24B`；`stars` 为 0 时**仍画 1 颗** |
| 右侧信息 | 从 `x=620` 起：`答对 N / M 题`（34px）→ `最高 N 连击`（仅 ≥2 时画）→ `连续 N 天`（仅 >0 时画）→ `PK <码>`（仅传了 `pkCode` 时画，`#5FA8FF` bold 38px） |
| 领域标签 | 胶囊：域色 `33` 底 + 域色文字，**保留 `domain.emoji`**（见 §3.6） |
| 方块网格 | 传 `cells` 才画：62px 一方、间距 14；答对=该题域色实心，答错=`rgba(251,113,133,.35)` + 描边 |
| 页脚 | `26px` `#66708C`；有 PK 码时文案切成「同一个 PK 码 · 同一份题」 |

分享链路：优先 `navigator.share`（移动端可分享文件），降级为下载 `tongshi-ju.png`。

> **成绩卡上没有段位、也没有影子对比** —— 组件只收 §2.1 那几项数据。
> 「把段位与影子加进成绩卡」仍是**待做**，不要照着这行去代码里找。

### 3.6 emoji 政策（哪些该换，哪些该留）

界面图标**一律用 Lucide SVG**（`lucide-react` 已是依赖）。但 emoji 并不是一律要消灭 ——
分三类处理：

| 场景 | 处理 | 理由 |
|---|---|---|
| 导航、按钮、卡片、状态图标 | **换 SVG** | 跨平台字形/基线不一致，与站内图形语言割裂 |
| **玩家头像**（`profile.emoji`） | **保留** | 这是**用户选的数据字段**，服务端有「头像必须是 emoji」的校验，还会随对战快照广播给对手。换成图标会破坏数据契约 |
| **12 域标识**（`domain.emoji`） | **界面用 SVG，Canvas 成绩卡保留** | 域 emoji 是数据字段；但界面渲染统一走 `domainIcon()` 映射。Canvas 成绩卡里保留 emoji —— 社交图片里 emoji 是惯用且清晰的形态，而把 Lucide 路径矢量化成 Canvas 路径成本过高 |
| 星级 | **矢量五角星**（界面用 Lucide `Star`，Canvas 用手绘路径） | emoji 星星的大小/基线在不同系统上差异明显；成绩卡是要发给别人看的，必须稳定可控 |

判定口诀：**emoji 是数据，就别动；emoji 是图标，就换掉。**

---

## 4. 页面级设计

| 页面 | 关键改动 |
|---|---|
| `/` 首页 | 顶部改为「今日状态面板」：日期 + 段位徽章 + 连续天数；主 CTA 大按钮；领域色星云随选域变化 |
| `/daily` 每日 | 顶部 **知识链**（连击分段条）；题目卡按 §3.2 重做；结算页展示影子对手对比 |
| `/domains` 选域 | 卡片网格；顶部显示"已选 N/3"与「盲盒轮转」开关说明 |
| `/duel` 对战 | 房主/访客双栏比分条；倒计时更强对比；SSE 连接状态点 |
| `/map` 星图 | 12 域雷达/轨道图，域色为轴，熟练度为半径 |
| `/wrong` 错题本 | 复习队列按"下次该来"的日期排序，间隔阶段可见 |
| `/history` 战绩 | 折线/柱状趋势 + 段位变化 |

---

## 5. 文案规范

**语气**：像一个有点幽默、但不吵的 Trivia 主持人。短句，不喊口号，不用感叹号轰炸。

| 场景 | ❌ 不要 | ✅ 要 |
|---|---|---|
| 按钮 | "开始吧！冲！" | "开始今日挑战" |
| 答对 | "太棒了！！！" | "答对了" |
| 答错 | "很遗憾你失败了" | "差一点" |
| 连击 | "恭喜你达成 3 连击！！" | "3 连击 · 跨域加成中" |
| 空态 | "暂无数据" | "还没有战绩 —— 先来一局？" |
| 结算 | "恭喜你获得了 3 星评价！" | "今天答对 4 / 5 · 越过昨天的自己 12 分" |

**规则**：
1. 句子 ≤ 20 字；
2. 不用「！」连发，不用「哦」「啊」「呀」；
3. 不评价用户聪明与否（"你真聪明"），只陈述事实（"比昨天快 4 秒"）；
4. 鼓励要具体 —— 说清楚"你比什么强了多少"。

---

## 6. 落地状态

> 逐条对账当前代码，而不是一张"待办"清单。取证方式写在右侧。

- [x] `tailwind.config.ts` 含全部语义 token（§2.1）+ 圆角 + 阴影 + 过渡时长 + 关键帧
- [x] `app/globals.css` 含星云/星场背景、`prefers-reduced-motion` 归零块、
      `.option-btn` / `.domain-card` / `.panel` / `.star-dot` / `.chain-seg` / `.lift` 组件类
- [x] `components/**` 全部改用 token，emoji 图标换 lucide
      （唯一保留 hex 的是 Canvas 成绩卡，见 §2.1 例外说明）
- [x] 可点击目标 ≥44px：`Button` md=44 / lg=48、`.option-btn` min-h=52、`.domain-card` min-h=88、NavBar 项 min-h=44
- [x] 相邻可点击元素间距 ≥8px：导航条 `gap-2`（原 `gap-1`=4px，2026-10-20 提到 8px 并实测：
      531px 视口下 7 项相邻间隙均为 8px、高度均 44px，横向滚动可把最后一项完整滚进视口）
- [ ] 答题页「一屏 ≤2 个关键动效」没有自动化判据 —— 现状是倒计时脉冲 + 选项反馈 + 解析淡入三者并存，
      需要人判定是否干扰节奏
- [x] 答对/答错同时具备「颜色 + ✓/✗ 图标 + 文案」三重线索（`QuestionCard` 解析面板）
- [x] `npm run typecheck` / `npm test` / `npm run validate:content` / `npm run build` 全绿
      （每次提交前重跑，命令见 [`../TESTING.md`](../TESTING.md) §7）
