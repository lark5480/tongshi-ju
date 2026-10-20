import { test } from "node:test";
import assert from "node:assert/strict";

import { hashSeed, mulberry32, pickOne, shuffled } from "../lib/engine/prng";

test("hashSeed 对相同输入稳定，对不同输入有区分度", () => {
  assert.equal(hashSeed("daily:2026-10-20:gaming,tech"), hashSeed("daily:2026-10-20:gaming,tech"));
  assert.notEqual(hashSeed("a"), hashSeed("b"));
  assert.ok(Number.isInteger(hashSeed("x")));
  assert.ok(hashSeed("x") >= 0);
});

test("hashSeed 多参数拼接等价于单字符串拼接", () => {
  assert.equal(hashSeed("a", "b", "c"), hashSeed("a", "b", "c"));
  assert.notEqual(hashSeed("a", "b"), hashSeed("a", "b "));
});

test("mulberry32 同种子产生同序列", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test("mulberry32 不同种子产生不同序列", () => {
  const a = Array.from({ length: 20 }, mulberry32(1));
  const b = Array.from({ length: 20 }, mulberry32(2));
  assert.notDeepEqual(a, b);
});

test("mulberry32 取值落在 [0, 1)", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `越界取值 ${v}`);
  }
});

test("shuffled 不改入参且保持元素集合", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffled(input, mulberry32(9));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6], "入参不应被修改");
  assert.deepEqual(
    [...out].sort((x, y) => x - y),
    input
  );
});

test("shuffled 同种子结果一致", () => {
  const input = ["a", "b", "c", "d", "e"];
  assert.deepEqual(shuffled(input, mulberry32(3)), shuffled(input, mulberry32(3)));
});

test("pickOne 对空数组返回 undefined", () => {
  assert.equal(pickOne([], mulberry32(1)), undefined);
});

test("pickOne 从数组中取到元素", () => {
  const arr = ["x", "y", "z"];
  assert.ok(arr.includes(pickOne(arr, mulberry32(5)) as string));
});
