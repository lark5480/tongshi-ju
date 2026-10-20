import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { POST as createRoomRoute } from "../app/api/rooms/route";
import { POST as joinRoute } from "../app/api/rooms/[code]/join/route";
import { GET as getRoomRoute } from "../app/api/rooms/[code]/route";
import { POST as readyRoute } from "../app/api/rooms/[code]/ready/route";
import { POST as startRoute } from "../app/api/rooms/[code]/start/route";
import { POST as answerRoute } from "../app/api/rooms/[code]/answer/route";
import { POST as rematchRoute } from "../app/api/rooms/[code]/rematch/route";
import { __resetRoomsForTest } from "../lib/store/room";
import { findQuestion } from "../lib/content/server-bank";
import { advance, installFakeTime, uninstallFakeTime } from "./helpers/fake-time";

/**
 * 端到端冒烟：直接调用 Next.js 路由处理函数，串起完整对局。
 *
 * 覆盖了「HTTP 入参校验 → 限流 → 房间状态机 → 权威判定 → 结算」整条链路。
 */

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  installFakeTime();
  __resetRoomsForTest();
});

afterEach(() => {
  __resetRoomsForTest();
  uninstallFakeTime();
});

test("完整对局：建房 → 加入 → 准备 → 开局 → 抢答 → 结算", async () => {
  // 1. 建房
  const createRes = await createRoomRoute(
    new Request(
      "http://localhost/api/rooms",
      json({ name: "小明", emoji: "🧠", domains: ["gaming"] })
    )
  );
  assert.equal(createRes.status, 201);
  const host = (await createRes.json()) as { code: string; playerId: string; slot: number };
  assert.equal(host.slot, 0);

  // 2. 加入
  const joinRes = await joinRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/join`,
      json({
        code: host.code,
        name: "小红",
        emoji: "🔥",
      })
    ),
    { params: { code: host.code } }
  );
  assert.equal(joinRes.status, 201);
  const guest = (await joinRes.json()) as { code: string; playerId: string; slot: number };
  assert.equal(guest.slot, 1);

  // 3. 双方准备
  for (const p of [host, guest]) {
    const res = await readyRoute(
      new Request(
        `http://localhost/api/rooms/${host.code}/ready`,
        json({ playerId: p.playerId, ready: true })
      ),
      { params: { code: host.code } }
    );
    assert.equal(res.status, 200);
  }

  // 4. 房主开局
  const startRes = await startRoute(
    new Request(`http://localhost/api/rooms/${host.code}/start`, json({ playerId: host.playerId })),
    { params: { code: host.code } }
  );
  assert.equal(startRes.status, 200);
  const started = (await startRes.json()) as {
    room: { status: string; questions: { id: string }[] };
  };
  assert.equal(started.room.status, "countdown");
  assert.ok(started.room.questions.length > 0);

  // 5. 推进过倒计时，进入答题相位
  advance(3_000);
  const snapRes = await getRoomRoute(
    new Request(`http://localhost/api/rooms/${host.code}?playerId=${host.playerId}`),
    { params: { code: host.code } }
  );
  const snap = (await snapRes.json()) as {
    room: { status: string; roundIndex: number; questions: { id: string }[] };
    you: { slot: number; isHost: boolean } | null;
  };
  assert.equal(snap.room.status, "question");
  assert.equal(snap.you?.slot, 0);
  assert.equal(snap.you?.isHost, true);

  // 6. 房主抢答（用真实答案）
  const meta = snap.room.questions[snap.room.roundIndex];
  const full = findQuestion(meta.id)!;
  const answerRes = await answerRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/answer`,
      json({
        playerId: host.playerId,
        roundIndex: snap.room.roundIndex,
        answer: full.answer,
      })
    ),
    { params: { code: host.code } }
  );
  assert.equal(answerRes.status, 200);
  const result = (await answerRes.json()) as { correct: boolean; winnerSlot: number };
  assert.equal(result.correct, true);
  assert.equal(result.winnerSlot, 0);

  // 7. 结算：房主得分、对手 0 分
  const afterRes = await getRoomRoute(new Request(`http://localhost/api/rooms/${host.code}`), {
    params: { code: host.code },
  });
  const after = (await afterRes.json()) as {
    room: {
      status: string;
      scores: Record<string, number>;
      players: { slot: number; score: number; combo: number; firstCorrect: number }[];
      history: { winnerSlot: number | null; points: Record<string, number> }[];
    };
  };
  assert.equal(after.room.status, "feedback");
  assert.ok(after.room.scores["0"] > 0, "抢答者应得分");
  assert.equal(after.room.scores["1"], 0, "对手该题 0 分");
  assert.equal(after.room.history[0].winnerSlot, 0);

  // 回归：players[].score 必须与 scores[slot] 一致。
  // 历史缺陷：服务端只写 room.scores / room.combos / room.firstCorrect，
  // 从不写 player.score / player.combo / player.firstCorrect，
  // 于是对外快照里 players[].score 恒为 0（比分条永远显示 0 分）。
  const hostPlayer = after.room.players.find((p) => p.slot === 0);
  assert.ok(hostPlayer, "快照应包含房主");
  assert.equal(
    hostPlayer!.score,
    after.room.scores["0"],
    "players[].score 必须与 scores[slot] 一致"
  );
  assert.ok(hostPlayer!.score > 0, "房主在 players[] 里的得分应大于 0");
  assert.equal(hostPlayer!.firstCorrect, 1, "房主应记 1 次抢先答对");
  const guestPlayer = after.room.players.find((p) => p.slot === 1);
  assert.equal(guestPlayer!.score, 0, "对手在 players[] 里的得分应为 0");
});

test("凭证纪律：房间快照的 JSON 里不含任何 playerId", async () => {
  const createRes = await createRoomRoute(
    new Request(
      "http://localhost/api/rooms",
      json({ name: "小明", emoji: "🧠", domains: ["gaming"] })
    )
  );
  const host = (await createRes.json()) as { code: string; playerId: string };
  const joinRes = await joinRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/join`,
      json({
        code: host.code,
        name: "小红",
        emoji: "🔥",
      })
    ),
    { params: { code: host.code } }
  );
  const guest = (await joinRes.json()) as { playerId: string };

  const snapRes = await getRoomRoute(new Request(`http://localhost/api/rooms/${host.code}`), {
    params: { code: host.code },
  });
  const text = await snapRes.text();
  assert.ok(!text.includes(host.playerId), "快照泄露房主凭证");
  assert.ok(!text.includes(guest.playerId), "快照泄露访客凭证");
});

test("入参校验：昵称非法时创建房间返回 400", async () => {
  const res = await createRoomRoute(
    new Request("http://localhost/api/rooms", json({ name: "<script>", emoji: "🧠", domains: [] }))
  );
  assert.equal(res.status, 400);
});

test("入参校验：缺少凭证时提交答案返回 400", async () => {
  const createRes = await createRoomRoute(
    new Request(
      "http://localhost/api/rooms",
      json({ name: "小明", emoji: "🧠", domains: ["gaming"] })
    )
  );
  const host = (await createRes.json()) as { code: string };
  const res = await answerRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/answer`,
      json({ roundIndex: 0, answer: "A" })
    ),
    { params: { code: host.code } }
  );
  assert.equal(res.status, 400);
});

test("越权：访客不能发起再来一局", async () => {
  const createRes = await createRoomRoute(
    new Request(
      "http://localhost/api/rooms",
      json({ name: "小明", emoji: "🧠", domains: ["gaming"] })
    )
  );
  const host = (await createRes.json()) as { code: string; playerId: string };
  const joinRes = await joinRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/join`,
      json({
        code: host.code,
        name: "小红",
        emoji: "🔥",
      })
    ),
    { params: { code: host.code } }
  );
  const guest = (await joinRes.json()) as { playerId: string };

  const res = await rematchRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/rematch`,
      json({ playerId: guest.playerId })
    ),
    { params: { code: host.code } }
  );
  assert.equal(res.status, 403);
});

test("对局未结束时不能再来一局", async () => {
  const createRes = await createRoomRoute(
    new Request(
      "http://localhost/api/rooms",
      json({ name: "小明", emoji: "🧠", domains: ["gaming"] })
    )
  );
  const host = (await createRes.json()) as { code: string; playerId: string };
  const res = await rematchRoute(
    new Request(
      `http://localhost/api/rooms/${host.code}/rematch`,
      json({ playerId: host.playerId })
    ),
    { params: { code: host.code } }
  );
  assert.equal(res.status, 409);
});

test("房间不存在时返回 404", async () => {
  const res = await getRoomRoute(new Request("http://localhost/api/rooms/ZZZZZZ"), {
    params: { code: "ZZZZZZ" },
  });
  assert.equal(res.status, 404);
});
