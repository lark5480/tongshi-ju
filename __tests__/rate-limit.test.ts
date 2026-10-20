import { test } from "node:test";
import assert from "node:assert/strict";

import { allowRequest, clientIp, pruneRateLimit, rateLimitGuard } from "../lib/rate-limit";

test("clientIp 优先取 X-Forwarded-For 的第一段", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
  assert.equal(clientIp(req), "1.2.3.4");
});

test("clientIp 回退到 X-Real-IP，再回退到 unknown", () => {
  assert.equal(
    clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } })),
    "9.9.9.9"
  );
  assert.equal(clientIp(new Request("http://x")), "unknown");
});

test("滑动窗口：超过限额后拒绝", () => {
  const key = `test-${Math.random()}`;
  assert.equal(allowRequest(key, 3, 60_000), true);
  assert.equal(allowRequest(key, 3, 60_000), true);
  assert.equal(allowRequest(key, 3, 60_000), true);
  assert.equal(allowRequest(key, 3, 60_000), false, "第 4 次应被拒");
});

test("滑动窗口：不同 key 互不影响", () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  assert.equal(allowRequest(a, 1, 60_000), true);
  assert.equal(allowRequest(a, 1, 60_000), false);
  assert.equal(allowRequest(b, 1, 60_000), true);
});

test("rateLimitGuard 放行时不返回响应", () => {
  const req = new Request("http://x", {
    headers: { "x-forwarded-for": `1.1.1.${Math.floor(Math.random() * 255)}` },
  });
  const res = rateLimitGuard(req, `scope-${Math.random()}`, 10);
  assert.equal(res, null);
});

test("rateLimitGuard 超限返回 429", () => {
  const scope = `scope-${Math.random()}`;
  const req = new Request("http://x", { headers: { "x-forwarded-for": "8.8.8.8" } });
  assert.equal(rateLimitGuard(req, scope, 1), null);
  const second = rateLimitGuard(req, scope, 1);
  assert.ok(second);
  assert.equal(second.status, 429);
});

test("pruneRateLimit 清理过期 key", () => {
  const key = `prune-${Math.random()}`;
  // 窗口设为 0：写入后立刻过期，可确定地被清理
  allowRequest(key, 1, 0);
  pruneRateLimit(0);
  // 清理后窗口内无记录 → 该 key 重新可用
  assert.equal(allowRequest(key, 1, 60_000), true);
});
