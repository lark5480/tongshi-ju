import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GHOST_NEAR_RATIO,
  compareWithGhost,
  ghostKey,
  ghostProgress,
  ghostSourceLabel,
  ghostVerdictText,
  updateGhost,
  type GhostRecord,
} from "../lib/engine/ghost";

function ghost(over: Partial<GhostRecord> = {}): GhostRecord {
  return {
    key: "anime+gaming",
    bestScore: 100,
    bestCorrect: 4,
    bestDate: "2026-10-19",
    plays: 3,
    bestElapsed: 40000,
    ...over,
  };
}

test("影子键：与领域选择顺序无关（领域是集合不是列表）", () => {
  assert.equal(ghostKey(["gaming", "anime"]), ghostKey(["anime", "gaming"]));
  assert.equal(ghostKey(["gaming", "anime"]), "anime+gaming");
});

test("影子对比：没有影子时是「第一次」", () => {
  const v = compareWithGhost(88, null);
  assert.equal(v.kind, "first");
  assert.equal(v.ghostScore, 0);
  assert.equal(v.ghostDate, null);
});

test("影子对比：分数更高 → beat，差值为正", () => {
  const v = compareWithGhost(112, ghost());
  assert.equal(v.kind, "beat");
  assert.equal(v.delta, 12);
});

test("影子对比：分数相同 → tied", () => {
  const v = compareWithGhost(100, ghost());
  assert.equal(v.kind, "tied");
  assert.equal(v.delta, 0);
});

test("影子对比：差距在 10% 以内 → near，否则 behind", () => {
  // 100 分的 10% = 10 分
  const near = compareWithGhost(95, ghost());
  assert.equal(near.kind, "near");
  assert.equal(near.delta, -5);

  const behind = compareWithGhost(80, ghost());
  assert.equal(behind.kind, "behind");
  assert.equal(behind.delta, -20);

  assert.equal(GHOST_NEAR_RATIO, 0.1);
});

test("影子对比：near 阈值对低分影子至少是 1 分", () => {
  // 影子 5 分时 10% = 0.5 分 → 取整到 1 分
  const v = compareWithGhost(4, ghost({ bestScore: 5 }));
  assert.equal(v.kind, "near");
});

test("影子更新：首次挑战生成一条记录", () => {
  const g = updateGhost(null, {
    key: "anime+gaming",
    score: 88,
    correct: 4,
    date: "2026-10-20",
    elapsed: 42000,
  });
  assert.equal(g.bestScore, 88);
  assert.equal(g.bestCorrect, 4);
  assert.equal(g.bestDate, "2026-10-20");
  assert.equal(g.plays, 1);
  assert.equal(g.bestElapsed, 42000);
});

test("影子更新：更高分刷新最佳成绩与日期", () => {
  const g = updateGhost(ghost(), {
    key: "anime+gaming",
    score: 130,
    correct: 5,
    date: "2026-10-20",
    elapsed: 30000,
  });
  assert.equal(g.bestScore, 130);
  assert.equal(g.bestDate, "2026-10-20");
  assert.equal(g.plays, 4);
});

test("影子更新：更低分不覆盖最佳成绩，但局数照加", () => {
  const g = updateGhost(ghost(), {
    key: "anime+gaming",
    score: 60,
    correct: 2,
    date: "2026-10-20",
    elapsed: 60000,
  });
  assert.equal(g.bestScore, 100);
  assert.equal(g.bestDate, "2026-10-19");
  assert.equal(g.plays, 4);
});

test("影子更新：同分但更快 → 刷新最佳用时", () => {
  const g = updateGhost(ghost(), {
    key: "anime+gaming",
    score: 100,
    correct: 4,
    date: "2026-10-20",
    elapsed: 35000,
  });
  assert.equal(g.bestScore, 100);
  assert.equal(g.bestElapsed, 35000);
});

test("影子更新：同分但更慢 → 保留原最佳用时", () => {
  const g = updateGhost(ghost(), {
    key: "anime+gaming",
    score: 100,
    correct: 4,
    date: "2026-10-20",
    elapsed: 55000,
  });
  assert.equal(g.bestElapsed, 40000);
});

test("影子文案：每种结论都有非空文案", () => {
  const kinds = [
    compareWithGhost(50, null),
    compareWithGhost(100, ghost()),
    compareWithGhost(130, ghost()),
    compareWithGhost(95, ghost()),
    compareWithGhost(50, ghost()),
  ];
  for (const v of kinds) {
    assert.ok(ghostVerdictText(v).length > 0);
    assert.ok(ghostSourceLabel(v).length > 0);
  }
});

test("影子文案：首次挑战的文案提到「影子」", () => {
  assert.match(ghostVerdictText(compareWithGhost(50, null)), /影子/);
});

test("影子进度：夹在 [0,1] 且不超过影子的最终比例", () => {
  const g = ghost({ bestScore: 50 });
  // 满分 100，玩家 80 分 → 0.8；但影子只到 0.5，进度条取较小者
  assert.equal(ghostProgress(g, 80, 100), 0.5);
  assert.equal(ghostProgress(g, 20, 100), 0.2);
  assert.equal(ghostProgress(null, 50, 100), 0);
  assert.equal(ghostProgress(g, 50, 0), 0);
});
