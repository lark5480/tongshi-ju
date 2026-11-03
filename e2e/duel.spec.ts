import { expect, test, type Page } from "@playwright/test";

import { currentRound, expectRound, waitAnswerableBeyond } from "./helpers";

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

test("duel：两个玩家走满 5 回合，末回合超时结算", async ({ browser }) => {
  // 前 4 回合由房主作答：答错要等服务端 deadline（最长 30s）+ feedback 3s + 倒计时；
  // 第 5 回合双方都不答，专门覆盖“无人答对 → 超时结算”路径。
  test.setTimeout(320_000);

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

    // 前 4 回合：每次提交后必须越过当前回合，且选项重新可点。
    // 这一步就是当年那个缺陷的守卫：本地提交态只跟 `round_start` 事件时，
    // 重连漏事件会让第 2 题起的选项永远点不动。连续 4 次比两回合更能防止“一次性巧合”。
    let round = firstRound;
    for (let i = 0; i < 4; i++) {
      await expect(host.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });
      await host.locator(".option-btn").first().click();
      round = await waitAnswerableBeyond(host, round);
    }

    // 第 5 回合：双方都不作答，等满足服务端 deadline 后进入结算。
    // 这同时覆盖“末回合超时 + 结算广播”，不再只验前两回合。
    await expectRound(host, 5);
    // 访客从未提交任何东西，也必须跟着 SSE 走完前 4 回合并进入第 5 题
    await expectRound(guest, 5);
    await expect(guest.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });

    await expect(host.getByText("对局结束")).toBeVisible({ timeout: 90_000 });
    await expect(guest.getByText("对局结束")).toBeVisible({ timeout: 90_000 });
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
