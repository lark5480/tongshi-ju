import { expect, test, type Page } from "@playwright/test";

/**
 * 本周老师周报 —— 只断言确定性结果：
 * - 有本周数据时展示聚合数字与回顾；
 * - 降级必须显式标注；
 * - 数据没变时第二次进入不再请求（缓存）；
 * - 空周零请求。
 */

/** 在浏览器里按 Asia/Shanghai 取今天，播种“本周”数据。 */
async function seedWeek(page: Page, options: { withSession: boolean }): Promise<void> {
  await page.addInitScript((withSession: boolean) => {
    if (window.localStorage.getItem("tongshi-ju.history")) return;

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // 战绩页需要至少一条记录才渲染主体；空周用例用一条旧记录占位。
    window.localStorage.setItem(
      "tongshi-ju.history",
      JSON.stringify([
        {
          date: withSession ? today : "2020-01-01",
          domains: ["gaming", "tech"],
          score: 300,
          correct: 3,
          total: 4,
          stars: 3,
          maxCombo: 2,
          mode: "daily",
          scoringVersion: 2,
        },
      ])
    );

    if (!withSession) return;

    window.localStorage.setItem(
      `tongshi-ju.daily.${today}`,
      JSON.stringify({
        date: today,
        domains: ["gaming", "tech"],
        questionIds: ["q1", "q2", "q3", "q4"],
        done: true,
        score: 300,
        correct: 3,
        stars: 3,
        maxCombo: 2,
        scoringVersion: 2,
        practiceFunnel: {
          shown: true,
          answered: true,
          correct: true,
          skipped: false,
          resultSeen: true,
        },
      })
    );

    window.localStorage.setItem(
      "tongshi-ju.npc-episodes",
      JSON.stringify([
        {
          userId: "通识玩家",
          questionId: "gaming-mem-1",
          domain: "gaming",
          topic: "主机与PC",
          difficulty: 1,
          correct: false,
          at: Date.now() - 86400000,
          importance: 10,
          importanceSource: "rule",
          importanceDegraded: false,
          lastAccessedAt: Date.now() - 86400000,
        },
        {
          userId: "通识玩家",
          questionId: "gaming-mem-2",
          domain: "gaming",
          topic: "手游",
          difficulty: 1,
          correct: false,
          at: Date.now() - 2 * 86400000,
          importance: 10,
          importanceSource: "rule",
          importanceDegraded: false,
          lastAccessedAt: Date.now() - 2 * 86400000,
        },
      ])
    );
  }, options.withSession);
}

test("本周周报：展示本周聚合与回顾", async ({ page }) => {
  await seedWeek(page, { withSession: true });
  let calls = 0;

  await page.route("**/api/npc/weekly", async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "本周答对 3/4，游戏域还需要补两次。",
        degraded: false,
        provider: "e2e-stub",
        templateText: "本周完成 1 次每日挑战，答对 3/4 题（75%）。",
      }),
    });
  });

  await page.goto("/history");

  const card = page.locator(".panel", { hasText: "本周老师周报" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("挑战 1 次")).toBeVisible();
  await expect(card.getByText("答对 3/4", { exact: true })).toBeVisible();
  await expect(card.getByText("正确率 75%")).toBeVisible();
  await expect(card.getByText("本周答对 3/4，游戏域还需要补两次。")).toBeVisible();
  await expect(card.getByText("本周最需要补：游戏")).toBeVisible();
  await expect(card.getByText("AI 回顾")).toBeVisible();
  expect(calls).toBe(1);

  // 数据没变：刷新命中本地缓存，不再请求模型。
  await page.reload();
  await expect(
    page
      .locator(".panel", { hasText: "本周老师周报" })
      .first()
      .getByText("本周答对 3/4，游戏域还需要补两次。")
  ).toBeVisible();
  expect(calls).toBe(1);
});

test("本周周报：模型降级时显式标注模板", async ({ page }) => {
  await seedWeek(page, { withSession: true });

  await page.route("**/api/npc/weekly", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "本周完成 1 次每日挑战，答对 3/4 题（75%）。",
        degraded: true,
        degradedReason: "e2e 构造的降级",
        provider: null,
        templateText: "本周完成 1 次每日挑战，答对 3/4 题（75%）。",
      }),
    });
  });

  await page.goto("/history");

  const card = page.locator(".panel", { hasText: "本周老师周报" }).first();
  await expect(card.getByText("模板回顾")).toBeVisible();
  await expect(card.getByText(/模型调用失败，已降级为确定性模板/)).toBeVisible();
  await expect(card.getByText("本周完成 1 次每日挑战，答对 3/4 题（75%）。")).toBeVisible();
});

test("本周周报：空周不发请求，给出去挑战入口", async ({ page }) => {
  await seedWeek(page, { withSession: false });
  let calls = 0;

  await page.route("**/api/npc/weekly", async (route) => {
    calls += 1;
    await route.fulfill({ status: 500, body: "should not be called" });
  });

  await page.goto("/history");

  const card = page.locator(".panel", { hasText: "本周老师周报" }).first();
  await expect(card.getByText("本周还没开始。")).toBeVisible();
  await expect(card.getByRole("link", { name: /去做今日挑战/ })).toBeVisible();
  expect(calls).toBe(0);
});
