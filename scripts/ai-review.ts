/**
 * AI 题审核 CLI —— 本地运营入口。
 *
 * 用法：
 *   npm run ai:review -- list
 *   npm run ai:review -- show <batchId>
 *   npm run ai:review -- gen --domain gaming [--topic 经典作品] [--difficulty 2] [--count 3]
 *   npm run ai:review -- approve <batchId> [--ids id1,id2] [--write]
 *   npm run ai:review -- reject <batchId> [--write]
 *
 * 安全默认：`approve` / `reject` 默认 dry-run，只有显式 `--write` 才改文件。
 * `gen` 会调用真实模型（产生费用），密钥只从环境变量读取，不接受命令行参数。
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DOMAINS } from "../content/domains";
import {
  aiDomainFileSchema,
  aiGenerateSchema,
  type AiGenerateInput,
} from "../content/domains/schema";
import type { DomainId, Question } from "../types";
import { dayKey } from "../lib/engine/date";
import { generateBatch } from "../lib/ai/generate";
import { approveQuestions, mergeApproved, type PendingBatch } from "../lib/ai/pending";
import {
  listPendingBatches,
  markPendingBatch,
  readPendingBatch,
  writePendingBatch,
} from "../lib/ai/pending-io";
import { getProvider } from "../lib/ai/provider";
import { aiBank, domainBank } from "../lib/content/server-bank";

const USAGE = `AI 题审核 CLI

用法：
  npm run ai:review -- list
  npm run ai:review -- show <batchId>
  npm run ai:review -- gen --domain <id> [--topic <知识点>] [--difficulty 1|2|3] [--count N] [--variant-of <questionId>]
  npm run ai:review -- approve <batchId> [--ids id1,id2] [--write]
  npm run ai:review -- reject <batchId> [--write]

说明：
  - approve / reject 默认 dry-run，加 --write 才写文件；
  - approve 会重新查重（seed + 已入库 AI + 本批），冲突时不覆盖；
  - gen 会调用真实模型，产生费用；密钥只从环境变量读取。`;

function fail(message: string): never {
  console.error(`错误：${message}`);
  process.exit(1);
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function formatQuestion(q: Question, index: number): string {
  const answer = Array.isArray(q.answer) ? q.answer.join("、") : q.answer;
  return [
    `[${index + 1}] ${q.id} · ${q.topic} · 难度 ${q.difficulty} · ${q.type}`,
    `    题干：${q.stem}`,
    `    选项：${q.options.join(" | ")}`,
    `    答案：${answer}`,
    `    解析：${q.explanation}`,
  ].join("\n");
}

function aiFilePath(domain: DomainId): string {
  return join(process.cwd(), "content", "ai", `${domain}.json`);
}

async function readAiFile(domain: DomainId) {
  const raw = await readFile(aiFilePath(domain), "utf-8");
  const parsed = aiDomainFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    fail(`content/ai/${domain}.json 不符合 schema：${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

async function commandList(): Promise<void> {
  const batches = await listPendingBatches();
  if (batches.length === 0) {
    console.log("待审池为空。");
    return;
  }
  for (const b of batches) {
    console.log(
      `${b.batchId}  ${b.domain.padEnd(12)} ${b.status.padEnd(8)} 通过 ${String(b.accepted.length).padStart(2)} / 拒绝 ${String(b.rejected.length).padStart(2)}  ${b.createdAt}`
    );
  }
}

async function commandShow(args: readonly string[]): Promise<void> {
  const batchId = args[0];
  if (!batchId) fail("用法：show <batchId>");
  const batch = await readPendingBatch(batchId);
  if (!batch) fail(`找不到批次 ${batchId}`);

  console.log(`批次 ${batch.batchId}`);
  console.log(`领域 ${batch.domain} · 状态 ${batch.status} · 创建 ${batch.createdAt}`);
  console.log(`provider ${batch.provider}${batch.model ? ` · 模型 ${batch.model}` : ""}`);
  console.log(`通过 ${batch.accepted.length} 题 · 拒绝 ${batch.rejected.length} 题`);

  batch.accepted.forEach((q, i) => console.log(`\n${formatQuestion(q, i)}`));

  if (batch.rejected.length > 0) {
    console.log("\n被拒绝的题：");
    batch.rejected.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.reason}：${r.stem}`);
      console.log(`    ${r.detail}`);
    });
  }
}

async function commandApprove(args: readonly string[]): Promise<void> {
  const batchId = args[0];
  if (!batchId) fail("用法：approve <batchId> [--ids id1,id2] [--write]");

  const batch = await readPendingBatch(batchId);
  if (!batch) fail(`找不到批次 ${batchId}`);
  if (batch.status !== "pending") fail(`批次状态是 ${batch.status}，不能重复批准`);

  const idsArg = flag(args, "--ids");
  if (hasFlag(args, "--ids") && !idsArg) {
    fail("--ids 后必须跟至少一个题目 id（逗号分隔）；要批准整批请省略 --ids");
  }
  const ids =
    idsArg && idsArg.trim()
      ? idsArg
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  const reviewedAt = dayKey();
  const result = approveQuestions({
    batch,
    ...(ids ? { ids } : {}),
    seedQuestions: domainBank(batch.domain),
    aiQuestions: aiBank(batch.domain),
    reviewedAt,
  });

  if (!result.ok) {
    console.error("批准失败，未写入任何内容：");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(`将批准 ${result.questions.length} 题（reviewedAt=${reviewedAt}）：`);
  for (const q of result.questions) {
    console.log(`  ${q.id}  ${q.stem}`);
  }

  if (!hasFlag(args, "--write")) {
    console.log("\ndry-run：未写入。确认无误后加 --write 执行。");
    return;
  }

  const current = await readAiFile(batch.domain);
  const merged = mergeApproved(current, result.questions);
  if (merged.errors.length > 0) {
    console.error("合并失败，未写入：");
    for (const error of merged.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const path = aiFilePath(batch.domain);
  await writeFile(path, `${JSON.stringify(merged.file, null, 2)}\n`, "utf-8");
  await markPendingBatch(batch.batchId, "approved", reviewedAt);
  console.log(`\n已写入 ${path}，批次标记为 approved。`);
  console.log("下一步：npm run validate:content");
}

async function commandReject(args: readonly string[]): Promise<void> {
  const batchId = args[0];
  if (!batchId) fail("用法：reject <batchId> [--write]");
  const batch = await readPendingBatch(batchId);
  if (!batch) fail(`找不到批次 ${batchId}`);
  if (batch.status !== "pending") fail(`批次状态是 ${batch.status}，不能重复处理`);

  if (!hasFlag(args, "--write")) {
    console.log(`dry-run：会把批次 ${batchId} 标记为 rejected。加 --write 执行。`);
    return;
  }

  await markPendingBatch(batchId, "rejected", dayKey());
  console.log(`批次 ${batchId} 已标记为 rejected。`);
}

function findOriginal(domain: DomainId, id: string): Question | undefined {
  return [...domainBank(domain), ...aiBank(domain)].find((q) => q.id === id);
}

async function commandGen(args: readonly string[]): Promise<void> {
  const domainId = flag(args, "--domain");
  if (!domainId) {
    fail(
      "用法：gen --domain <id> [--topic <知识点>] [--difficulty 1|2|3] [--count N] [--variant-of <questionId>]"
    );
  }
  const meta = DOMAINS.find((d) => d.id === domainId);
  if (!meta) fail(`未知领域：${domainId}`);

  const topic = flag(args, "--topic");
  const difficultyRaw = flag(args, "--difficulty");
  const countRaw = flag(args, "--count");
  const variantId = flag(args, "--variant-of");

  const baseInput: Record<string, unknown> = { domain: meta.id };
  if (topic) baseInput.topic = topic;
  if (difficultyRaw) baseInput.difficulty = Number(difficultyRaw);
  if (countRaw) baseInput.count = Number(countRaw);

  if (variantId) {
    const original = findOriginal(meta.id, variantId);
    if (!original) fail(`找不到变体原题：${variantId}`);
    baseInput.variantOf = {
      questionId: original.id,
      stem: original.stem,
      answer: original.answer,
    };
  }

  const parsed = aiGenerateSchema.safeParse(baseInput);
  if (!parsed.success) {
    fail(parsed.error.issues[0]?.message ?? "参数不合法");
  }
  const input: AiGenerateInput = parsed.data;

  const provider = getProvider();
  if (!provider) {
    fail("未配置 AI provider（需要 AI_API_BASE / AI_API_KEY / AI_MODEL）");
  }

  console.log(`调用模型生成 ${input.count} 道题（domain=${input.domain}）；这会消耗模型额度。`);
  const result = await generateBatch(input, provider);

  const batch: PendingBatch = {
    version: 1,
    batchId: result.batchId,
    domain: result.domain,
    createdAt: new Date().toISOString(),
    provider: provider.name,
    ...(process.env.AI_MODEL ? { model: process.env.AI_MODEL } : {}),
    input: {
      domain: input.domain,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      count: input.count,
      ...(input.variantOf ? { variantOf: input.variantOf.questionId } : {}),
    },
    accepted: result.accepted,
    rejected: result.rejected,
    status: "pending",
  };

  await writePendingBatch(batch);
  console.log(
    `批次 ${batch.batchId} 已写入待审池：通过 ${result.accepted.length} / 拒绝 ${result.rejected.length}。`
  );
  console.log(`下一步：npm run ai:review -- show ${batch.batchId}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "list":
      await commandList();
      break;
    case "show":
      await commandShow(args);
      break;
    case "approve":
      await commandApprove(args);
      break;
    case "reject":
      await commandReject(args);
      break;
    case "gen":
      await commandGen(args);
      break;
    default:
      console.error(`未知命令：${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
