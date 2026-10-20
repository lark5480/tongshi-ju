import { test } from "node:test";
import assert from "node:assert/strict";

import type { DomainId } from "../types";
import {
  DEFAULT_BLINDBOX_COUNT,
  blindboxDomains,
  dailyModeHint,
  dailyModeLabel,
  resolveDailyDomains,
} from "../lib/engine/blindbox";

const ALL: DomainId[] = [
  "gaming",
  "anime",
  "tech",
  "coding",
  "life",
  "history",
  "auto",
  "mobile",
  "film",
  "science",
  "literature",
  "travel",
];

test("盲盒领域：同日同池结果完全一致（纯函数）", () => {
  const a = blindboxDomains("2026-10-20", ALL, 2);
  const b = blindboxDomains("2026-10-20", ALL, 2);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
});

test("盲盒领域：每天会换（跨日期结果不止一种）", () => {
  const seen = new Set<string>();
  for (let d = 1; d <= 12; d++) {
    const key = `2026-10-${String(d).padStart(2, "0")}`;
    seen.add(blindboxDomains(key, ALL, 2).join("+"));
  }
  assert.ok(seen.size > 1, "盲盒必须每天轮换，否则就退化成固定领域");
});

test("盲盒领域：候选池为空时返回空数组", () => {
  assert.deepEqual(blindboxDomains("2026-10-20", [], 2), []);
});

test("盲盒领域：数量受 count 约束", () => {
  assert.equal(blindboxDomains("2026-10-20", ALL, 1).length, 1);
  assert.equal(blindboxDomains("2026-10-20", ALL, 3).length, 3);
  assert.equal(DEFAULT_BLINDBOX_COUNT, 2);
});

test("本命模式：返回选定的领域，且是规范序（与选择顺序无关）", () => {
  const a = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: ["gaming", "anime"],
    blindbox: false,
    candidates: ALL,
  });
  const b = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: ["anime", "gaming"],
    blindbox: false,
    candidates: ALL,
  });
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["anime", "gaming"]);
});

test("盲盒模式：1 个本命 + 2 个盲盒，且盲盒不与本命重复", () => {
  const anchor: DomainId = "gaming";
  const res = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: [anchor],
    blindbox: true,
    candidates: ALL,
  });
  assert.equal(res.length, 3);
  assert.ok(res.includes(anchor), "本命必须在结果里");
  const blind = res.filter((d) => d !== anchor);
  assert.equal(blind.length, 2);
  for (const d of blind) assert.notEqual(d, anchor);
});

test("盲盒模式：本命之外的领域不会进入盲盒", () => {
  const res = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: ["gaming"],
    blindbox: true,
    candidates: ["gaming", "anime", "tech"],
  });
  assert.equal(res.length, 3);
  assert.deepEqual([...res].sort(), ["anime", "gaming", "tech"]);
});

test("盲盒模式：没有本命时退化为纯随机 3 域", () => {
  const res = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: [],
    blindbox: true,
    candidates: ALL,
  });
  assert.equal(res.length, 3);
  assert.ok(res.every((d) => ALL.includes(d)));
});

test("随缘模式：没选领域时按日期种子取 3 个", () => {
  const res = resolveDailyDomains({
    dateKey: "2026-10-20",
    native: [],
    blindbox: false,
    candidates: ALL,
  });
  assert.equal(res.length, 3);
  assert.ok(res.every((d) => ALL.includes(d)));
});

test("随缘模式：跨日期会轮换（不再被写回档案固定住）", () => {
  const seen = new Set<string>();
  for (let d = 1; d <= 12; d++) {
    const key = `2026-10-${String(d).padStart(2, "0")}`;
    const res = resolveDailyDomains({
      dateKey: key,
      native: [],
      blindbox: false,
      candidates: ALL,
    });
    seen.add(res.join("+"));
  }
  assert.ok(seen.size > 1, "随缘模式必须每天轮换");
});

test("模式名与提示：三种模式都有非空文案", () => {
  for (const mode of ["native", "blindbox", "random"] as const) {
    assert.ok(dailyModeLabel(mode).length > 0);
    assert.ok(dailyModeHint(mode).length > 0);
  }
});
