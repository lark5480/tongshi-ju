/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * 构建产物目录 —— 三套互不重叠，**dev / build / e2e 绝不共用同一个目录**。
   *
   * | 场景 | 目录 | 谁在用 |
   * |---|---|---|
   * | `npm run dev` | `.next-dev` | 开发服务器 |
   * | `npm run build` / `npm start` | `.next` | 生产构建 |
   * | `npm run test:e2e` | `.next-e2e` | e2e 的 dev 服务器 |
   * | `play-online.ps1` | `.next-online` | 联机通道 |
   *
   * ## 为什么必须分开
   *
   * `next dev` 与 `next build` 共用同一个目录会**互相覆盖**：build 冲掉 dev 的 chunk，
   * 表现为「部分页面 500 Internal Server Error」。
   *
   * 反过来也成立：dev 启动时若 `.next` 里躺着上一次的生产构建，
   * 首个请求要先跟它和解 —— 实测**首请求 112 秒**（本地表现为「打开页面半天不出来」）。
   *
   * `NEXT_DIST_DIR` 可显式覆盖（e2e 与联机通道就是这么指定目录的）。
   */
  distDir:
    process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
};

export default nextConfig;
