# 《通识局》测试约定

> 测试文件在 `__tests__/`，运行：`npm test`。
> 实现细节见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

---

## 1. 运行

```bash
npm test        # node --import tsx --test __tests__/*.test.ts
```

### glob 必须用**单星**

```
✅ __tests__/*.test.ts
❌ __tests__/**/*.test.ts
```

> **双星 `**` 在 Linux CI 下会假绿灯** —— shell 不展开 `**`，
> 某些环境下匹配到零个文件却仍然退出 0。CI 会因此"通过"而实际一个测试都没跑。

---

## 2. 断言纪律

### 2.1 写不变量，不写"我算出来的值"

```ts
// ❌ 断言"应该等于我算出来的值" —— 实现改了测试也跟着改，等于没测
assert.equal(rankValue(input), 12 * 3 + 5 * 4);

// ✅ 断言不变量
assert.ok(r.progress >= 0 && r.progress <= 1);
assert.ok(high > low);   // 单调性
```

### 2.2 不依赖毫秒精度与本机时间

- 断言时间相关行为时，传**明确的相对量**（如 `staleMs = 0`），不要 `Date.now()` 差值；
- `reclaimZombies` 的超龄判定用 `>=`，传 `staleMs = 0` 即可让全部订阅判为超龄；
- 定时器相关用例用 `node:test` 的 fake timers 或显式注入时间源
  （参考 `__tests__/helpers/fake-time.ts`）。

### 2.3 覆盖失败路径

只测 happy path 的测试等于没测。每个写操作至少覆盖：

- 参数非法 → 400；
- 凭证不属于该房间 → 403；
- 状态不允许 → 409；
- 超时 → 408。

---

## 3. 有外部状态的模块：必须重置

`lib/realtime.ts`（订阅表）与 `lib/store/room.ts`（房间态）用 `globalThis` 单例，
**跨用例会泄漏**。不重置的话，配额与回收断言会变成时序赌博。

```ts
import { __resetRoomsForTest } from "@/lib/store/room";
import { __resetSubscribersForTest } from "@/lib/realtime";

beforeEach(() => {
  __resetRoomsForTest();
  __resetSubscribersForTest();
});
```

> 重置钩子**必须提供并调用**。没有它，测试通过与否取决于用例顺序。

---

## 4. 纯函数层（`lib/engine/*`）

纯函数层是最容易测、也最该测的地方。每个导出函数都应有：

- **边界值**（0、空数组、负数、超大值）；
- **单调性**（输入变大 → 输出按预期变大）；
- **不变量**（比值落在 [0,1]、集合无重复、排序稳定）；
- **退化行为**（题库为空、候选池为空）。

现有覆盖：`prng` · `date` · `answer` · `scoring` · `daily` · `repetition` ·
`rank` · `ghost` · `blindbox` · `store.validate` · `store.authority` ·
`store.room` · `store.lifecycle` · `rate-limit` · `content.validate` ·
`ai.validation` · `ai.dedupe` · `e2e.smoke`

---

## 5. 客户端 hook —— 目前的测试盲区（重要）

> **本项目的单测覆盖的是服务端与纯函数层，React hook 没有自动化测试。**
> 2026-10-20 的验收就是在浏览器里点出这个盲区的一个**严重缺陷**。

### 5.1 曾经漏掉的那个 bug

`useDailyChallenge.toggleOption` 原来这样提交单选答案：

```ts
setPicked(option);
setTimeout(() => submit(), 0);   // ❌ submit 闭包里的 picked 还是旧值（空串）
```

`submit` 是 `useCallback`，闭包捕获的是**点击前那一帧**的 `picked`。
`setPicked` 引发的重渲染还没发生，所以 `submit` 读到空答案，
命中「答案为空」的分支**静默 return** —— 表现为**点了选项毫无反应**：
分数不动、不给反馈、不进下一题。单选与判断题**全部无法作答**。

服务端路由的 e2e 测试全绿，因为**它从不经过客户端 hook**。

### 5.2 现在的写法（不要退回旧写法）

答案**跟着调用走**，不依赖任何时序：

```ts
const submit = useCallback((explicit?: string | string[]) => {
  const value = explicit ?? picked;      // 单选走 explicit
  ...
}, [current, picked, submitted, combo]);

// 单选/判断题
setPicked(option);
submit(option);                            // ✅ 不再 setTimeout
```

### 5.3 人工冒烟清单（改 hook 后必跑）

单测**覆盖不到**下面这些。改完 `hooks/**` 或 `components/quiz/**` 后，
必须实际在浏览器里点一遍：

1. `/daily` 打开 → **点一个单选选项** → 必须立刻出现「答对了/答错了」+ 解析 + 得分；
2. 答对/答错后 → 顶部连击与分数**要变**；
3. 「下一题」能进入第 2 题；
4. 答满 5 题 → 进入结算页，出现影子对比与段位卡；
5. `/pk` → 输入码 → 开始 → 点一个选项 → 同样有反馈；
6. 打开**多选题** → 勾选后点「确认作答」→ 正确判定（全对才算对）；
7. 打开**判断题** → 点选项 → 正确判定。

> 自动化脚本（Playwright）尚未接入 CI —— 这是**已知缺口**，已列入 [`docs/PRD.md`](PRD.md) §11.2 后续路线。

---

## 6. 内容校验（CI 必跑）

```bash
npm run validate:content
```

退出码 0 = 通过，1 = 有阻断级错误。CI 会跑它。

---

## 6. 提交前的检查清单

```bash
npm run typecheck      # tsc --noEmit
npm test               # 全量单测
npm run validate:content
npm run build          # 生产构建
npm run lint
npm run format:check
```

全绿再提交。改了 `lib/engine/*` 的**共享逻辑**时，
确认客户端与服务端仍得到**逐题相同**的结果 —— 这是每日挑战的命门。

---

## 7. 规模

| 指标 | 当前 |
|---|---|
| 测试文件 | 19 |
| 用例数 | 210+ |
| 题库 | 12 域 / 500 题 |
