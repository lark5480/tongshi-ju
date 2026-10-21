import { expect, test } from "@playwright/test";

/**
 * 窄屏不横向溢出 —— 手机是唯一真实的使用场景（README 的第一句就是"每天 3 分钟"）。
 *
 * 判据用文档自身的滚动宽度，不看截图：`scrollWidth > clientWidth` 就意味着
 * 页面上有一条横向滚动条，那是排版漏了（曾经栽在 `flex-1` 输入框不肯收缩，
 * 见 docs/design/ui-system.md §2.6 的 44px / 8px 底线）。
 */
const ROUTES = ["/", "/daily", "/domains", "/pk", "/duel", "/map", "/wrong", "/history"];

for (const route of ROUTES) {
  test(`${route} 在 360px 宽度下不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(route);
    // 等首屏数据落地（localStorage 读取 + 抽题），否则量到的是骨架
    await expect(page.locator("main")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

/** 触屏命中区底线：主路径按钮与选项 ≥44px。 */
test("44px 命中区：选项与按钮不低于底线", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/daily");
  await expect(page.locator(".option-btn").first()).toBeVisible();

  const heights = await page
    .locator(".option-btn")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
