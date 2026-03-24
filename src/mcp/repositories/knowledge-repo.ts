import { QueryTypes } from 'sequelize';
import sequelize from '../../storage/db';
import {
  KnowledgeCatalogRow,
  KnowledgeChunkRecord,
  KnowledgeSearchFilters,
  KnowledgeSearchResult,
} from '../types';

interface SearchConfig {
  vectorWeight: number;
  textWeight: number;
  vectorCandidatePool: number;
  textCandidatePool: number;
}

export class KnowledgeRepository {
  async upsertChunk(record: KnowledgeChunkRecord, embedding: number[]): Promise<void> {
    const embeddingVector = this.embeddingToVectorLiteral(embedding);
    const metadata = JSON.stringify(record.metadata || {});
    const query = `
      INSERT INTO knowledge_chunks (
        domain,
        chunk_id,
        content_hash,
        text,
        metadata,
        context,
        product,
        version,
        source_url,
        file_path,
        module,
        routine_name,
        heading_path,
        last_modified,
        crawl_strategy,
        embedding,
        tsv,
        created_at,
        updated_at
      ) VALUES (
        :domain,
        :chunkId,
        :contentHash,
        :text,
        CAST(:metadata AS jsonb),
        :context,
        :product,
        :version,
        :sourceUrl,
        :filePath,
        :module,
        :routineName,
        :headingPath,
        :lastModified,
        :crawlStrategy,
        CAST(:embeddingVector AS vector),
        to_tsvector('simple', coalesce(:text, '')),
        now(),
        now()
      )
      ON CONFLICT (domain, content_hash) DO UPDATE SET
        domain = EXCLUDED.domain,
        chunk_id = EXCLUDED.chunk_id,
        text = EXCLUDED.text,
        metadata = EXCLUDED.metadata,
        context = EXCLUDED.context,
        product = EXCLUDED.product,
        version = EXCLUDED.version,
        source_url = EXCLUDED.source_url,
        file_path = EXCLUDED.file_path,
        module = EXCLUDED.module,
        routine_name = EXCLUDED.routine_name,
        heading_path = EXCLUDED.heading_path,
        last_modified = EXCLUDED.last_modified,
        crawl_strategy = EXCLUDED.crawl_strategy,
        embedding = EXCLUDED.embedding,
        tsv = EXCLUDED.tsv,
        updated_at = now();
    `;

    await sequelize.query(query, {
      type: QueryTypes.INSERT,
      replacements: {
        domain: record.domain,
        chunkId: record.chunkId,
        contentHash: record.contentHash,
        text: record.text,
        metadata,
        context: record.context || null,
        product: record.product || null,
        version: record.version || null,
        sourceUrl: record.sourceUrl || null,
        filePath: record.filePath || null,
        module: record.module || null,
        routineName: record.routineName || null,
        headingPath: record.headingPath || null,
        lastModified: record.lastModified || null,
        crawlStrategy: record.crawlStrategy || null,
        embeddingVector,
      },
    });
  }

  async markDomainMissingAsDeleted(domain: 'docs' | 'lsp', contentHashes: string[]): Promise<number> {
    if (contentHashes.length === 0) {
      const result = await sequelize.query(
        `DELETE FROM knowledge_chunks WHERE domain = :domain`,
        { type: QueryTypes.DELETE, replacements: { domain } }
      );
      return this.toAffectedCount(result);
    }

    const query = `
      DELETE FROM knowledge_chunks
      WHERE domain = :domain
      AND content_hash NOT IN (:hashes);
    `;
    const result = await sequelize.query(query, {
      type: QueryTypes.DELETE,
      replacements: {
        domain,
        hashes: contentHashes,
      },
    });
    return this.toAffectedCount(result);
  }

  async searchHybrid(
    query: string,
    filters: KnowledgeSearchFilters,
    topK: number,
    queryEmbedding: number[] | null,
    config: SearchConfig
  ): Promise<KnowledgeSearchResult[]> {
    if (!queryEmbedding) {
      return this.searchTextOnly(query, filters, topK);
    }

    const embeddingVector = this.embeddingToVectorLiteral(queryEmbedding);
    const vectorCandidatePool = Math.max(
      topK,
      Math.min(Math.max(1, Number(config.vectorCandidatePool || topK)), 500)
    );
    const textCandidatePool = Math.max(
      topK,
      Math.min(Math.max(1, Number(config.textCandidatePool || topK)), 500)
    );
    const sql = `
      WITH vector_candidates AS (
        SELECT
          chunk_id,
          GREATEST(0, 1 - (embedding <=> CAST(:queryEmbedding AS vector))) AS vector_score,
          0::double precision AS text_score
        FROM knowledge_chunks
        WHERE domain = :domain
          AND (:context IS NULL OR context = :context)
          AND (:product IS NULL OR product = :product)
          AND (:version IS NULL OR version = :version)
          AND (:module IS NULL OR module = :module)
          AND (:routineName IS NULL OR routine_name = :routineName)
        ORDER BY embedding <=> CAST(:queryEmbedding AS vector)
        LIMIT :vectorCandidatePool
      ),
      text_candidates AS (
        SELECT
          chunk_id,
          0::double precision AS vector_score,
          ts_rank_cd(tsv, websearch_to_tsquery('simple', :query)) AS text_score
        FROM knowledge_chunks
        WHERE domain = :domain
          AND (:context IS NULL OR context = :context)
          AND (:product IS NULL OR product = :product)
          AND (:version IS NULL OR version = :version)
          AND (:module IS NULL OR module = :module)
          AND (:routineName IS NULL OR routine_name = :routineName)
        ORDER BY text_score DESC
        LIMIT :textCandidatePool
      ),
      candidates AS (
        SELECT * FROM vector_candidates
        UNION ALL
        SELECT * FROM text_candidates
      ),
      ranked AS (
        SELECT
          chunk_id,
          MAX(vector_score) AS vector_score,
          MAX(text_score) AS text_score
        FROM candidates
        GROUP BY chunk_id
      )
      SELECT
        k.chunk_id AS "chunkId",
        k.domain,
        k.text,
        k.metadata,
        k.context,
        k.product,
        k.version,
        k.source_url AS "sourceUrl",
        k.file_path AS "filePath",
        k.module,
        k.routine_name AS "routineName",
        k.heading_path AS "headingPath",
        ranked.vector_score AS "vectorScore",
        ranked.text_score AS "textScore",
        (:vectorWeight * ranked.vector_score + :textWeight * ranked.text_score) AS score
      FROM ranked
      JOIN knowledge_chunks k ON k.chunk_id = ranked.chunk_id
      ORDER BY score DESC, ranked.vector_score DESC, ranked.text_score DESC
      LIMIT :topK;
    `;

    const rows = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        query,
        queryEmbedding: embeddingVector,
        domain: filters.domain,
        context: filters.context || null,
        product: filters.product || null,
        version: filters.version || null,
        module: filters.module || null,
        routineName: filters.routineName || null,
        vectorWeight: config.vectorWeight,
        textWeight: config.textWeight,
        vectorCandidatePool,
        textCandidatePool,
        topK,
      },
    });

    return (rows as any[]).map((row) => ({
      chunkId: row.chunkId,
      domain: row.domain,
      score: Number(row.score) || 0,
      vectorScore: Number(row.vectorScore) || 0,
      textScore: Number(row.textScore) || 0,
      text: row.text,
      metadata: row.metadata || {},
      context: row.context,
      product: row.product,
      version: row.version,
      sourceUrl: row.sourceUrl,
      filePath: row.filePath,
      module: row.module,
      routineName: row.routineName,
      headingPath: row.headingPath,
    }));
  }

  async searchTextOnly(
    query: string,
    filters: KnowledgeSearchFilters,
    topK: number
  ): Promise<KnowledgeSearchResult[]> {
    const sql = `
      SELECT
        chunk_id AS "chunkId",
        domain,
        text,
        metadata,
        context,
        product,
        version,
        source_url AS "sourceUrl",
        file_path AS "filePath",
        module,
        routine_name AS "routineName",
        heading_path AS "headingPath",
        ts_rank_cd(tsv, websearch_to_tsquery('simple', :query)) AS score
      FROM knowledge_chunks
      WHERE domain = :domain
        AND (:context IS NULL OR context = :context)
        AND (:product IS NULL OR product = :product)
        AND (:version IS NULL OR version = :version)
        AND (:module IS NULL OR module = :module)
        AND (:routineName IS NULL OR routine_name = :routineName)
      ORDER BY score DESC
      LIMIT :topK;
    `;

    const rows = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        query,
        domain: filters.domain,
        context: filters.context || null,
        product: filters.product || null,
        version: filters.version || null,
        module: filters.module || null,
        routineName: filters.routineName || null,
        topK,
      },
    });

    return (rows as any[]).map((row) => ({
      chunkId: row.chunkId,
      domain: row.domain,
      score: Number(row.score) || 0,
      vectorScore: 0,
      textScore: Number(row.score) || 0,
      text: row.text,
      metadata: row.metadata || {},
      context: row.context,
      product: row.product,
      version: row.version,
      sourceUrl: row.sourceUrl,
      filePath: row.filePath,
      module: row.module,
      routineName: row.routineName,
      headingPath: row.headingPath,
    }));
  }

  async getByChunkId(chunkId: string) {
    const rows = await sequelize.query(
      `
      SELECT
        domain,
        chunk_id AS "chunkId",
        content_hash AS "contentHash",
        text,
        metadata,
        context,
        product,
        version,
        source_url AS "sourceUrl",
        file_path AS "filePath",
        module,
        routine_name AS "routineName",
        heading_path AS "headingPath",
        last_modified AS "lastModified",
        crawl_strategy AS "crawlStrategy"
      FROM knowledge_chunks
      WHERE chunk_id = :chunkId
      LIMIT 1;
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { chunkId },
      }
    );

    return (rows as any[])[0] || null;
  }

  async listCatalog(domain: 'docs' | 'lsp' | 'all' = 'all'): Promise<KnowledgeCatalogRow[]> {
    const sql = `
      SELECT
        domain,
        context,
        product,
        version,
        module,
        routine_name AS "routineName",
        COUNT(*)::int AS count
      FROM knowledge_chunks
      WHERE (:domain = 'all' OR domain = :domain)
      GROUP BY domain, context, product, version, module, routine_name
      ORDER BY domain, context, product, version, module, routine_name;
    `;
    const rows = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: { domain },
    });
    return rows as KnowledgeCatalogRow[];
  }

  async stats() {
    const rows = await sequelize.query(
      `
      SELECT domain, COUNT(*)::int AS count
      FROM knowledge_chunks
      GROUP BY domain
      ORDER BY domain;
      `,
      { type: QueryTypes.SELECT }
    );

    const byDomain: Record<string, number> = {};
    let total = 0;
    for (const row of rows as any[]) {
      byDomain[row.domain] = Number(row.count) || 0;
      total += Number(row.count) || 0;
    }
    return { total, byDomain };
  }

  private embeddingToVectorLiteral(values: number[]): string {
    return `[${values.map((value) => Number(value).toFixed(8)).join(',')}]`;
  }

  private toAffectedCount(result: unknown): number {
    if (typeof result === 'number') return result;
    if (Array.isArray(result)) {
      const maybeCount = result.find((value) => typeof value === 'number');
      if (typeof maybeCount === 'number') return maybeCount;
    }
    return 0;
  }
}
