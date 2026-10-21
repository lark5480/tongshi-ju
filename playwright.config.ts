import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端冒烟配置 —— 钉住 [`docs/TESTING.md`](../docs/TESTING.md) §5.3 的人工清单。
 *
 * 存在理由：`node --test` 打到的是服务端与纯函数层，React hook 与页面是盲区。
 * 已经咬过三口（单选题点不动、duel 第 2 题起选项永久禁用、多选确认作答静默失败），
 * 全部是"单测全绿但玩家玩不了"。
 *
 * 本机：默认用 Playwright 自带的 chromium；没有下载浏览器时可 `PW_CHANNEL=msedge` 走已装的 Edge。
 * CI：`npx playwright install --with-deps chromium` 后用默认通道。
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // duel 用例要在同一房间里跑两个玩家，且回合推进靠服务端定时器 —— 并发跑只会互相踩。
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: baseURL,
    // 本机允许复用已在跑的 dev 服务；CI 必须自己起，否则端口上是别人的东西
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
