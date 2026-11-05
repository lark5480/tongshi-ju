import { expect, test, type Page } from "@playwright/test";

import { dayKey, shiftDay } from "@/lib/engine/date";
import { answerCurrentQuestion, advance, expectRound } from "./helpers";

/**
 * 结算后策略分支 —— 只断言确定性行为：
 * 计划即时出现、刷新仍在、昨日回执、switch-easy 改第 5 题、答题阶段不发 coach。
 */

const PUBLIC_QUESTIONS = 4;

async function mockNpc(page: Page): Promise<{ coachCalls: number }> {
  const state = { coachCalls: 0 };
  await page.route("**/api/npc/coach", async (route) => {
    state.coachCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        commentary: "今天先把弱项补上。",
        degraded: false,
        rationale: "e2e",
        domainOrder: ["gaming", "tech", "history"],
        weights: { gaming: 1 },
        provider: "e2e-stub",
      }),
    });
  });
  await page.route("**/api/npc/importance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ importance: 7, degraded: false }),
    });
  });
  return state;
}

async function runPublicQuestions(page: Page): Promise<void> {
  await page.goto("/daily");
  for (let round = 1; round <= PUBLIC_QUESTIONS; round++) {
    await expectRound(page, round);
    await answerCurrentQuestion(page);
    expect(await advance(page)).toBe(true);
  }
  await expectRound(page, PUBLIC_QUESTIONS + 1);
}

async function finishDaily(page: Page): Promise<void> {
  await page.goto("/daily");
  for (let round = 1; round <= 5; round++) {
    await page.locator(".option-btn").first().waitFor({ state: "visible" });
    await answerCurrentQuestion(page);
    const more = await advance(page);
    if (!more) break;
  }
  await expect(page.getByText("通识段位")).toBeVisible();
}

test("结算后三选一：计划立即出现，刷新仍在", async ({ page }) => {
  await mockNpc(page);
  let branchCalls = 0;
  await page.route("**/api/npc/branch", async (route) => {
    branchCalls += 1;
    await route.fulfill({ status: 404, body: "gone" });
  });

  await finishDaily(page);

  const card = page.locator(".panel", { hasText: "接下来怎么练？" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /继续补最弱项/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /换个轻松领域/ })).toBeVisible();
  await expect(card.getByRole("button", { name: "听老师安排" })).toBeVisible();

  await card.getByRole("button", { name: /继续补最弱项/ }).click();

  // 即时：没有“老师正在想”，直接是计划。
  await expect(card.getByText("已选择")).toBeVisible();
  await expect(card.getByText("继续补最弱项", { exact: true }).first()).toBeVisible();
  await expect(card.locator("ol li")).toHaveCount(2);
  await expect(card).not.toContainText("老师正在想");
  expect(branchCalls).toBe(0);

  const before = (await card.innerText()).trim();
  await page.reload();

  const after = page.locator(".panel", { hasText: "接下来怎么练？" }).first();
  await expect(after.getByText("已选择")).toBeVisible();
  await expect(after.locator("ol li")).toHaveCount(2);
  await expect(after.getByRole("button", { name: /继续补最弱项/ })).toHaveCount(0);
  expect((await after.innerText()).trim()).toBe(before);
});

test("次日回执 + switch-easy：第 5 题真的换轻松策略", async ({ page }) => {
  const yesterday = shiftDay(dayKey(), -1);
  const yesterdayChoice = {
    option: "switch-easy",
    label: "换个轻松领域",
    domain: "history",
    chosenAt: Date.now() - 86_400_000,
    reply: "行，接下来换「历史·文化」松一松。",
    replyStatus: "template",
    plan: {
      strategy: "switch-easy",
      title: "换个轻松领域",
      steps: ["下次加练换到「历史·文化」，只做难度 1", "先不碰「游戏」"],
      targetDomain: "history",
    },
  };

  await page.addInitScript(
    ({ date, choice }: { date: string; choice: unknown }) => {
      window.localStorage.setItem(
        "tongshi-ju.profile",
        JSON.stringify({
          name: "通识玩家",
          emoji: "🧠",
          domains: ["gaming", "tech", "history"],
          usedReroll: false,
          blindbox: false,
        })
      );
      window.localStorage.setItem(
        `tongshi-ju.daily.${date}`,
        JSON.stringify({
          date,
          domains: ["gaming", "tech", "history"],
          questionIds: ["q1", "q2", "q3", "q4", "q5"],
          done: true,
          score: 300,
          correct: 3,
          stars: 3,
          maxCombo: 2,
          scoringVersion: 2,
          choice,
        })
      );
      window.localStorage.setItem(
        "tongshi-ju.mastery",
        JSON.stringify({
          "gaming|经典作品": 0,
          "tech|操作系统": 2,
          "history|节日与习俗": 3,
        })
      );
      window.localStorage.setItem(
        "tongshi-ju.npc-episodes",
        JSON.stringify(
          ["gaming", "tech", "history"].map((domain, index) => ({
            userId: "通识玩家",
            questionId: `${domain}-seed`,
            domain,
            topic: "种子知识点",
            difficulty: 1,
            correct: index !== 0,
            at: Date.now() - (index + 1) * 86_400_000,
            importance: 8,
            importanceSource: "rule",
            importanceDegraded: false,
            lastAccessedAt: Date.now() - (index + 1) * 86_400_000,
          }))
        )
      );
    },
    { date: yesterday, choice: yesterdayChoice }
  );

  let seenPromise: { label?: string } | null = null;
  await page.route("**/api/npc/coach", async (route) => {
    const payload = route.request().postDataJSON() as { promise?: { label?: string } };
    seenPromise = payload.promise ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        commentary: "上次你选了换个轻松领域，今天先松一松。",
        degraded: false,
        rationale: "e2e",
        domainOrder: ["gaming", "tech", "history"],
        weights: {},
        provider: "e2e-stub",
      }),
    });
  });
  await page.route("**/api/npc/importance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ importance: 7, degraded: false }),
    });
  });

  await runPublicQuestions(page);

  // 第 5 题按昨日 switch-easy 选题，reason 带策略前缀。
  await expect(page.getByText("你的加练题")).toBeVisible();
  await expect(page.getByText(/按昨天约定：换轻松的/)).toBeVisible();

  await answerCurrentQuestion(page);
  expect(await advance(page)).toBe(false);

  const card = page.locator(".panel", { hasText: "接下来怎么练？" }).first();
  await expect(card.getByText(/昨天你说：换个轻松领域/)).toBeVisible();
  await expect(card.getByText(/今天加练：按昨天约定：换轻松的/)).toBeVisible();

  await expect.poll(() => seenPromise?.label).toBe("换个轻松领域");
});

test("答题阶段不发 coach；结算后只发一次", async ({ page }) => {
  const state = await mockNpc(page);
  await runPublicQuestions(page);
  expect(state.coachCalls).toBe(0);

  await answerCurrentQuestion(page);
  expect(await advance(page)).toBe(false);
  await expect.poll(() => state.coachCalls).toBe(1);
});

test("360px：选择卡与计划不横向溢出，按钮命中区 ≥44px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockNpc(page);

  await finishDaily(page);

  const card = page.locator(".panel", { hasText: "接下来怎么练？" }).first();
  await expect(card).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

  const buttons = card.getByRole("button");
  expect(await buttons.count()).toBe(3);
  for (let i = 0; i < 3; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await buttons.first().click();
  await expect(card.locator("ol li")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});
