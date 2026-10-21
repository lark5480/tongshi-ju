import { expect, test, type Page } from "@playwright/test";

import { advance, answerCurrentQuestion, expectRound } from "./helpers";

/** 答完 5 题并进入结算页。 */
async function finishDaily(page: Page) {
  await page.goto("/daily");
  for (let round = 1; round <= 5; round++) {
    await expectRound(page, round);
    await answerCurrentQuestion(page);
    if (round < 5) await advance(page);
  }
  await page.getByRole("button", { name: "查看结算" }).click();
}

/**
 * 每日挑战闭环 —— TESTING §5.3 的第 1～4 条。
 *
 * 只断言**确定性**的东西：反馈出现、解析出现、结算条目为 5。
 * 不断言分数值 —— 脚本点的是第一个选项，对错不由脚本决定，
 * 断言具体分数只会让用例跟着题库内容一起抖。
 */
test("每日挑战：5 题答完 → 结算 → 成绩卡出图", async ({ page }) => {
  await finishDaily(page);

  await expect(page.getByText("影子对手")).toBeVisible();
  await expect(page.getByText("通识段位")).toBeVisible();
  await expect(page.getByText(/答对 \d \/ 5 题/)).toBeVisible();

  // 逐题回顾必须 5 条（每条一个「N 分」标记）—— 少一条就是结算页漏了题
  await expect(page.getByText(/^\d+ 分$/)).toHaveCount(5);

  await page.getByRole("button", { name: /生成成绩卡/ }).click();
  await expect(page.locator('img[src^="data:image/png"]')).toBeVisible();
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
