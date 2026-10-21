# 《通识局》测试约定

> 测试文件在 `__tests__/`，运行：`npm test`。
> 实现细节见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

---

## 1. 运行

```bash
npm test              # node --import tsx --test __tests__/*.test.ts —— 纯函数层 + 服务端
npm run test:e2e      # Playwright 浏览器冒烟（自己起 dev，跑 e2e/ 下的用例）
```

`test:e2e` 会用 `playwright.config.ts` 里的 `webServer` 在 **3100 端口**起一个 `next dev`，
跑完自动关掉；本机若已有服务在 3100 上会被复用（CI 里不复用）。

> **两条通道都实测过**：默认通道（Playwright 自带 chromium）本机 15/15 通过、约 42s；
> 没装那个浏览器的机器上可以 `PW_CHANNEL=msedge npm run test:e2e` 走已装的 Edge（同样 15/15，约 50s）。
> CI 用默认通道（`npx playwright install --with-deps chromium`）。
> **别在 e2e 或 dev 跑着的时候同时 `npm run build`** —— 两者共用 `.next`，
> 会把正在服务的 dev 打成全站 500。

### glob 必须用**单星**

```
✅ __tests__/*.test.ts
❌ __tests__/**/*.test.ts
```

> **双星 `**` 在 Linux CI 下会假绿灯** —— shell 不展开 `**`，
> 某些环境下匹配到零个文件却仍然退出 0。CI 会因此"通过"而实际一个测试都没跑。
>
> e2e 不走这个 glob：`testDir: "./e2e"` 由 Playwright 自己发现用例，
> 所以 `e2e/` 可以分子目录，而 `__tests__/` 必须保持平铺。

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

现有 18 个用例文件：`prng` · `engine.answer` · `engine.scoring` · `engine.daily` ·
`engine.repetition` · `engine.rank` · `engine.ghost` · `engine.blindbox` · `engine.pk` ·
`store.validate` · `store.authority` · `store.room` · `store.lifecycle` ·
`rate-limit` · `content.validate` · `ai.validation` · `ai.dedupe` · `e2e.smoke`

> ⚠️ **`lib/engine/date.ts` 没有用例文件** —— 它的日期口径（Asia/Shanghai 的 `dayKey()`、
> `shiftDay` / `daysBetween`）目前只靠调用方间接验证。这是纯函数层的一个已知缺口。

---

## 5. 客户端：自动化守住了主流程，人只负责判断类问题

> 单测打的是服务端与纯函数层。**2026-10-20 起下面这份清单已经写成 `e2e/`（Playwright）脚本**，
> 并配进 `.github/workflows/ci.yml` 的 `e2e` job —— 本机两条通道各 15 条全绿，
> 2026-10-21 首次推送时该 job 在 GitHub 上实跑通过（1m25s）。
> 所以这里从"必须手点"改成"脚本守住主流程，人看脚本看不出来的东西"。

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

> 同一条规则也适用于 `app/duel/room/[code]/page.tsx` 的 `pick()` —— 那边原本是
> `setTimeout(() => submitAnswer(option), 0)`，2026-10-20 一起改成直接调用。
> **判据不是"有没有 setTimeout"，而是"提交时读的是 state 还是参数"**：
> 只要提交路径读 `picked` state，就必须改成带参数调用。

### 5.3 冒烟清单与自动化对应关系

单测**覆盖不到**下面这些。括号里是 `e2e/` 里接住它的用例；没有括号的那几条仍要人看。

1. `/daily` 打开 → **点一个单选选项** → 必须立刻出现「答对了/答错了」+ 解析 + 得分；（`daily.spec.ts`）
2. 答对/答错后 → 顶部连击与分数**要变**；（人看 —— 脚本点的是第一个选项，对错不由脚本决定，
   所以它只断言反馈与解析出现，不断言分数值）
3. 「下一题」能进入第 2 题；（`daily.spec.ts`）
4. 答满 5 题 → 进入结算页，出现影子对比与段位卡；（`daily.spec.ts`，另加一条查成绩卡真出图）
5. `/pk` → 输入码 → 开始 → 点一个选项 → 同样有反馈；（`pk.spec.ts`，含"换码后题目不同"）
6. 打开**多选题** → 勾选后点「确认作答」→ 正确判定（全对才算对）；（`helpers.answerCurrentQuestion`
   —— 每题都会自动走多选分支，见 §5.4）
7. 打开**判断题** → 点选项 → 正确判定；（同上，随当日题集自然覆盖到）
8. `/duel` 双人开局 → **连答满 5 回合**，每一回合选项都要点得动；（`duel.spec.ts` 连验两次越过回合，
   见 [`ARCHITECTURE.md`](ARCHITECTURE.md) §4.3；**拆掉那条守卫，这个用例会立刻变红 —— 已做差分验证**）
9. duel 中途让连接断一次（切后台 / 断网 / 等到 100s 主动轮换）→ 重连后仍能作答且比分正确。
   （人 —— 脚本目前不复用 100s 轮换窗口；§8 的回合推进断言用的是单调越过而非精确题号，
   就是为了让这一类时序波动不变成假失败）
10. 360px 窄屏无横向溢出 + 命中区 ≥44px；（`responsive.spec.ts`，8 条路由 + 底线尺寸）

> 仍要人看的：视觉层级、文案语气（[`design/ui-system.md`](design/ui-system.md) §5）、
> 动效是否干扰节奏 —— 这些没有可断言的判据，脚本装不出来。

### 5.4 第三个只在浏览器里暴露的缺陷（2026-10-20 闭环测试）

`/daily` 与 `/pk` 的**多选题点「确认作答」毫无反应**，单选与判断正常 ——
上面第 6 条冒烟项**早就写在清单里**，缺陷照样在跑。

根因是把 hook 的方法直接当事件处理器传：

```tsx
onConfirm={c.submit}          // ❌ React 会把 MouseEvent 当第一个参数塞进 explicit
onConfirm={() => c.submit()}  // ✅ 不带参数调用，才会回落到 picked
```

于是 `explicit ?? picked` 拿到的是事件对象，判定时抛类型错误并被点击回调静默吞掉。
修法做了两面：调用点改成箭头函数；hook 里只认「字符串或字符串数组」，
误传进来的对象一律回落到 `picked`（`useDailyChallenge` / `usePkChallenge` 都加了）。

> **清单存在不等于跑过。** 冒烟的范围也要跟着代码走：改动 `hooks/**`、`components/quiz/**`、
> `app/{daily,pk,duel}/**` 之后都算，且交付说明里要写明"点过哪几条、看到什么"，
> 或者明确写"没有人工冒烟"。

---

## 6. 内容校验（CI 必跑）

```bash
npm run validate:content
```

退出码 0 = 通过，1 = 有阻断级错误。CI 会跑它。

---

## 7. 提交前的检查清单

```bash
npm run typecheck      # tsc --noEmit
npm test               # 全量单测
npm run validate:content
npm run test:e2e       # 浏览器冒烟（自带 dev 服务，跑完关闭）
npm run build          # 生产构建 —— 必须在 e2e / dev 停下之后再跑，两者共用 .next
npm run lint
npm run format:check
```

全绿再提交。改了 `lib/engine/*` 的**共享逻辑**时，
确认客户端与服务端仍得到**逐题相同**的结果 —— 这是每日挑战的命门。

---

## 8. 规模（现查，不写死）

测试用例数与题量会随每次提交变化，**不在本文维护数字**：

```bash
ls __tests__/*.test.ts | wc -l   # 用例文件数
npm test                          # 末尾汇总 tests / pass / fail
npm run validate:content          # 合计题量与每域分布
```

> 唯一真相源分别是 `__tests__/` 目录与 `content/domains/*.json`；
> 这里写死任何一个数，下一次加题就会让它变谎话。
