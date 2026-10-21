import { expect, test } from "@playwright/test";

/**
 * 到期错题的独立练习出口。
 *
 * 只断言流程与「待复习区清空」这类确定性结果，不断言具体对错 ——
 * 脚本点的是第一个选项，对错由题库内容决定，断言分数只会让用例跟着题库抖。
 */
test("错题复习：到期错题可独立练习，完成后不再待复习", async ({ page }) => {
  await page.addInitScript((now: number) => {
    if (window.localStorage.getItem("tongshi-ju.wrong")) return;
    window.localStorage.setItem(
      "tongshi-ju.wrong",
      JSON.stringify([
        {
          questionId: "gaming-0001",
          domain: "gaming",
          topic: "主机与PC",
          streak: 0,
          wrongCount: 1,
          ease: 2.5,
          lastWrongAt: now - 86400000,
          nextDueAt: now - 1000,
        },
      ])
    );
  }, Date.now());

  await page.goto("/wrong");
  await expect(page.getByText("该复习了")).toBeVisible();

  await page.getByRole("link", { name: /开始复习 1 题/ }).click();
  await expect(page).toHaveURL(/\/wrong\/practice$/);
  await expect(page.getByText("第 1 / 1 题")).toBeVisible();

  await page.locator(".option-btn").first().click();
  const confirm = page.getByRole("button", { name: /确认作答/ });
  if (await confirm.isVisible()) {
    await expect(confirm).toBeEnabled();
    await confirm.click();
  }
  await expect(page.getByText(/答对了|答错了/).first()).toBeVisible();

  await page.getByRole("button", { name: "完成复习" }).click();
  await expect(page.getByText("复习完成")).toBeVisible();

  await page.getByRole("link", { name: "返回错题本" }).click();
  await expect(page).toHaveURL(/\/wrong$/);
  await expect(page.getByText("该复习了")).toHaveCount(0);
});
