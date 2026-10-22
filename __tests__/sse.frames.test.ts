import { test } from "node:test";
import assert from "node:assert/strict";

import { splitSseFrames } from "../lib/sse";

/** 服务端实际会写出的三帧：全量快照、心跳注释、轮换通知。 */
const STATE = `event: state\ndata: {"type":"state","room":{"code":"ABC123"}}\n\n`;
const PING = ": ping\n\n";
const ROUND = `event: round_start\ndata: {"type":"round_start","roundIndex":1}\n\n`;

test("完整帧一次到达：按顺序解析，尾部为空", () => {
  const { frames, rest } = splitSseFrames(STATE + ROUND);
  assert.equal(rest, "");
  assert.deepEqual(
    frames.map((f) => f.event),
    ["state", "round_start"]
  );
  assert.equal(JSON.parse(frames[0].data).room.code, "ABC123");
});

test("心跳注释帧不产生事件，但会消费掉自己的空行", () => {
  const { frames, rest } = splitSseFrames(PING);
  assert.equal(frames.length, 0);
  assert.equal(rest, "");
});

test("只有控制字段（retry）的块不产生帧", () => {
  const { frames, rest } = splitSseFrames("retry: 5000\n\n" + STATE);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "state");
  assert.equal(rest, "");
});

test("半帧留在 rest，补全后仍能拼回同一帧", () => {
  const cut = Math.floor(STATE.length / 2);
  const first = splitSseFrames(STATE.slice(0, cut));
  assert.deepEqual(first.frames, []);
  assert.equal(first.rest, STATE.slice(0, cut));

  const second = splitSseFrames(first.rest + STATE.slice(cut));
  assert.equal(second.frames.length, 1);
  assert.equal(second.rest, "");
});

test("不变量：无论从哪个字节切分，解析结果序列都相同", () => {
  const stream = STATE + PING + ROUND + STATE;
  const expected = splitSseFrames(stream).frames;
  assert.equal(expected.length, 3);

  for (let cut = 1; cut < stream.length; cut++) {
    const chunks = [stream.slice(0, cut), stream.slice(cut)];
    const collected: typeof expected = [];
    let buffer = "";
    for (const chunk of chunks) {
      const split = splitSseFrames(buffer + chunk);
      collected.push(...split.frames);
      buffer = split.rest;
    }
    assert.deepEqual(collected, expected, `切分点 ${cut} 丢帧或错序`);
    assert.equal(buffer, "", `切分点 ${cut} 尾部未收干`);
  }
});

test("event 名缺省为 message，多行 data 以换行连接", () => {
  const { frames } = splitSseFrames('data: {"a":1}\ndata: "b"\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "message");
  assert.equal(frames[0].data, '{"a":1}\n"b"');
});

test("冒号后可无空格（`event:x` 与 `event: x` 等价）", () => {
  const tight = splitSseFrames("event:rotate\ndata:{}\n\n");
  const loose = splitSseFrames("event: rotate\ndata: {}\n\n");
  assert.deepEqual(tight.frames, loose.frames);
  assert.equal(tight.frames[0].event, "rotate");
});
