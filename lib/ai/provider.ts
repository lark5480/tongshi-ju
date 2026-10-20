/**
 * AI provider 抽象。
 *
 * ## 设计原则：AI 是可选增强，不是必需依赖
 *
 * 未配置任何环境变量时，`getProvider()` 返回 `null`，
 * 调用方必须走**降级路径**（用同域 seed 题兜底），绝不能让主链路因此报错。
 *
 * ## 密钥纪律
 *
 * API Key **只从服务端环境变量读取**，绝不进入浏览器 bundle。
 * 本文件只会被 `/api/ai/*` 这类服务端路由 import。
 */

export interface AiProvider {
  readonly name: string;
  /** 请求模型返回 JSON。失败时抛错，由调用方降级。 */
  generate(prompt: string, opts?: { maxTokens?: number }): Promise<unknown>;
}

interface OpenAiLikeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 读取环境变量并组装配置；不完整时返回 null。 */
function readOpenAiConfig(): OpenAiLikeConfig | null {
  const base = process.env.AI_API_BASE?.trim();
  const key = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!base || !key || !model) return null;
  return { baseUrl: base.replace(/\/+$/, ""), apiKey: key, model };
}

/** OpenAI 兼容协议（覆盖混元等国内模型，以及本地 vLLM / one-api 等网关）。 */
function openAiCompatible(cfg: OpenAiLikeConfig): AiProvider {
  return {
    name: `openai-compatible:${cfg.model}`,
    async generate(prompt, opts) {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            {
              role: "system",
              content:
                "你是一个严谨的知识竞赛出题助手。只输出 JSON，不要任何解释或 markdown 代码块。",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
          max_tokens: opts?.maxTokens ?? 3000,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new Error(`AI 请求失败：HTTP ${res.status} ${await res.text().catch(() => "")}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI 返回内容为空");
      return parseJsonLoose(content);
    },
  };
}

/** 本地 Ollama。 */
function ollama(cfg: { baseUrl: string; model: string }): AiProvider {
  return {
    name: `ollama:${cfg.model}`,
    async generate(prompt, opts) {
      const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            {
              role: "system",
              content:
                "你是一个严谨的知识竞赛出题助手。只输出 JSON，不要任何解释或 markdown 代码块。",
            },
            { role: "user", content: prompt },
          ],
          stream: false,
          format: "json",
          options: { num_predict: opts?.maxTokens ?? 3000 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Ollama 请求失败：HTTP ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new Error("Ollama 返回内容为空");
      return parseJsonLoose(content);
    },
  };
}

/**
 * 宽松解析模型输出。
 *
 * 模型经常把 JSON 包在 ```json 代码块里，或在前后加解释文字。
 * 这里先尝试直接解析，失败则提取第一个 `{...}` 片段再解析。
 * 注意：**解析失败必须抛错**，由校验链第 1 步拒绝该批次。
 */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试提取代码块 */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续尝试提取花括号片段 */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* 落到下面的抛错 */
    }
  }
  throw new Error("AI 输出不是合法 JSON");
}

/** 获取当前可用的 provider；未配置时返回 null（AI 管线整体禁用）。 */
export function getProvider(): AiProvider | null {
  const base = process.env.AI_API_BASE?.trim();
  const model = process.env.AI_MODEL?.trim();

  if (base && base.toLowerCase().startsWith("ollama") && model) {
    return ollama({ baseUrl: base, model });
  }
  const cfg = readOpenAiConfig();
  if (cfg) return openAiCompatible(cfg);
  return null;
}

/** AI 管线是否已启用。 */
export function isAiEnabled(): boolean {
  return getProvider() !== null;
}
