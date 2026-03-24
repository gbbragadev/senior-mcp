import crypto from 'crypto';
import axios from 'axios';

const VOYAGE_EMBEDDINGS_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
type EmbeddingInputType = 'document' | 'query';

interface ModelUsageEntry {
  requests: number;
  fallbackRequests: number;
  tokensUsed: number;
  estimatedInputTokens: number;
  budgetDeprioritized: number;
}

export interface VoyageEmbeddingConfig {
  apiKey: string;
  model: string;
  fallbackModels: string[];
  dimensions: number;
  timeoutMs: number;
  tokenLowWatermarkRatio: number;
  modelTokenBudgets: Record<string, number>;
}

export class VoyageEmbeddingService {
  private readonly config: VoyageEmbeddingConfig;
  private readonly usageByModel: Map<string, ModelUsageEntry>;

  constructor(config?: Partial<VoyageEmbeddingConfig>) {
    const fallbackModels = this.resolveFallbackModels(
      process.env.EMBEDDING_FALLBACK_MODELS || '',
      ['voyage-4-large', 'voyage-4-lite']
    );
    const modelTokenBudgets = this.parseModelNumberMap(process.env.EMBEDDING_MODEL_TOKEN_BUDGETS_JSON);
    const modelUsageSeed = this.parseModelNumberMap(process.env.EMBEDDING_MODEL_TOKENS_USED_JSON);

    this.config = {
      apiKey: process.env.VOYAGE_API_KEY || '',
      model: process.env.EMBEDDING_MODEL || 'voyage-4',
      fallbackModels,
      dimensions: Number(process.env.EMBEDDING_DIM || 1024),
      timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 45000),
      tokenLowWatermarkRatio: this.normalizeRatio(
        process.env.EMBEDDING_TOKEN_LOW_WATERMARK_RATIO,
        0.1
      ),
      modelTokenBudgets,
      ...config,
    };

    this.usageByModel = new Map<string, ModelUsageEntry>();
    for (const [model, usedTokens] of Object.entries(modelUsageSeed)) {
      this.usageByModel.set(model, {
        requests: 0,
        fallbackRequests: 0,
        tokensUsed: Math.max(0, Math.round(usedTokens)),
        estimatedInputTokens: 0,
        budgetDeprioritized: 0,
      });
    }
  }

  isEnabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  getConfigSummary() {
    return {
      enabled: this.isEnabled(),
      model: this.config.model,
      fallbackModels: this.config.fallbackModels,
      dimensions: this.config.dimensions,
      timeoutMs: this.config.timeoutMs,
      tokenPolicy: {
        lowWatermarkRatio: this.config.tokenLowWatermarkRatio,
        modelBudgets: this.config.modelTokenBudgets,
      },
      usage: this.buildUsageSummary(),
    };
  }

  async embedDocuments(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    if (!this.isEnabled()) {
      return inputs.map((text) => this.fallbackEmbedding(text));
    }

    const requestResult = await this.requestEmbeddingsWithFallback(inputs, 'document');

    const embeddings = Array.isArray(requestResult.response.data?.data)
      ? requestResult.response.data.data.map((item: any) => this.normalizeEmbedding(item?.embedding))
      : [];

    if (embeddings.length !== inputs.length) {
      throw new Error(
        `Unexpected embeddings response size: expected ${inputs.length}, got ${embeddings.length}`
      );
    }
    return embeddings;
  }

  async embedQuery(input: string): Promise<number[] | null> {
    const cleaned = String(input || '').trim();
    if (!cleaned) return null;
    if (!this.isEnabled()) return this.fallbackEmbedding(cleaned);

    const requestResult = await this.requestEmbeddingsWithFallback([cleaned], 'query');

    const embedding = requestResult.response.data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('Invalid embedding response payload for query');
    }
    return this.normalizeEmbedding(embedding);
  }

  normalizeEmbedding(raw: unknown): number[] {
    const dim = this.config.dimensions;
    const arr = Array.isArray(raw) ? raw.map((value) => Number(value) || 0) : [];
    if (arr.length === dim) return arr;
    if (arr.length > dim) return arr.slice(0, dim);
    if (arr.length === 0) return new Array(dim).fill(0);
    return [...arr, ...new Array(dim - arr.length).fill(0)];
  }

  private resolveCandidateModels(): string[] {
    const models = [this.config.model, ...this.config.fallbackModels]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const uniqueModels = Array.from(new Set(models));
    if (Object.keys(this.config.modelTokenBudgets).length === 0) {
      return uniqueModels;
    }

    const eligible: string[] = [];
    const lowWatermark: string[] = [];
    for (const model of uniqueModels) {
      if (this.isModelUnderLowWatermark(model)) {
        this.ensureUsage(model).budgetDeprioritized += 1;
        lowWatermark.push(model);
      } else {
        eligible.push(model);
      }
    }

    if (eligible.length === 0) {
      return uniqueModels;
    }
    return [...eligible, ...lowWatermark];
  }

  private async requestEmbeddingsWithFallback(inputs: string[], inputType: EmbeddingInputType) {
    const models = this.resolveCandidateModels();
    let lastError: unknown = null;

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      try {
        const response = await axios.post(
          VOYAGE_EMBEDDINGS_ENDPOINT,
          {
            input: inputs,
            model,
            input_type: inputType,
            output_dimension: this.config.dimensions,
          },
          {
            timeout: this.config.timeoutMs,
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        this.recordUsage(model, inputs, response.data, i > 0);
        return { response, model };
      } catch (error) {
        lastError = error;
        if (!this.shouldTryNextModel(error, i < models.length - 1)) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Embeddings request failed for all configured models');
  }

  private shouldTryNextModel(error: any, hasNextModel: boolean): boolean {
    if (!hasNextModel) return false;
    const status = Number(error?.response?.status || 0);
    const payload = error?.response?.data;
    const text = String(
      payload?.detail || payload?.message || payload?.error || error?.message || ''
    ).toLowerCase();

    if (status === 401) return false;
    if (status === 429 || status === 402 || status === 403) return true;
    if (status >= 500) return true;
    if (status === 400 && (text.includes('not supported') || text.includes('unknown model'))) {
      return true;
    }

    return (
      text.includes('quota') ||
      text.includes('rate limit') ||
      text.includes('capacity') ||
      text.includes('temporarily unavailable')
    );
  }

  private recordUsage(model: string, inputs: string[], payload: any, usedFallback: boolean) {
    const usage = this.ensureUsage(model);
    usage.requests += 1;
    if (usedFallback) {
      usage.fallbackRequests += 1;
    }
    usage.estimatedInputTokens += this.estimateTokenCount(inputs);
    usage.tokensUsed += this.extractUsageTokens(payload);
  }

  private extractUsageTokens(payload: any): number {
    const usage = payload?.usage || {};
    const fields = [
      usage.total_tokens,
      usage.input_tokens,
      usage.prompt_tokens,
      usage.tokens,
      usage.totalTokens,
      usage.inputTokens,
    ];

    for (const candidate of fields) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return Math.round(value);
      }
    }

    return 0;
  }

  private estimateTokenCount(inputs: string[]): number {
    return inputs.reduce((sum, value) => sum + Math.ceil(String(value || '').length / 4), 0);
  }

  private ensureUsage(model: string): ModelUsageEntry {
    const normalized = String(model || '').trim();
    const current = this.usageByModel.get(normalized);
    if (current) return current;
    const created: ModelUsageEntry = {
      requests: 0,
      fallbackRequests: 0,
      tokensUsed: 0,
      estimatedInputTokens: 0,
      budgetDeprioritized: 0,
    };
    this.usageByModel.set(normalized, created);
    return created;
  }

  private isModelUnderLowWatermark(model: string): boolean {
    const budget = Number(this.config.modelTokenBudgets[model]);
    if (!Number.isFinite(budget) || budget <= 0) return false;
    const used = this.ensureUsage(model).tokensUsed;
    const remaining = Math.max(0, budget - used);
    const ratio = remaining / budget;
    return ratio <= this.config.tokenLowWatermarkRatio;
  }

  private buildUsageSummary() {
    const models = Array.from(new Set([this.config.model, ...this.config.fallbackModels]));
    const perModel = models.map((model) => {
      const usage = this.ensureUsage(model);
      const budgetRaw = this.config.modelTokenBudgets[model];
      const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.round(budgetRaw) : null;
      const remaining = budget === null ? null : Math.max(0, budget - usage.tokensUsed);
      const remainingRatio = budget === null || remaining === null ? null : remaining / budget;

      return {
        model,
        requests: usage.requests,
        fallbackRequests: usage.fallbackRequests,
        tokensUsed: usage.tokensUsed,
        estimatedInputTokens: usage.estimatedInputTokens,
        budgetTokens: budget,
        remainingTokens: remaining,
        remainingRatio,
        underLowWatermark:
          remainingRatio === null ? false : remainingRatio <= this.config.tokenLowWatermarkRatio,
        budgetDeprioritized: usage.budgetDeprioritized,
      };
    });

    return {
      perModel,
      totals: {
        requests: perModel.reduce((sum, item) => sum + item.requests, 0),
        fallbackRequests: perModel.reduce((sum, item) => sum + item.fallbackRequests, 0),
        tokensUsed: perModel.reduce((sum, item) => sum + item.tokensUsed, 0),
        estimatedInputTokens: perModel.reduce((sum, item) => sum + item.estimatedInputTokens, 0),
      },
    };
  }

  private normalizeRatio(raw: unknown, fallback: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, 0), 1);
  }

  private resolveFallbackModels(raw: string, fallbackModels: string[]): string[] {
    const parsed = String(raw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (parsed.length > 0) {
      return parsed;
    }

    return fallbackModels;
  }

  private parseModelNumberMap(raw: unknown): Record<string, number> {
    const text = String(raw || '').trim();
    if (!text) return {};

    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const output: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const num = Number(value);
        if (!key || !Number.isFinite(num) || num <= 0) continue;
        output[String(key).trim()] = num;
      }
      return output;
    } catch {
      return {};
    }
  }

  private fallbackEmbedding(text: string): number[] {
    const dim = this.config.dimensions;
    const output = new Array(dim).fill(0);
    const hash = crypto.createHash('sha256').update(text).digest();
    for (let i = 0; i < dim; i += 1) {
      const byte = hash[i % hash.length];
      output[i] = (byte - 128) / 128;
    }
    return output;
  }
}
