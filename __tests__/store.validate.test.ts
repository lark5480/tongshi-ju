import { test } from "node:test";
import assert from "node:assert/strict";

import {
  answerSchema,
  createRoomSchema,
  domainsSchema,
  joinRoomSchema,
  playerEmojiSchema,
  playerNameSchema,
  readySchema,
  rematchSchema,
  startSchema,
} from "../lib/store/validate";

test("昵称：长度与字符白名单", () => {
  assert.ok(playerNameSchema.safeParse("小明").success);
  assert.ok(playerNameSchema.safeParse("player_1").success);
  assert.ok(playerNameSchema.safeParse("").success === false, "空昵称应被拒");
  assert.ok(playerNameSchema.safeParse("a".repeat(13)).success === false, "超长应被拒");
  assert.ok(playerNameSchema.safeParse("<script>").success === false, "尖括号应被拒");
  assert.ok(playerNameSchema.safeParse("名字\n注入").success === false, "换行应被拒");
});

test("头像：必须是 emoji", () => {
  assert.ok(playerEmojiSchema.safeParse("🧠").success);
  assert.ok(playerEmojiSchema.safeParse("🔥").success);
  assert.ok(playerEmojiSchema.safeParse("A").success === false, "字母应被拒");
  assert.ok(playerEmojiSchema.safeParse("").success === false, "空应被拒");
});

test("领域数组：最多 3 个且自动去重", () => {
  const parsed = domainsSchema.parse(["gaming", "gaming", "tech"]);
  assert.deepEqual(parsed, ["gaming", "tech"]);
  assert.equal(domainsSchema.safeParse(["gaming", "tech", "life", "coding"]).success, false);
  assert.equal(domainsSchema.safeParse(["not-a-domain"]).success, false);
  assert.deepEqual(domainsSchema.parse([]), []);
});

test("创建房间入参", () => {
  const ok = createRoomSchema.safeParse({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  assert.ok(ok.success);
  const bad = createRoomSchema.safeParse({ name: "", emoji: "🧠" });
  assert.equal(bad.success, false);
});

test("创建房间入参允许缺省 domains", () => {
  const parsed = createRoomSchema.parse({ name: "小明", emoji: "🧠" });
  assert.deepEqual(parsed.domains, []);
});

test("加入房间入参：房间码自动转大写", () => {
  // 注意：房间码字符集剔除了 0/O/1/I/L，测试用例也不能含这些字符
  const parsed = joinRoomSchema.parse({ code: "abcd23", name: "小红", emoji: "🔥" });
  assert.equal(parsed.code, "ABCD23");
});

test("加入房间入参：拒绝含易混字符的房间码", () => {
  assert.equal(joinRoomSchema.safeParse({ code: "ABC0D2", name: "x", emoji: "🔥" }).success, false);
  assert.equal(joinRoomSchema.safeParse({ code: "ABC1D2", name: "x", emoji: "🔥" }).success, false);
  assert.equal(joinRoomSchema.safeParse({ code: "AB", name: "x", emoji: "🔥" }).success, false);
});

test("提交答案入参：答案可为字符串或数组", () => {
  assert.ok(answerSchema.safeParse({ playerId: "p", roundIndex: 0, answer: "A" }).success);
  assert.ok(answerSchema.safeParse({ playerId: "p", roundIndex: 0, answer: ["A", "B"] }).success);
  assert.equal(
    answerSchema.safeParse({ playerId: "p", roundIndex: -1, answer: "A" }).success,
    false
  );
  assert.equal(answerSchema.safeParse({ playerId: "", roundIndex: 0, answer: "A" }).success, false);
  assert.equal(answerSchema.safeParse({ playerId: "p", roundIndex: 0, answer: [] }).success, false);
});

test("提交答案入参：未知字段被剥离（客户端伪造的 elapsed 不会生效）", () => {
  const parsed = answerSchema.parse({
    playerId: "p",
    roundIndex: 0,
    answer: "A",
    elapsed: 1,
    startedAt: 2,
  });
  assert.equal("elapsed" in parsed, false, "elapsed 不应出现在解析结果中");
  assert.equal("startedAt" in parsed, false, "startedAt 不应出现在解析结果中");
});

test("准备 / 开局 / 再来一局入参", () => {
  assert.ok(readySchema.safeParse({ playerId: "p", ready: true }).success);
  assert.equal(readySchema.safeParse({ playerId: "p", ready: "yes" }).success, false);
  assert.ok(startSchema.safeParse({ playerId: "p" }).success);
  assert.equal(startSchema.safeParse({}).success, false);
  assert.ok(rematchSchema.safeParse({ playerId: "p" }).success);
});
