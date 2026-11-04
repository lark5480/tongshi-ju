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
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // duel 用例要在同一房间里跑两个玩家，且回合推进靠服务端定时器 —— 并发跑只会互相踩。
  fullyParallel: false,
  workers: 1,
  retries: IS_CI ? 1 : 0,
  forbidOnly: IS_CI,
  reporter: IS_CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 本地（非 CI）继续用 next dev：改一行代码就生效，调试顺手。
    // CI 改跑**生产构建产物**（next build + next start）：dev 服务器在冷启动 runner 上
    // 首个请求要先编译，duel 用例曾因此在 40s 内看不到选项 → flaky。
    // 构建由 .github/workflows/ci.yml 的 `Build for e2e` 步骤完成，两侧共用 NEXT_DIST_DIR。
    command: IS_CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    // Playwright 轮询 url 直到服务就绪，然后才开始跑用例。
    url: baseURL,
    // e2e 用**自己的**产物目录：不与本机开发服务器（.next-dev）、生产构建（.next）共用，
    // 否则两边同时写一个目录会互相覆盖，e2e 还会被脏目录拖慢（首请求实测可到 112 秒）。
    env: { ...process.env, NEXT_DIST_DIR: ".next-e2e" },
    // 本机允许复用已在跑的服务；CI 必须自己起，否则端口上是别人的东西
    reuseExistingServer: !IS_CI,
    // Windows 本机首次 `next dev` 冷启动要 1~2 分钟（Defender 扫描构建目录），
    // 300s 留足余量；CI 的 Linux runner 冷启动十几秒，不受影响。
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
