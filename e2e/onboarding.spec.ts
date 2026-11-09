import { expect, test } from "@playwright/test";

const FIRST_RUN_TITLE = "先花 10 秒，给自己起个名字";

test("首启：设置昵称与领域并持久化", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: FIRST_RUN_TITLE })).toBeVisible();

  await page.getByLabel("昵称").fill("阿龙");
  await page.getByRole("button", { name: "选择游戏领域" }).click();
  await page.getByRole("button", { name: "选择科技领域" }).click();
  await page.getByRole("button", { name: "保存并开始" }).click();

  await expect(page.getByRole("heading", { name: /阿龙/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: FIRST_RUN_TITLE })).toHaveCount(0);

  const saved = await page.evaluate(() => {
    const raw = window.localStorage.getItem("tongshi-ju.profile");
    return raw ? (JSON.parse(raw) as { name?: string; domains?: string[] }) : null;
  });
  expect(saved?.name).toBe("阿龙");
  expect(saved?.domains).toEqual(["gaming", "tech"]);

  await page.reload();
  await expect(page.getByRole("heading", { name: /阿龙/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: FIRST_RUN_TITLE })).toHaveCount(0);
});

test("首启：随缘开局跳过设置，刷新后不再出现", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "随缘开局" }).click();

  await expect(page.getByRole("heading", { name: FIRST_RUN_TITLE })).toHaveCount(0);
  await expect(page.getByText("随缘三域")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: FIRST_RUN_TITLE })).toHaveCount(0);
});

test("首页：编辑资料可改名并写回档案", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "随缘开局" }).click();
  await page.getByRole("button", { name: "编辑资料" }).click();

  await page.getByLabel("昵称").fill("阿龙");
  await page.getByRole("button", { name: "选择游戏领域" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.getByRole("heading", { name: /阿龙/ })).toBeVisible();
  const savedName = await page.evaluate(() => {
    const raw = window.localStorage.getItem("tongshi-ju.profile");
    return raw ? (JSON.parse(raw) as { name?: string }).name : null;
  });
  expect(savedName).toBe("阿龙");
});
