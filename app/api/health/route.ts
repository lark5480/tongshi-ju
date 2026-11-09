import { ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * 容器 / 平台探活。
 *
 * 只暴露版本与「AI 是否配置」的布尔值，绝不返回 Key、Base URL 或模型名。
 */
export async function GET() {
  return ok({
    ok: true,
    version: process.env.npm_package_version ?? "unknown",
    aiConfigured: Boolean(process.env.AI_API_BASE && process.env.AI_API_MODEL),
  });
}
