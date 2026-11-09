/**
 * AI 待审池 IO —— 只允许服务端 / 脚本使用（`node:fs`）。
 *
 * 目录默认 `.ai-pending/`（已 gitignore）；可用 `AI_PENDING_DIR` 覆盖（测试用临时目录）。
 * 一 batch 一文件，写入先落临时文件再 rename，避免半截 JSON。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { pendingBatchSchema, type PendingBatch, type PendingStatus } from "./pending";

const BATCH_ID_RE = /^[A-Za-z0-9_-]+$/;

export function pendingDir(): string {
  return resolve(process.env.AI_PENDING_DIR ?? ".ai-pending");
}

function batchPath(batchId: string): string {
  if (!BATCH_ID_RE.test(batchId)) {
    throw new Error(`非法 batchId：${batchId}`);
  }
  return join(pendingDir(), `${batchId}.json`);
}

export async function writePendingBatch(batch: PendingBatch): Promise<void> {
  const parsed = pendingBatchSchema.parse(batch);
  if (parsed.domain !== parsed.input.domain) {
    throw new Error(`批次领域 ${parsed.domain} 与 input.domain ${parsed.input.domain} 不一致`);
  }

  await mkdir(pendingDir(), { recursive: true });
  const target = batchPath(parsed.batchId);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  await rename(tmp, target);
}

export async function listPendingBatches(): Promise<PendingBatch[]> {
  let files: string[];
  try {
    files = await readdir(pendingDir());
  } catch {
    return [];
  }

  const out: PendingBatch[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = await readFile(join(pendingDir(), file), "utf-8");
      const parsed = pendingBatchSchema.safeParse(JSON.parse(raw));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // 坏文件跳过，不阻塞其他批次；CLI 的 list 只展示可解析批次。
    }
  }
  return out.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.batchId.localeCompare(b.batchId)
  );
}

export async function readPendingBatch(batchId: string): Promise<PendingBatch | null> {
  try {
    const raw = await readFile(batchPath(batchId), "utf-8");
    const parsed = pendingBatchSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function markPendingBatch(
  batchId: string,
  status: PendingStatus,
  reviewedAt?: string
): Promise<PendingBatch> {
  const batch = await readPendingBatch(batchId);
  if (!batch) throw new Error(`找不到批次 ${batchId}`);
  const next: PendingBatch = {
    ...batch,
    status,
    ...(reviewedAt ? { reviewedAt } : {}),
  };
  await writePendingBatch(next);
  return next;
}

export async function removePendingBatch(batchId: string): Promise<void> {
  await rm(batchPath(batchId), { force: true });
}
