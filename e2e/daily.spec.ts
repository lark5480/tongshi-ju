import { expect, test, type Page } from "@playwright/test";

import { findQuestion } from "@/lib/content/server-bank";
import { advance, answerCurrentQuestion, expectRound } from "./helpers";

/** 4+1 分轨：前 4 题是全网同题的公共题，第 5 题是个人加练（不计分）。 */
const PUBLIC_QUESTIONS = 4;

/** 从当日会话里取第 5 题 id —— 题库答案只在服务端侧可读，用它定位正确选项。 */
async function practiceQuestionId(page: Page): Promise<string> {
  const session = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("tongshi-ju.daily."));
    if (!key) return null;
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      questionIds?: string[];
    } | null;
  });
  const id = session?.questionIds?.[PUBLIC_QUESTIONS];
  if (!id) throw new Error("当日会话里没有第 5 题");
  return id;
}

/** 跑完 4 道公共题，停在加练题。 */
async function runPublicQuestions(page: Page): Promise<void> {
  await page.goto("/daily");
  for (let round = 1; round <= PUBLIC_QUESTIONS; round++) {
    await expectRound(page, round);
    await answerCurrentQuestion(page);
    expect(await advance(page)).toBe(true);
  }
  await expectRound(page, PUBLIC_QUESTIONS + 1);
}

/** 加练题存在时，答题页必须写明「你的加练题」与「不计分、不计排名」。 */
async function expectPracticePanel(page: Page): Promise<void> {
  await expect(page.getByText("你的加练题")).toBeVisible();
  await expect(page.getByText(/这道题不计分、不计排名/)).toBeVisible();
}

/**
 * 按题库答案作答加练题。
 *
 * 脚本点第一个选项只能碰运气答对，要断言「熟练度 +1」就必须拿到正确答案 ——
 * 答案不在客户端会话里，只能从服务端题库按会话里的题目 id 反查。
 */
async function answerPracticeCorrectly(page: Page, questionId: string): Promise<void> {
  const question = findQuestion(questionId);
  if (!question) throw new Error(`题库里找不到第 5 题 ${questionId}`);
  await expect(page.locator("h2").first()).toHaveText(question.stem);

  const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
  for (const answer of answers) {
    await page.locator(".option-btn").getByText(answer, { exact: true }).click();
  }
  const confirm = page.getByRole("button", { name: /确认作答/ });
  if (await confirm.isVisible()) await confirm.click();

  await expect(page.getByText(/答对了/).first()).toBeVisible();
  await expect(page.locator(".panel", { hasText: "正确答案" }).first()).toBeVisible();
}

/** 答完 4 公共题 + 1 加练，停在结算页。 */
async function finishDaily(page: Page): Promise<void> {
  await runPublicQuestions(page);
  await expectPracticePanel(page);
  await answerCurrentQuestion(page);
  expect(await advance(page)).toBe(false);
}

/**
 * 每日挑战闭环 —— TESTING §5.3 的第 1～4 条（4+1 分轨）。
 *
 * 只断言**确定性**的东西：反馈出现、解析出现、结算条目为 5。
 * 不断言分数值 —— 脚本点的是第一个选项，对错不由脚本决定，
 * 断言具体分数只会让用例跟着题库内容一起抖。
 * 但「只有前 4 题计分」是可确定的结构事实，必须显式断言。
 */
test("每日挑战：4 公共题 + 1 加练 → 结算 → 成绩卡出图", async ({ page }) => {
  await finishDaily(page);

  await expect(page.getByText("影子对手")).toBeVisible();
  await expect(page.getByText("通识段位")).toBeVisible();
  // 满分口径按 4 道公共题
  await expect(page.getByText(/公共题答对 \d \/ 4 题/)).toBeVisible();

  // 逐题回顾 5 条，但只有 4 条带「N 分」；第 5 条明确标「不计分」
  await expect(page.getByText(/^(\d+ 分|不计分)$/)).toHaveCount(PUBLIC_QUESTIONS + 1);
  await expect(page.getByText(/^\d+ 分$/)).toHaveCount(PUBLIC_QUESTIONS);
  await expect(page.getByText("不计分", { exact: true })).toHaveCount(1);
  await expect(page.getByText("加练 · 不计分")).toBeVisible();

  await page.getByRole("button", { name: /生成成绩卡/ }).click();
  await expect(page.locator('img[src^="data:image/png"]')).toBeVisible();
});

/**
 * 加练题不计分 —— PRD §4.5 的验收点。
 *
 * 答对加练题只写熟练度（结算页给出「熟练度 +1 · 不计分」），
 * 分数在作答前后必须一字不变，结算总分也只按前 4 题算。
 */
test("每日挑战：加练题答对只写熟练度，不改分数", async ({ page }) => {
  await runPublicQuestions(page);
  await expectPracticePanel(page);

  // 进入加练题时的分数（只含前 4 题）
  const before = await page.locator(".tabular.font-semibold.text-accent").first().innerText();

  await answerPracticeCorrectly(page, await practiceQuestionId(page));

  // 答对加练题后，答题页上的分数不变
  await expect(page.locator(".tabular.font-semibold.text-accent").first()).toHaveText(before);

  expect(await advance(page)).toBe(false);

  // 结算页：反馈文案显式写「熟练度 +1 · 不计分」，总分仍只等于前 4 题
  await expect(page.getByText(/熟练度 \+1 · 不计分/)).toBeVisible();
  await expect(page.getByText(/公共题答对 \d \/ 4 题/)).toBeVisible();
  await expect(page.locator(".tabular.text-4xl.font-bold.text-accent")).toHaveText(
    before.replace(/\s*分$/, "")
  );
});

/**
 * 当日题集一旦抽出即锁定（GAME-RULES §2.3）：刷新后必须还是同一批题。
 * 这是「无状态 + 全网同题」这条红线在客户端的落点。
 */
test("刷新不重抽：同日同领域得到同一份题", async ({ page }) => {
  await page.goto("/daily");
  await expectRound(page, 1);
  const firstStem = await page.locator("h2").first().innerText();

  await page.reload();
  await expectRound(page, 1);
  expect(await page.locator("h2").first().innerText()).toBe(firstStem);
});

/**
 * 跳过第 5 题：不惩罚、不强制答完，直接结算，且分数只按前 4 题。
 *
 * 验收点同时覆盖漏斗口径：跳过不能记成 `answered`（单测已测存储层，
 * 这里验证 UI 入口真的存在并能走到结算）。
 */
test("每日挑战：跳过第 5 题仍能结算，且分数不变", async ({ page }) => {
  await runPublicQuestions(page);
  await expectPracticePanel(page);

  const before = await page.locator(".tabular.font-semibold.text-accent").first().innerText();

  await page.getByRole("button", { name: /跳过这道加练题/ }).click();

  await expect(page.getByText("影子对手")).toBeVisible();
  await expect(page.getByText("加练题跳过了 · 不计分，也不影响排名")).toBeVisible();
  await expect(page.getByText(/公共题答对 \d \/ 4 题/)).toBeVisible();
  // 结算总分仍等于跳过前的分数（加练题从未计入）
  await expect(page.locator(".tabular.text-4xl.font-bold.text-accent")).toHaveText(
    before.replace(/\s*分$/, "")
  );

  // 漏斗：跳过只记 skipped，不记 answered。
  const funnel = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("tongshi-ju.daily."));
    return key ? JSON.parse(window.localStorage.getItem(key) ?? "null")?.practiceFunnel : null;
  });
  expect(funnel?.skipped).toBe(true);
  expect(funnel?.answered).toBe(false);
});

/**
 * NPC 点评的两条口径：
 * - 结算后按**最新事实**重新生成（开局那份是「一题未答」，不能冒充结算统计）；
 * - 刷新后从当日会话读回最后一份，点评不丢。
 *
 * 用 `page.route` 让点评文本携带请求里的答题总数：开局是 0 题，
 * 结算后必须是 5 题，否则说明面板还在用开局那份点评。
 */
test("NPC 点评：结算后按最新事实重算，刷新后仍在", async ({ page }) => {
  await page.route("**/api/npc/coach", async (route) => {
    const payload = route.request().postDataJSON() as {
      facts?: { attemptCounts?: Record<string, number> };
    };
    const attempts = Object.values(payload?.facts?.attemptCounts ?? {}).reduce(
      (sum, n) => sum + n,
      0
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        commentary: `复盘：答 ${attempts} 题。`,
        degraded: true,
        degradedReason: "e2e 构造的降级",
        rationale: "e2e 固定决策依据",
        domainOrder: ["gaming", "tech"],
        weights: { gaming: 1, tech: 0.5 },
        provider: null,
      }),
    });
  });

  await finishDaily(page);

  const panel = page.locator(".panel", { hasText: "老师 NPC" }).first();
  await expect(panel).toBeVisible();
  // 结算后重新生成：必须是 5 题，而不是开局那份的 0 题
  await expect(panel.getByText("复盘：答 5 题。")).toBeVisible();
  await expect(panel.getByText(/模型调用失败，已降级为确定性模板/)).toBeVisible();

  const before = (await panel.innerText()).trim();

  // 撤掉路由后刷新：锁定的已完成会话应直接读回最后一次点评，不再请求服务端。
  await page.unroute("**/api/npc/coach");
  await page.reload();

  const after = page.locator(".panel", { hasText: "老师 NPC" }).first();
  await expect(after).toBeVisible();
  await expect(after.getByText("复盘：答 5 题。")).toBeVisible();
  await expect(after.getByText(/模型调用失败，已降级为确定性模板/)).toBeVisible();
  expect((await after.innerText()).trim()).toBe(before);
});

/**
 * 点评三态：结算后**模板立刻可见**（pending），模型回来再替换（model）。
 *
 * 用 `page.route` 把模型响应挂住，制造真实的「模型还在生成」窗口：
 * - 点击「查看结算」到面板出现最新事实模板，必须在毫秒级；
 * - 此间不能出现任何「已降级」文案（模板先行 ≠ 失败）；
 * - 放行模型后替换为模型台词，刷新读到的是落盘的最终结果。
 */
test("NPC 点评：结算后模板立刻可见，模型回来再替换", async ({ page }) => {
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  await page.route("**/api/npc/coach", async (route) => {
    const payload = route.request().postDataJSON() as {
      facts?: { attemptCounts?: Record<string, number> };
    };
    const attempts = Object.values(payload?.facts?.attemptCounts ?? {}).reduce(
      (sum, n) => sum + n,
      0
    );
    // 挂住响应：结算页先展示模板（pending），直到本用例主动放行。
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        commentary: `模型台词：今天答了 ${attempts} 题。`,
        degraded: false,
        rationale: "e2e 模型决策依据",
        domainOrder: ["gaming", "tech"],
        weights: { gaming: 1, tech: 0.5 },
        provider: "e2e-stub",
      }),
    });
  });

  await runPublicQuestions(page);
  await expectPracticePanel(page);
  await answerCurrentQuestion(page);

  // 在浏览器里记录「点击查看结算 → 最新事实模板出现」的毫秒数。
  const pendingMs = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          const panel = Array.from(document.querySelectorAll(".panel")).find((p) =>
            p.textContent?.includes("老师 NPC")
          );
          if (panel && /答 5 错 \d/.test(panel.textContent ?? "")) {
            observer.disconnect();
            resolve(performance.now() - started);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      })
  );

  await page.getByRole("button", { name: /查看结算/ }).click();

  const panel = page.locator(".panel", { hasText: "老师 NPC" }).first();
  await expect(panel).toBeVisible();
  // 模板先行是毫秒级：不等模型也能看到基于最新事实的点评。
  expect(await pendingMs).toBeLessThan(500);
  await expect(panel.getByText("老师正在看你的错题…")).toBeVisible();
  await expect(panel.getByText(/答 5 错 \d/)).toBeVisible();
  // 模板先展示 ≠ 失败：此刻不能出现任何降级文案。
  await expect(panel).not.toContainText("已降级");

  const pendingText = (await panel.innerText()).trim();

  // 放行模型：回来后替换为模型台词，生成中与降级文案都消失。
  releaseGate();
  await expect(panel.getByText("模型台词：今天答了 5 题。")).toBeVisible({ timeout: 10_000 });
  await expect(panel).not.toContainText("老师正在看你的错题");
  await expect(panel).not.toContainText("已降级");
  expect((await panel.innerText()).trim()).not.toBe(pendingText);

  // 刷新：读到落盘的最终结果（model），不会退回 pending。
  await page.unroute("**/api/npc/coach");
  await page.reload();
  const after = page.locator(".panel", { hasText: "老师 NPC" }).first();
  await expect(after.getByText("模型台词：今天答了 5 题。")).toBeVisible();
  await expect(after.getByText("老师正在看你的错题…")).toHaveCount(0);
  await expect(after).not.toContainText("已降级");
});

/**
 * NPC 记忆：服务端没返回 memories（旧服务端 / 精简响应）时，
 * 客户端用同一纯函数本地回退，面板展示最多 2 条，刷新后从会话读回。
 */
test("NPC 记忆：本地回退展示 2 条，刷新后仍在", async ({ page }) => {
  await page.addInitScript((now: number) => {
    if (window.localStorage.getItem("tongshi-ju.npc-episodes")) return;
    const domains = [
      "anime",
      "auto",
      "coding",
      "film",
      "gaming",
      "history",
      "life",
      "literature",
      "mobile",
      "science",
      "tech",
      "travel",
    ];
    const episodes = [];
    for (const domain of domains) {
      for (let i = 0; i < 3; i++) {
        episodes.push({
          userId: "通识玩家",
          questionId: `${domain}-mem-${i}`,
          domain,
          topic: i === 0 ? "主机与PC" : `知识点${i}`,
          difficulty: 1,
          correct: i !== 0,
          at: now - (i + 1) * 86400000,
          importance: 10,
          importanceSource: "rule",
          importanceDegraded: false,
          lastAccessedAt: now - (i + 1) * 86400000,
        });
      }
    }
    window.localStorage.setItem("tongshi-ju.npc-episodes", JSON.stringify(episodes));
  }, Date.now());

  // 故意不返回 memories：走客户端本地回退。
  await page.route("**/api/npc/coach", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        commentary: "老师记得你。",
        degraded: false,
        rationale: "e2e 固定决策依据",
        domainOrder: ["gaming", "tech"],
        weights: { gaming: 1, tech: 0.5 },
        provider: "e2e-stub",
      }),
    });
  });

  await finishDaily(page);

  const panel = page.locator(".panel", { hasText: "老师 NPC" }).first();
  const rows = panel.locator('ul[aria-label="老师记得的事"] li');
  await expect(panel.getByText("老师记得你。")).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(/答错过|答对过/);
  const before = await rows.allInnerTexts();

  await page.unroute("**/api/npc/coach");
  await page.reload();

  const after = page.locator(".panel", { hasText: "老师 NPC" }).first();
  const afterRows = after.locator('ul[aria-label="老师记得的事"] li');
  await expect(afterRows).toHaveCount(2);
  expect(await afterRows.allInnerTexts()).toEqual(before);
});
