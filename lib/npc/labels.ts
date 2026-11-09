/**
 * NPC 降级文案的唯一来源。
 *
 * 日报点评、结算分支、周报三处曾各写一份，容易出现「安全过滤」被说成
 * 「模型调用失败」的误导。这里按降级原因分类，界面只负责选日报/周报措辞。
 */

type DegradedKind = "not_configured" | "blocked" | "too_long" | "injection" | "timeout" | "failure";

function kindOf(reason?: string): DegradedKind {
  if (!reason) return "not_configured";
  if (reason.includes("未配置")) return "not_configured";
  if (reason.includes("敏感") || reason.includes("安全")) return "blocked";
  if (reason.includes("超长")) return "too_long";
  if (reason.includes("注入")) return "injection";
  if (reason.includes("超时")) return "timeout";
  return "failure";
}

function suffix(kind: DegradedKind, reason: string | undefined, tail: string): string {
  switch (kind) {
    case "not_configured":
      return `未配置模型，${tail}`;
    case "blocked":
      return `模型输出未通过内容安全检查，${tail}`;
    case "too_long":
      return `模型输出超长，${tail}`;
    case "injection":
      return `模型输出包含疑似提示注入内容，${tail}`;
    case "timeout":
      return `模型超时，${tail}`;
    case "failure":
      return `模型调用失败，${tail}：${reason ?? "未知原因"}`;
  }
}

/** 每日点评 / 结算分支的降级文案。 */
export function degradedLabel(reason?: string): string {
  return suffix(kindOf(reason), reason, "已降级为确定性模板");
}

/** 本周周报的降级文案。 */
export function weeklyDegradedLabel(reason?: string): string {
  return suffix(kindOf(reason), reason, "以下为确定性模板");
}
