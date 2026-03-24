import { KnowledgeRepository } from '../repositories/knowledge-repo';
import { KnowledgeSearchFilters, KnowledgeSearchResult } from '../types';
import { VoyageEmbeddingService } from './embeddings';

export class KnowledgeSearchService {
  private readonly repository: KnowledgeRepository;
  private readonly embeddingService: VoyageEmbeddingService;
  private readonly defaultTopK: number;
  private readonly docsVectorWeight: number;
  private readonly docsTextWeight: number;
  private readonly lspVectorWeight: number;
  private readonly lspTextWeight: number;
  private readonly vectorCandidatePool: number;
  private readonly textCandidatePool: number;

  constructor(repository?: KnowledgeRepository, embeddingService?: VoyageEmbeddingService) {
    this.repository = repository || new KnowledgeRepository();
    this.embeddingService = embeddingService || new VoyageEmbeddingService();
    this.defaultTopK = Number(process.env.KNOWLEDGE_TOP_K_DEFAULT || 8);

    const legacyVectorWeight = this.parseOptionalWeight(process.env.KNOWLEDGE_VECTOR_WEIGHT);
    const legacyTextWeight = this.parseOptionalWeight(process.env.KNOWLEDGE_TEXT_WEIGHT);

    this.docsVectorWeight = this.normalizeWeight(
      process.env.KNOWLEDGE_VECTOR_WEIGHT_DOCS,
      legacyVectorWeight,
      0.75
    );
    this.docsTextWeight = this.normalizeWeight(
      process.env.KNOWLEDGE_TEXT_WEIGHT_DOCS,
      legacyTextWeight,
      0.25
    );
    this.lspVectorWeight = this.normalizeWeight(
      process.env.KNOWLEDGE_VECTOR_WEIGHT_LSP,
      legacyVectorWeight,
      0.65
    );
    this.lspTextWeight = this.normalizeWeight(
      process.env.KNOWLEDGE_TEXT_WEIGHT_LSP,
      legacyTextWeight,
      0.35
    );

    this.vectorCandidatePool = this.normalizeCandidatePool(
      process.env.KNOWLEDGE_CANDIDATE_POOL_VECTOR,
      80
    );
    this.textCandidatePool = this.normalizeCandidatePool(
      process.env.KNOWLEDGE_CANDIDATE_POOL_TEXT,
      80
    );
  }

  async search(
    query: string,
    filters: KnowledgeSearchFilters,
    topK?: number
  ): Promise<KnowledgeSearchResult[]> {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];
    const limit = Math.max(1, Math.min(Number(topK || this.defaultTopK), 30));
    const embedding = await this.embeddingService.embedQuery(normalizedQuery);
    const weights = this.resolveDomainWeights(filters.domain);
    return this.repository.searchHybrid(normalizedQuery, filters, limit, embedding, {
      vectorWeight: weights.vectorWeight,
      textWeight: weights.textWeight,
      vectorCandidatePool: this.vectorCandidatePool,
      textCandidatePool: this.textCandidatePool,
    });
  }

  async getChunk(chunkId: string) {
    return this.repository.getByChunkId(chunkId);
  }

  async listCatalog(domain: 'docs' | 'lsp' | 'all' = 'all') {
    return this.repository.listCatalog(domain);
  }

  async stats() {
    const repositoryStats = await this.repository.stats();
    const embeddingConfig = this.embeddingService.getConfigSummary();
    return {
      ...repositoryStats,
      embedding: embeddingConfig,
      search: this.getSearchConfigSummary(),
    };
  }

  private resolveDomainWeights(domain: 'docs' | 'lsp') {
    if (domain === 'lsp') {
      return {
        vectorWeight: this.lspVectorWeight,
        textWeight: this.lspTextWeight,
      };
    }
    return {
      vectorWeight: this.docsVectorWeight,
      textWeight: this.docsTextWeight,
    };
  }

  private normalizeCandidatePool(raw: unknown, fallback: number): number {
    const value = Number(raw);
    const normalized = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
    return Math.min(Math.max(normalized, 1), 500);
  }

  private normalizeWeight(
    raw: unknown,
    legacyFallback: number | null,
    defaultValue: number
  ): number {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }

    if (legacyFallback !== null && Number.isFinite(legacyFallback) && legacyFallback >= 0) {
      return legacyFallback;
    }

    return defaultValue;
  }

  private parseOptionalWeight(raw: unknown): number | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }

  private getSearchConfigSummary() {
    return {
      defaultTopK: this.defaultTopK,
      candidatePool: {
        vector: this.vectorCandidatePool,
        text: this.textCandidatePool,
      },
      weights: {
        docs: {
          vector: this.docsVectorWeight,
          text: this.docsTextWeight,
        },
        lsp: {
          vector: this.lspVectorWeight,
          text: this.lspTextWeight,
        },
      },
    };
  }
}
