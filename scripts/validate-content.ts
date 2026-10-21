/**
 * 题库校验脚本 —— CI 必跑。
 *
 * 校验对象：`content/domains/*.json` 全部 12 个文件。
 *
 * **校验项与级别（错误 / 警告）的唯一真相源是 [`docs/CONTENT.md`](../docs/CONTENT.md) §2**，
 * 本脚本不另列一份清单 —— 两处编号迟早会打架。
 * 代码里的行内注释用「CONTENT.md §2 规则 N」回指。
 *
 * 退出码：0 = 通过；1 = 存在阻断级错误。
 *
 * 用法：`npm run validate:content`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { domainFileSchema } from "../content/domains/schema";
import { DOMAINS, topicsOf } from "../content/domains/index";
import { validateQuestionShape } from "../lib/engine/answer";
import { fingerprintOf, normalizeStem, tokenize, jaccard } from "../lib/content/fingerprint";
import { scanSensitive } from "../lib/content/sensitive";

const CONTENT_DIR = join(process.cwd(), "content", "domains");
const MIN_QUESTIONS = 40;
/** 同域内近似重复的 Jaccard 阈值。 */
const NEAR_DUP_THRESHOLD = 0.85;

interface Problem {
  level: "error" | "warn";
  file: string;
  id: string;
  message: string;
}

const problems: Problem[] = [];
const err = (file: string, id: string, message: string) =>
  problems.push({ level: "error", file, id, message });
const warn = (file: string, id: string, message: string) =>
  problems.push({ level: "warn", file, id, message });

/** 全局 id / 指纹登记表。 */
const seenIds = new Map<string, string>();
const seenFingerprints = new Map<string, string>();
/** 每个域的题干 token 集，用于近似查重。 */
const domainTokens = new Map<string, { id: string; tokens: Set<string> }[]>();

function main(): void {
  const files = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  // 规则 13：文件与领域元数据一一对应，文件名即域名
  const expected = new Set(DOMAINS.map((d) => `${d.id}.json`));
  for (const f of files) {
    if (!expected.has(f)) err(f, "-", `存在未在领域元数据中登记的题库文件`);
  }
  for (const d of DOMAINS) {
    if (!files.includes(`${d.id}.json`)) err(`${d.id}.json`, "-", "缺少该领域的题库文件");
  }

  let totalQuestions = 0;

  for (const file of files) {
    const raw = readFileSync(join(CONTENT_DIR, file), "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      err(file, "-", `JSON 解析失败：${(e as Error).message}`);
      continue;
    }

    const result = domainFileSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        err(file, path || "-", issue.message);
      }
      continue;
    }

    const { domain, questions } = result.data;
    const expectedDomain = file.replace(/\.json$/, "");
    if (domain !== expectedDomain) {
      err(file, "-", `文件域名 (${domain}) 与文件名 (${expectedDomain}) 不一致`);
    }

    const meta = DOMAINS.find((d) => d.id === domain);
    const topics = topicsOf(domain);
    const tokenList: { id: string; tokens: Set<string> }[] = [];

    for (const q of questions) {
      totalQuestions++;

      // 规则 2：id 全局唯一
      const prevId = seenIds.get(q.id);
      if (prevId) err(file, q.id, `id 重复（已存在于 ${prevId}）`);
      else seenIds.set(q.id, file);

      // id 前缀必须与领域一致
      if (!q.id.startsWith(`${domain}-`)) {
        err(file, q.id, `id 前缀应为 ${domain}-`);
      }

      // 规则 3：指纹全局唯一（归一化后比较，能抓出只差标点空白的重复题）
      const fp = fingerprintOf(q.stem);
      const prevFp = seenFingerprints.get(fp);
      if (prevFp) err(file, q.id, `题干指纹重复（与 ${prevFp} 相同，可能是同一道题）`);
      else seenFingerprints.set(fp, q.id);

      // 规则 4：topic 白名单
      if (!topics.includes(q.topic)) {
        err(file, q.id, `topic「${q.topic}」不在 ${domain} 的白名单内`);
      }

      // 规则 5 / 6：选项、答案、解析（validateQuestionShape 单一裁判）
      const shapeErrors = validateQuestionShape({
        type: q.type,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
      });
      for (const e of shapeErrors) err(file, q.id, e);

      // 规则 8：多选题答案必须已按原始字符串字典序排序（保证文件存储形态稳定）
      if (q.type === "multi" && Array.isArray(q.answer)) {
        const rawSorted = [...q.answer].sort();
        if (rawSorted.join("|") !== q.answer.join("|")) {
          err(file, q.id, `多选题答案未按字典序排序，应为 ${JSON.stringify(rawSorted)}`);
        }
      }

      // 规则 9：判断题选项必须固定为 正确/错误
      if (q.type === "judge" && q.options.join("|") !== "正确|错误") {
        err(file, q.id, '判断题选项必须固定为 ["正确", "错误"]');
      }

      // 规则 14 / 15：内容安全（词表唯一来源 lib/content/sensitive.ts）
      // block 级直接阻断入库；review 级只提示人工复核 —— 事实题不该被词表判死。
      for (const hit of scanSensitive(q.stem, q.explanation, q.topic, ...q.options)) {
        if (hit.level === "block") {
          err(file, q.id, `命中阻断级内容安全词「${hit.term}」，不允许入库`);
        } else {
          warn(
            file,
            q.id,
            `涉及时政/领土/民族/宗教表述「${hit.term}」，请人工复核是否只在陈述事实`
          );
        }
      }

      // 规则 12：同域近似查重
      const tokens = tokenize(normalizeStem(q.stem));
      for (const other of tokenList) {
        if (jaccard(tokens, other.tokens) > NEAR_DUP_THRESHOLD) {
          warn(file, q.id, `与 ${other.id} 高度相似（Jaccard > ${NEAR_DUP_THRESHOLD}）`);
        }
      }
      tokenList.push({ id: q.id, tokens });
    }

    domainTokens.set(domain, tokenList);

    // 规则 10 / 11：题量与难度分布
    if (questions.length < MIN_QUESTIONS) {
      warn(file, "-", `题量 ${questions.length} 少于建议的 ${MIN_QUESTIONS} 题`);
    }
    const byDifficulty = { 1: 0, 2: 0, 3: 0 };
    for (const q of questions) byDifficulty[q.difficulty]++;
    if (questions.length > 0 && byDifficulty[3] === 0) {
      warn(file, "-", "缺少难度 3 的题目，难度曲线无法覆盖");
    }
    if (questions.length > 0 && byDifficulty[1] === 0) {
      warn(file, "-", "缺少难度 1 的题目，新玩家上手曲线会偏陡");
    }
  }

  // ---- 报告 ----
  console.log("题库校验报告");
  console.log("=".repeat(60));
  for (const d of DOMAINS) {
    const bank = domainTokens.get(d.id) ?? [];
    console.log(
      `  ${d.id.padEnd(12)} ${String(bank.length).padStart(3)} 题   批次 ${d.batch}   ${d.enabled ? "已上线" : "未上线"}`
    );
  }
  console.log("-".repeat(60));
  console.log(
    `  合计 ${totalQuestions} 题，${seenIds.size} 个唯一 id，${seenFingerprints.size} 个唯一指纹`
  );
  console.log("=".repeat(60));

  const errors = problems.filter((p) => p.level === "error");
  const warns = problems.filter((p) => p.level === "warn");

  for (const p of warns) {
    console.log(`  [警告] ${p.file} · ${p.id} · ${p.message}`);
  }
  for (const p of errors) {
    console.log(`  [错误] ${p.file} · ${p.id} · ${p.message}`);
  }

  if (errors.length > 0) {
    console.error(`\n题库校验失败：${errors.length} 个错误，${warns.length} 个警告。`);
    process.exit(1);
  }
  console.log(`\n题库校验通过：0 个错误，${warns.length} 个警告。`);
}

main();
