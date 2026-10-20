import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { domainFileSchema } from "../content/domains/schema";
import { DOMAINS, topicsOf } from "../content/domains";
import { validateQuestionShape } from "../lib/engine/answer";
import { fingerprintOf, normalizeStem, tokenize, jaccard } from "../lib/content/fingerprint";

/**
 * 全量题库校验 —— 与 `npm run validate:content` 同一套判据，
 * 但作为单元测试跑，保证「坏题无法进主干」。
 */

const CONTENT_DIR = join(process.cwd(), "content", "domains");

const files = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({
    file: f,
    data: domainFileSchema.parse(JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf-8"))),
  }));

test("12 个领域都有题库文件", () => {
  assert.equal(files.length, 12);
  for (const d of DOMAINS) {
    assert.ok(
      files.some((f) => f.file === `${d.id}.json`),
      `缺少 ${d.id}.json`
    );
  }
});

test("文件内 domain 与文件名一致", () => {
  for (const f of files) {
    assert.equal(f.data.domain, f.file.replace(/\.json$/, ""));
  }
});

test("首批 6 个领域题量均 ≥ 40", () => {
  const batch1 = DOMAINS.filter((d) => d.batch === 1);
  for (const d of batch1) {
    const f = files.find((x) => x.file === `${d.id}.json`)!;
    assert.ok(f.data.questions.length >= 40, `${d.id} 题量仅 ${f.data.questions.length}`);
  }
});

test("全部 12 个领域：题量 ≥ 40 且已上线", () => {
  for (const d of DOMAINS) {
    const f = files.find((x) => x.file === `${d.id}.json`)!;
    assert.ok(f.data.questions.length >= 40, `${d.id} 题量仅 ${f.data.questions.length}`);
    assert.equal(d.enabled, true, `${d.id} 应标记为已上线`);
  }
});

test("已上线域的 enabled 与批次一致", () => {
  for (const d of DOMAINS.filter((x) => x.batch === 1)) {
    assert.equal(d.enabled, true, `${d.id} 应标记为已上线`);
  }
});

test("id 全局唯一且前缀与领域一致", () => {
  const seen = new Set<string>();
  for (const f of files) {
    for (const q of f.data.questions) {
      assert.ok(!seen.has(q.id), `id 重复：${q.id}`);
      seen.add(q.id);
      assert.ok(q.id.startsWith(`${f.data.domain}-`), `id 前缀错误：${q.id}`);
    }
  }
});

test("题干指纹全局唯一（无重复题）", () => {
  const seen = new Map<string, string>();
  for (const f of files) {
    for (const q of f.data.questions) {
      const fp = fingerprintOf(q.stem);
      assert.ok(!seen.has(fp), `重复题干：${q.id} 与 ${seen.get(fp)}`);
      seen.set(fp, q.id);
    }
  }
});

test("同域内无高度相似题干（Jaccard ≤ 0.85）", () => {
  for (const f of files) {
    const list = f.data.questions.map((q) => ({
      id: q.id,
      tokens: tokenize(normalizeStem(q.stem)),
    }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const sim = jaccard(list[i].tokens, list[j].tokens);
        assert.ok(sim <= 0.85, `${list[i].id} 与 ${list[j].id} 相似度 ${sim.toFixed(3)}`);
      }
    }
  }
});

test("每道题的 topic 命中所属域的白名单", () => {
  for (const f of files) {
    const topics = topicsOf(f.data.domain);
    for (const q of f.data.questions) {
      assert.ok(topics.includes(q.topic), `${q.id} 的 topic「${q.topic}」不在白名单内`);
    }
  }
});

test("每道题的结构合法：答案命中选项、解析非空、选项不重复", () => {
  for (const f of files) {
    for (const q of f.data.questions) {
      const errors = validateQuestionShape({
        type: q.type,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
      });
      assert.deepEqual(errors, [], `${q.id}: ${errors.join("；")}`);
    }
  }
});

test("判断题选项固定为 [正确, 错误]", () => {
  for (const f of files) {
    for (const q of f.data.questions) {
      if (q.type === "judge") {
        assert.deepEqual(q.options, ["正确", "错误"], `${q.id} 判断题选项不合法`);
      }
    }
  }
});

test("多选题答案已按字典序排序", () => {
  for (const f of files) {
    for (const q of f.data.questions) {
      if (q.type === "multi" && Array.isArray(q.answer)) {
        assert.deepEqual(q.answer, [...q.answer].sort(), `${q.id} 多选题答案未排序`);
      }
    }
  }
});

test("难度分布覆盖 1/2/3", () => {
  for (const f of files.filter((x) => x.data.questions.length > 0)) {
    const levels = new Set(f.data.questions.map((q) => q.difficulty));
    assert.ok(levels.has(1), `${f.data.domain} 缺难度 1`);
    assert.ok(levels.has(2), `${f.data.domain} 缺难度 2`);
    assert.ok(levels.has(3), `${f.data.domain} 缺难度 3`);
  }
});

test("题干与解析长度合理", () => {
  for (const f of files) {
    for (const q of f.data.questions) {
      assert.ok(q.stem.length >= 4 && q.stem.length <= 300, `${q.id} 题干长度异常`);
      assert.ok(q.explanation.length >= 10, `${q.id} 解析过短`);
    }
  }
});

test("选项内容无重复（全库）", () => {
  for (const f of files) {
    for (const q of f.data.questions) {
      assert.equal(new Set(q.options).size, q.options.length, `${q.id} 选项重复`);
    }
  }
});
