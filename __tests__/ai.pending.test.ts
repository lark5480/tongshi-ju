import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Question } from "../types";
import { fingerprintOf } from "../lib/content/fingerprint";
import {
  approveQuestions,
  mergeApproved,
  type PendingBatch,
  type PendingQuestion,
} from "../lib/ai/pending";
import {
  listPendingBatches,
  markPendingBatch,
  readPendingBatch,
  removePendingBatch,
  writePendingBatch,
} from "../lib/ai/pending-io";

const STEM = "《塞尔达传说》系列最初发行于哪台主机？";

function makeAiQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "gaming-ai-00000001",
    domain: "gaming",
    topic: "经典作品",
    difficulty: 1,
    type: "single",
    stem: STEM,
    options: ["FC", "SFC", "N64", "GB"],
    answer: "FC",
    explanation: "初代《塞尔达传说》于 1986 年在 FC 磁碟机系统上发行。",
    origin: "ai",
    batchId: "ai-test-1",
    fingerprint: "00000001",
    ...overrides,
  };
}

function makeBatch(accepted: PendingQuestion[]): PendingBatch {
  return {
    version: 1,
    batchId: "ai-test-1",
    domain: "gaming",
    createdAt: "2026-11-09T00:00:00.000Z",
    provider: "fake",
    input: { domain: "gaming", count: accepted.length },
    accepted,
    rejected: [],
    status: "pending",
  };
}

test("approve：合法题生成稳定 id 与审核字段", () => {
  const result = approveQuestions({
    batch: makeBatch([makeAiQuestion()]),
    seedQuestions: [],
    aiQuestions: [],
    reviewedAt: "2026-11-10",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0]?.id, `gaming-ai-${fingerprintOf(STEM)}`);
  assert.equal(result.questions[0]?.batchId, "ai-test-1");
  assert.equal(result.questions[0]?.reviewedAt, "2026-11-10");
});

test("approve：与 seed 题干重复时拒绝，且不产出部分结果", () => {
  const seed = makeAiQuestion({
    id: "gaming-0001",
    origin: "seed",
    fingerprint: fingerprintOf(STEM),
  });
  const result = approveQuestions({
    batch: makeBatch([makeAiQuestion()]),
    seedQuestions: [seed],
    aiQuestions: [],
    reviewedAt: "2026-11-10",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.questions, []);
  assert.ok(result.errors.some((e) => e.includes("题干重复")));
});

test("approve：批内重复时拒绝", () => {
  const result = approveQuestions({
    batch: makeBatch([
      makeAiQuestion({ id: "gaming-ai-00000001" }),
      makeAiQuestion({ id: "gaming-ai-00000002" }),
    ]),
    seedQuestions: [],
    aiQuestions: [],
    reviewedAt: "2026-11-10",
  });

  assert.equal(result.ok, false);
  // 同题干 → 同指纹 → 同 id；批内第二题会先在 id 冲突或指纹查重被拦下。
  assert.ok(result.errors.some((e) => e.includes("id 已存在") || e.includes("题干重复")));
});

test("approve：id 已存在时不覆盖", () => {
  const fp = fingerprintOf(STEM);
  const existing = makeAiQuestion({ id: `gaming-ai-${fp}`, stem: "另一道完全不同的题？" });
  const result = approveQuestions({
    batch: makeBatch([makeAiQuestion()]),
    seedQuestions: [],
    aiQuestions: [existing],
    reviewedAt: "2026-11-10",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("id 已存在")));
});

test("approve：origin 不是 ai 的题被拒绝", () => {
  const result = approveQuestions({
    batch: makeBatch([makeAiQuestion({ origin: "seed" })]),
    seedQuestions: [],
    aiQuestions: [],
    reviewedAt: "2026-11-10",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("origin 必须是 ai")));
});

test("approve：非法审核日期被拒绝", () => {
  const result = approveQuestions({
    batch: makeBatch([makeAiQuestion()]),
    seedQuestions: [],
    aiQuestions: [],
    reviewedAt: "2026/11/10",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("reviewedAt")));
});

test("mergeApproved：追加并按 id 排序，重复 id 报错", () => {
  const file = { domain: "gaming" as const, questions: [] };
  const q = {
    id: `gaming-ai-${fingerprintOf(STEM)}`,
    topic: "经典作品",
    difficulty: 1 as const,
    type: "single" as const,
    stem: STEM,
    options: ["FC", "SFC"],
    answer: "FC",
    explanation: "初代《塞尔达传说》于 1986 年在 FC 磁碟机系统上发行。",
    batchId: "ai-test-1",
    reviewedAt: "2026-11-10",
  };

  const merged = mergeApproved(file, [q]);
  assert.deepEqual(merged.errors, []);
  assert.equal(merged.file.questions.length, 1);

  const again = mergeApproved(merged.file, [q]);
  assert.ok(again.errors.some((e) => e.includes("id 已存在")));
});

test("IO：write / list / read / mark / remove 往返", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tongshi-pending-"));
  const previous = process.env.AI_PENDING_DIR;
  process.env.AI_PENDING_DIR = dir;

  try {
    const batch = makeBatch([makeAiQuestion()]);
    await writePendingBatch(batch);

    const listed = await listPendingBatches();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.batchId, batch.batchId);

    const read = await readPendingBatch(batch.batchId);
    assert.equal(read?.accepted.length, 1);

    const marked = await markPendingBatch(batch.batchId, "approved", "2026-11-10");
    assert.equal(marked.status, "approved");
    assert.equal(marked.reviewedAt, "2026-11-10");

    await removePendingBatch(batch.batchId);
    assert.equal(await readPendingBatch(batch.batchId), null);
  } finally {
    if (previous === undefined) delete process.env.AI_PENDING_DIR;
    else process.env.AI_PENDING_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("IO：非法 batchId 不落到目录外", async () => {
  const before = process.env.AI_PENDING_DIR;
  process.env.AI_PENDING_DIR = join(tmpdir(), "tongshi-pending-guard");

  try {
    assert.equal(await readPendingBatch("../evil"), null);
  } finally {
    if (before === undefined) delete process.env.AI_PENDING_DIR;
    else process.env.AI_PENDING_DIR = before;
  }
});
