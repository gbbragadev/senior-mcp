export type KnowledgeDomain = 'docs' | 'lsp';

export interface KnowledgeChunkRecord {
  domain: KnowledgeDomain;
  chunkId: string;
  contentHash: string;
  text: string;
  metadata: Record<string, unknown>;
  context?: string | null;
  product?: string | null;
  version?: string | null;
  sourceUrl?: string | null;
  filePath?: string | null;
  module?: string | null;
  routineName?: string | null;
  headingPath?: string | null;
  lastModified?: string | null;
  crawlStrategy?: string | null;
}

export interface KnowledgeSearchFilters {
  domain: KnowledgeDomain;
  context?: string;
  product?: string;
  version?: string;
  module?: string;
  routineName?: string;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  domain: KnowledgeDomain;
  score: number;
  vectorScore: number;
  textScore: number;
  text: string;
  metadata: Record<string, unknown>;
  context?: string | null;
  product?: string | null;
  version?: string | null;
  sourceUrl?: string | null;
  filePath?: string | null;
  module?: string | null;
  routineName?: string | null;
  headingPath?: string | null;
}

export interface KnowledgeCatalogRow {
  domain: KnowledgeDomain;
  context: string | null;
  product: string | null;
  version: string | null;
  module: string | null;
  routineName: string | null;
  count: number;
}

export interface KnowledgeReindexStats {
  domain: KnowledgeDomain | 'all';
  scanned: number;
  indexed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}
