import { expect, test, type Page } from "@playwright/test";

import { currentRound, waitAnswerableBeyond } from "./helpers";

/**
 * 同步抢答闭环 —— TESTING §5.3 的第 8、9 条。
 *
 * 这条用例存在的理由是那个真实缺陷：**房主答完第 1 题后，第 2 题起的选项永久禁用**
 * （本地提交态只跟着 `round_start` 事件重置，SSE 轮换重连会漏掉它）。
 * 所以核心断言不是"能不能打分"，而是**回合推进后选项重新可点**。
 *
 * 只让房主作答：访客沉默，避免双方同时提交产生 409 `round_locked` 的噪声。
 */
async function enterLobby(page: Page, name: string) {
  await page.goto("/duel");
  await page.locator("#duel-name").fill(name);
}

test("duel：两个玩家开局，连答两回合都能在下一回合点得动", async ({ browser }) => {
  // 一题答错时回合要等到服务端 deadline 才结算（最长 30s）+ feedback 3s + 倒计时 3s，
  // 两回合的余量必须给足，否则用例是在跟定时器抢时间。
  test.setTimeout(200_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await enterLobby(host, "房主甲");
    await host.getByRole("button", { name: "创建房间" }).click();
    await host.waitForURL(/\/duel\/room\/[A-HJ-NP-Z2-9]{4,8}/);
    const code = decodeURIComponent(host.url().split("/").pop() ?? "");
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4,8}$/);

    await enterLobby(guest, "访客乙");
    await guest.locator('input[aria-label="房间码"]').fill(code);
    await guest.getByRole("button", { name: "加入房间" }).click();
    await guest.waitForURL(/\/duel\/room\//);

    // 双方准备 → 房主开局
    await host.getByRole("button", { name: "我准备好了" }).click();
    await expect(host.getByRole("button", { name: "取消准备" })).toBeVisible();
    await guest.getByRole("button", { name: "我准备好了" }).click();
    await host.getByRole("button", { name: "开始对局" }).click();

    // ---- 开局后进入答题 ----
    const firstRound = await currentRound(host);
    expect(firstRound).toBeGreaterThanOrEqual(1);
    await expect(host.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });

    // 第 1 次提交 → 回合必须越过它，且选项重新可点。
    // 这一步就是当年那个缺陷的守卫：本地提交态只跟 `round_start` 事件时，
    // 重连漏事件会让第 2 题起的选项永远点不动。
    await host.locator(".option-btn").first().click();
    const afterFirst = await waitAnswerableBeyond(host, firstRound);

    // 同一守卫再验一次：连续第二次提交后仍能推进（不是一次性巧合）。
    // 不断言「提交后选项立刻变灰」—— 答对时服务端立即结算、题目卡被反馈面板换掉，
    // 那种断言只在"答错"分支成立，用例就成了掷骰子。
    await host.locator(".option-btn").first().click();
    await waitAnswerableBeyond(host, afterFirst);

    // 访客从未提交任何东西，也必须跟着 SSE 走到第 2 题之后 —— 广播漏了就是实时链路坏了
    expect(await currentRound(guest)).toBeGreaterThan(firstRound);
    await expect(guest.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/** 房间码在两个入口的口径：加入前先探测，不可加入时给明确原因而不是 200。 */
test("加入探测：不存在的房间返回 404", async ({ request }) => {
  const res = await request.get("/api/rooms/ZZZZZZ/join");
  expect(res.status()).toBe(404);
  expect((await res.json()).code).toBe("room_not_found");
});
