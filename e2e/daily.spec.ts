import { expect, test, type Page } from "@playwright/test";

import { findQuestion } from "@/lib/content/server-bank";
import { advance, answerCurrentQuestion, expectRound } from "./helpers";

/** 4+1 分轨：前 4 题是全网同题的公共题，第 5 题是个人加练（不计分）。 */
const PUBLIC_QUESTIONS = 4;

/** 从当日会话里取第 5 题 id —— 题库答案只在服务端侧可读，用它定位正确选项。 */
async function practiceQuestionId(page: Page): Promise<string> {
  const session = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("tongshi-ju.daily."));
    if (!key) return null;
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      questionIds?: string[];
    } | null;
  });
  const id = session?.questionIds?.[PUBLIC_QUESTIONS];
  if (!id) throw new Error("当日会话里没有第 5 题");
  return id;
}

/** 跑完 4 道公共题，停在加练题。 */
async function runPublicQuestions(page: Page): Promise<void> {
  await page.goto("/daily");
  for (let round = 1; round <= PUBLIC_QUESTIONS; round++) {
    await expectRound(page, round);
    await answerCurrentQuestion(page);
    expect(await advance(page)).toBe(true);
  }
  await expectRound(page, PUBLIC_QUESTIONS + 1);
}

/** 加练题存在时，答题页必须写明「你的加练题」与「不计分、不计排名」。 */
async function expectPracticePanel(page: Page): Promise<void> {
  await expect(page.getByText("你的加练题")).toBeVisible();
  await expect(page.getByText(/这道题不计分、不计排名/)).toBeVisible();
}

/**
 * 按题库答案作答加练题。
 *
 * 脚本点第一个选项只能碰运气答对，要断言「熟练度 +1」就必须拿到正确答案 ——
 * 答案不在客户端会话里，只能从服务端题库按会话里的题目 id 反查。
 */
async function answerPracticeCorrectly(page: Page, questionId: string): Promise<void> {
  const question = findQuestion(questionId);
  if (!question) throw new Error(`题库里找不到第 5 题 ${questionId}`);
  await expect(page.locator("h2").first()).toHaveText(question.stem);

  const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
  for (const answer of answers) {
    await page.locator(".option-btn").getByText(answer, { exact: true }).click();
  }
  const confirm = page.getByRole("button", { name: /确认作答/ });
  if (await confirm.isVisible()) await confirm.click();

  await expect(page.getByText(/答对了/).first()).toBeVisible();
  await expect(page.locator(".panel", { hasText: "正确答案" }).first()).toBeVisible();
}

/** 答完 4 公共题 + 1 加练，停在结算页。 */
async function finishDaily(page: Page): Promise<void> {
  await runPublicQuestions(page);
  await expectPracticePanel(page);
  await answerCurrentQuestion(page);
  expect(await advance(page)).toBe(false);
}

/**
 * 每日挑战闭环 —— TESTING §5.3 的第 1～4 条（4+1 分轨）。
 *
 * 只断言**确定性**的东西：反馈出现、解析出现、结算条目为 5。
 * 不断言分数值 —— 脚本点的是第一个选项，对错不由脚本决定，
 * 断言具体分数只会让用例跟着题库内容一起抖。
 * 但「只有前 4 题计分」是可确定的结构事实，必须显式断言。
 */
test("每日挑战：4 公共题 + 1 加练 → 结算 → 成绩卡出图", async ({ page }) => {
  await finishDaily(page);

  await expect(page.getByText("影子对手")).toBeVisible();
  await expect(page.getByText("通识段位")).toBeVisible();
  // 满分口径按 4 道公共题
  await expect(page.getByText(/公共题答对 \d \/ 4 题/)).toBeVisible();

  // 逐题回顾 5 条，但只有 4 条带「N 分」；第 5 条明确标「不计分」
  await expect(page.getByText(/^(\d+ 分|不计分)$/)).toHaveCount(PUBLIC_QUESTIONS + 1);
  await expect(page.getByText(/^\d+ 分$/)).toHaveCount(PUBLIC_QUESTIONS);
  await expect(page.getByText("不计分", { exact: true })).toHaveCount(1);
  await expect(page.getByText("加练 · 不计分")).toBeVisible();

  await page.getByRole("button", { name: /生成成绩卡/ }).click();
  await expect(page.locator('img[src^="data:image/png"]')).toBeVisible();
});

/**
 * 加练题不计分 —— PRD §4.5 的验收点。
 *
 * 答对加练题只写熟练度（结算页给出「熟练度 +1 · 不计分」），
 * 分数在作答前后必须一字不变，结算总分也只按前 4 题算。
 */
test("每日挑战：加练题答对只写熟练度，不改分数", async ({ page }) => {
  await runPublicQuestions(page);
  await expectPracticePanel(page);

  // 进入加练题时的分数（只含前 4 题）
  const before = await page.locator(".tabular.font-semibold.text-accent").first().innerText();

  await answerPracticeCorrectly(page, await practiceQuestionId(page));

  // 答对加练题后，答题页上的分数不变
  await expect(page.locator(".tabular.font-semibold.text-accent").first()).toHaveText(before);

  expect(await advance(page)).toBe(false);

  // 结算页：反馈文案显式写「熟练度 +1 · 不计分」，总分仍只等于前 4 题
  await expect(page.getByText(/熟练度 \+1 · 不计分/)).toBeVisible();
  await expect(page.getByText(/公共题答对 \d \/ 4 题/)).toBeVisible();
  await expect(page.locator(".tabular.text-4xl.font-bold.text-accent")).toHaveText(
    before.replace(/\s*分$/, "")
  );
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
