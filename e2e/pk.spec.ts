import { expect, test } from "@playwright/test";

import { advance, answerCurrentQuestion, expectRound } from "./helpers";

/**
 * 同题 PK —— TESTING §5.3 的第 5 条 + PRD §5.4 的验收标准。
 *
 * 「同一个码 = 同一份题」这件事的可自动化部分：
 * 今日推荐码必须是 4–6 位、可直接使用，打完 5 题的结算页必须带上那个码
 * （成绩卡逐格对账全靠它）。
 */
test("PK：用今日推荐码打完 5 题，结算带码", async ({ page }) => {
  await page.goto("/pk");

  const codeInput = page.locator("#pk-code");
  await page.getByRole("button", { name: "使用" }).click();
  const code = await codeInput.inputValue();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4,6}$/);

  await page.getByRole("button", { name: /开始同题 PK/ }).click();

  for (let round = 1; round <= 5; round++) {
    await expectRound(page, round);
    await answerCurrentQuestion(page);
    if (round < 5) await advance(page);
  }

  await page.getByRole("button", { name: "查看结算" }).click();
  await expect(page.getByText("把成绩卡发给对方")).toBeVisible();
  await expect(page.getByText(new RegExp(`PK ${code}`))).toBeVisible();

  await page.getByRole("button", { name: /生成成绩卡/ }).click();
  await expect(page.locator('img[src^="data:image/png"]')).toBeVisible();
});

/** 换一个码就是另一份题 —— 「码参与种子」这条规则的可观测面。 */
test("PK：换码后题目不同", async ({ page }) => {
  const stemFor = async (code: string) => {
    await page.goto("/pk");
    await page.locator("#pk-code").fill(code);
    await page.getByRole("button", { name: /开始同题 PK/ }).click();
    await expect(page.locator("h2").first()).toBeVisible();
    return page.locator("h2").first().innerText();
  };

  const a = await stemFor("ABCD");
  const b = await stemFor("WXYZ");
  expect(a).not.toBe(b);
});
