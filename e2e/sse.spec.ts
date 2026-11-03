import { expect, test } from "@playwright/test";

/**
 * SSE 重连闭环 —— 不再只靠人看。
 *
 * 场景：
 * 1. 第一次流返回 `rotate` 后关闭 → 客户端必须立即重连（主动轮换）；
 * 2. 第二次流直接关闭 → 客户端必须走退避重连（异常断开）。
 *
 * 用路由拦截伪造 SSE，避免真的等 100s 轮换定时器；服务端轮换常量本身由
 * `lib/store/constants.ts` 锁定，这里验的是客户端收到 `rotate` / EOF 后会不会再连。
 */
test("SSE：主动轮换与异常断开都会触发重连", async ({ page, request }) => {
  test.setTimeout(60_000);

  const created = await request.post("/api/rooms", {
    data: { name: "轮换测试", emoji: "🧠", domains: ["gaming"] },
  });
  expect(created.status()).toBe(201);
  const cred = (await created.json()) as { code: string; playerId: string };

  const snapshotRes = await request.get(`/api/rooms/${cred.code}?playerId=${cred.playerId}`);
  expect(snapshotRes.ok()).toBeTruthy();
  const { room } = (await snapshotRes.json()) as { room: unknown };

  const stateFrame = `event: state\ndata: ${JSON.stringify({ type: "state", room })}\n\n`;
  const rotateFrame = "event: rotate\ndata: {}\n\n";

  let calls = 0;
  await page.route(new RegExp(`/api/rooms/${cred.code}/stream`), async (route) => {
    calls += 1;
    // #1 主动轮换；#2 模拟异常 EOF；#3 之后继续给 state，避免测试结束前无限空转
    const body =
      calls === 1 ? stateFrame + rotateFrame : calls === 2 ? stateFrame : stateFrame + rotateFrame;
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
      body,
    });
  });

  await page.goto("/duel");
  await page.evaluate(
    ([code, playerId]) => localStorage.setItem(`tongshi-ju.playerId.${code}`, playerId),
    [cred.code, cred.playerId] as const
  );
  await page.goto(`/duel/room/${cred.code}`);

  await expect(page.getByRole("button", { name: "我准备好了" })).toBeVisible();
  await expect.poll(() => calls, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
});
