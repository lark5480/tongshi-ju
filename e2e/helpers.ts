import { expect, type Page } from "@playwright/test";

/** 只读比分条上的题号与总题数；不判断相位（大厅/倒计时也渲染同一标签）。 */
async function roundLabel(page: Page): Promise<{ round: number; total: number }> {
  const label = await page
    .getByText(/第 \d+ \/ \d+ 题/)
    .first()
    .innerText();
  const m = label.match(/第 (\d+) \/ (\d+) 题/);
  if (!m) throw new Error(`回合标签解析失败：${label}`);
  return { round: Number(m[1]), total: Number(m[2]) };
}

/**
 * 读当前停在第几题，且只在**答题阶段**读。
 *
 * 大厅/倒计时阶段也会渲染「第 N / M 题」，早读会把已被服务端截止时间
 * 越过的回合当成第 1 题，后续按固定次数推进就会落到"等第 6 题"。
 * 先等第一个选项出现，再读标签。
 */
export async function currentRound(page: Page, timeout = 40_000): Promise<number> {
  await page.locator(".option-btn").first().waitFor({ state: "visible", timeout });
  return (await roundLabel(page)).round;
}

/** 答题阶段读题号与总题数，供用例按服务端下发的总题数推进，而不是写死次数。 */
export async function roundProgress(
  page: Page,
  timeout = 40_000
): Promise<{ round: number; total: number }> {
  await page.locator(".option-btn").first().waitFor({ state: "visible", timeout });
  return roundLabel(page);
}

/** 对局是否已进入结算（结算面板只在 finished 相位渲染）。 */
async function isFinished(page: Page): Promise<boolean> {
  return page
    .getByText("对局结束")
    .isVisible()
    .catch(() => false);
}

/**
 * 等回合**越过**某一题，或对局直接结束 —— duel 用的判据。
 *
 * 对战房间不能断言"正好第 N 题"：回合推进由服务端定时器决定，
 * 答对时立即结算、无人答对时要等满截止时间，用例自己的耗时也在变 ——
 * 断言精确题号必然竞态（实测会一路冲到第 4 题）。
 * 真正要守卫的是**单调推进 + 提交态被清掉**：回合号变大，且选项重新可点。
 *
 * 末回合超时后不会再出现「第 6 题」，所以也必须把「结算」当作合法终止态，
 * 否则最后会一直等到超时。
 */
export async function waitAdvanceOrFinish(
  page: Page,
  from: number,
  timeout = 90_000
): Promise<"advanced" | "finished"> {
  await expect
    .poll(
      async () => {
        if (await isFinished(page)) return "finished";
        // 结算/反馈阶段没有选项，此时读到的题号还是上一题，先跳过。
        if ((await page.locator(".option-btn").count()) === 0) return "waiting";
        const { round } = await roundLabel(page);
        return round > from ? "advanced" : "waiting";
      },
      { timeout, message: `既没越过第 ${from} 题，也没进入结算` }
    )
    .not.toBe("waiting");

  if (await isFinished(page)) return "finished";
  await expect(page.locator(".option-btn").first()).toBeEnabled({ timeout: 30_000 });
  return "advanced";
}

/**
 * 断言当前停在第几题。
 *
 * 不用 `^…$` 锚定：答题页的回合标签里嵌着模式名
 * （实际文本是「第 1 / 5 题盲盒轮转」），锚定正则会稳定失配。
 *
 * 超时给到 50s：duel 的回合是服务端定时器驱动的 —— 本回合无人答对时要等满
 * 20–30s 的截止时间才推进，用配置里 10s 的默认断言超时必然偶发失配。
 */
export async function expectRound(page: Page, round: number): Promise<void> {
  await expect(page.getByText(new RegExp(`第 ${round} / \\d+ 题`)).first()).toBeVisible({
    timeout: 50_000,
  });
}

/**
 * 答掉当前这一题。
 *
 * 多选题必须先勾两项再点「确认作答」，单选 / 判断直接点选项 ——
 * 三种题型都要能提交，因为**多选题曾经永远提交不了**（见 docs/TESTING.md §5.4）。
 */
export async function answerCurrentQuestion(page: Page): Promise<void> {
  const options = page.locator(".option-btn");
  await options.first().waitFor({ state: "visible" });

  const confirm = page.getByRole("button", { name: /确认作答/ });
  if (await confirm.isVisible()) {
    await options.nth(0).click();
    await options.nth(1).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
  } else {
    await options.first().click();
  }

  // 反馈三线索：颜色由 data-state 承担，这里断言「图标 + 文案」与解析面板
  await expect(page.getByText(/答对了|答错了/).first()).toBeVisible();
  await expect(page.locator(".panel", { hasText: "正确答案" }).first()).toBeVisible();
}

/**
 * 点「下一题」；最后一题点「查看结算」。
 * @returns 是否还进入了下一题（false 表示已去结算）
 */
export async function advance(page: Page): Promise<boolean> {
  const next = page.getByRole("button", { name: /^(下一题|查看结算)$/ });
  const label = (await next.innerText()).trim();
  await next.click();
  return label !== "查看结算";
}

/** 答完整套题，停在结算页。`rounds` 是套题总数。 */
export async function answerWholeSet(page: Page, rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await answerCurrentQuestion(page);
    const more = await advance(page);
    if (!more) return;
  }
  throw new Error(`答了 ${rounds} 题仍没到结算页`);
}

/** 等某一回合进入可作答状态（选项存在且未被禁用）。 */
export async function waitAnswerable(page: Page, round: number): Promise<void> {
  await expect(page.getByText(new RegExp(`第 ${round} / \\d+ 题`))).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.locator(".option-btn").first()).toBeEnabled({ timeout: 40_000 });
}
