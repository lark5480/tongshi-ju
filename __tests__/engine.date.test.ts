import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, dayNumber, daysBetween, shiftDay } from "../lib/engine/date";

test("dayKey：跨时区同一时刻落在不同日期", () => {
  const beforeMidnight = new Date("2026-01-01T15:59:00Z");
  assert.equal(dayKey("Asia/Shanghai", beforeMidnight), "2026-01-01");
  assert.equal(dayKey("UTC", beforeMidnight), "2026-01-01");

  const afterMidnight = new Date("2026-01-01T16:00:00Z");
  assert.equal(dayKey("Asia/Shanghai", afterMidnight), "2026-01-02");
  assert.equal(dayKey("UTC", afterMidnight), "2026-01-01");
});

test("dayKey：跨年边界按指定时区切日", () => {
  assert.equal(dayKey("Asia/Shanghai", new Date("2026-12-31T15:59:00Z")), "2026-12-31");
  assert.equal(dayKey("Asia/Shanghai", new Date("2026-12-31T16:00:00Z")), "2027-01-01");
});

test("shiftDay：跨年、跨月与闰日", () => {
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDay("2027-01-01", -1), "2026-12-31");
  assert.equal(shiftDay("2026-01-31", 1), "2026-02-01");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");

  assert.equal(shiftDay("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDay("2024-02-29", 1), "2024-03-01");
  assert.equal(shiftDay("2024-03-01", -1), "2024-02-29");
  // 非闰年 2 月没有 29 日
  assert.equal(shiftDay("2023-02-28", 1), "2023-03-01");
});

test("shiftDay：非法日期原样返回", () => {
  assert.equal(shiftDay("x", 1), "x");
  assert.equal(shiftDay("2026-1-3", 1), "2026-1-3");
});

test("daysBetween：跨年与闰日按 UTC 天数计算", () => {
  assert.equal(daysBetween("2026-11-03", "2026-11-03"), 0);
  assert.equal(daysBetween("2027-01-01", "2026-12-31"), 1);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), -1);
  assert.equal(daysBetween("2024-03-01", "2024-02-28"), 2);
  assert.equal(daysBetween("2023-03-01", "2023-02-28"), 1);
});

test("daysBetween：非法日期返回 0", () => {
  assert.equal(daysBetween("x", "2026-01-01"), 0);
  assert.equal(daysBetween("2026-01-01", "y"), 0);
});

test("dayNumber：合法日期转紧凑整数，非法日期返回 0", () => {
  assert.equal(dayNumber("2026-11-03"), 20261103);
  assert.equal(dayNumber("x"), 0);
  assert.equal(dayNumber("2026-1-3"), 0);
});
