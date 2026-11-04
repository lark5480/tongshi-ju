import { expect, test, type Page } from "@playwright/test";

import { currentRound, roundProgress, waitAdvanceOrFinish } from "./helpers";

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

/** 结算等待上限：末回合最长 30s 作答 + 3s 反馈，再留重连与慢机余量；条件满足即返回。 */
const RESULT_TIMEOUT_MS = 120_000;

test("duel：两个玩家走满 5 回合，末回合超时结算", async ({ browser }) => {
  // 前 4 回合由房主作答：答错要等服务端 deadline（最长 30s）+ feedback 3s + 倒计时；
  // 第 5 回合双方都不答，专门覆盖“无人答对 → 超时结算”路径。
  test.setTimeout(420_000);

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
    // 等房主侧收到访客的准备状态再开局：否则 start 可能被服务端按「未全部准备」拒绝，
    // 页面留在准备大厅，后续只会表现为“选项一直没出现”。
    await expect(host.getByText("已准备")).toHaveCount(2, { timeout: 40_000 });
    await host.getByRole("button", { name: "开始对局" }).click();

    // ---- 开局后进入答题 ----
    // 先等选项出现再读题号：大厅/倒计时也会渲染「第 N / M 题」，
    // 早读会把已被服务端 deadline 越过的回合当成第 1 题，后面就会多推一回合。
    let { round, total } = await roundProgress(host);
    expect(round).toBeGreaterThanOrEqual(1);

    // 前 total-1 回合：每次提交后必须越过当前回合，且选项重新可点。
    // 这一步就是当年那个缺陷的守卫：本地提交态只跟 `round_start` 事件时，
    // 重连漏事件会让第 2 题起的选项永远点不动；连打多回合能防止“一次性巧合”。
    // 按服务端下发的总题数推进，不写死次数，避免末回合后还在等「第 6 题」。
    while (round < total) {
      await expect(host.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });
      await host.locator(".option-btn").first().click();
      const outcome = await waitAdvanceOrFinish(host, round);
      expect(outcome, `第 ${round} / ${total} 题尚未走完却已结算`).toBe("advanced");
      ({ round, total } = await roundProgress(host));
    }

    // 第 total 回合：双方都不作答，等满足服务端 deadline 后进入结算。
    // 这里等的是「结算面板出现」这个条件，超时值只是上限，不是固定等待时长。
    await expect(guest.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });
    // 访客从未提交任何东西，也必须跟着 SSE 走完前几回合并进入末回合
    await expect
      .poll(() => currentRound(guest), { timeout: 60_000, message: "访客没跟上末回合" })
      .toBe(total);

    await expect(host.getByText("对局结束")).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
    await expect(guest.getByText("对局结束")).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
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
