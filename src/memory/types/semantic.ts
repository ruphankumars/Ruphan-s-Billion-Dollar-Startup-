/**
 * Semantic Memory — Facts and knowledge
 * Stores learned facts about projects, technologies, patterns.
 * Things like "this project uses Express with TypeScript" or
 * "the auth middleware is in src/middleware/auth.ts"
 */

import type { SemanticMemoryEntry, MemoryMetadata } from '../types.js';
import { nanoid } from 'nanoid';

export interface SemanticFact {
  content: string;
  category: string;
  factType: 'definition' | 'relationship' | 'property' | 'rule';
  confidence?: number;
  tags?: string[];
  entities?: string[];
  project?: string;
  source?: string;
}

export class SemanticMemoryBuilder {
  /**
   * Create a semantic memory entry from a fact
   */
  static fromFact(fact: SemanticFact): SemanticMemoryEntry {
    const now = new Date();

    const metadata: MemoryMetadata = {
      source: fact.source ?? 'extraction',
      project: fact.project,
      tags: fact.tags ?? [],
      entities: fact.entities ?? [],
      relations: [],
      confidence: fact.confidence ?? 0.8,
    };

    const importance = this.calculateImportance(fact);

    return {
      id: nanoid(),
      type: 'semantic',
      content: fact.content,
      metadata,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      importance,
      decayFactor: 1.0, // Semantic memories decay slower
      category: fact.category,
      factType: fact.factType,
    };
  }

  /**
   * Extract semantic facts from a text description
   */
  static extractFacts(text: string, project?: string): SemanticFact[] {
    const facts: SemanticFact[] = [];

    // Extract technology mentions
    const techPatterns = [
      /uses?\s+([\w.]+(?:\s+with\s+[\w.]+)?)/gi,
      /built\s+(?:with|on|using)\s+([\w.]+)/gi,
      /(?:framework|library|tool):\s*([\w.]+)/gi,
    ];

    for (const pattern of techPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        facts.push({
          content: `Uses ${match[1]}`,
          category: 'technology',
          factType: 'property',
          project,
          entities: [match[1]],
        });
      }
    }

    // Extract file path mentions
    const pathPattern = /(?:in|at|file)\s+[`"]?([\w/.]+\.\w+)[`"]?/gi;
    let pathMatch;
    while ((pathMatch = pathPattern.exec(text)) !== null) {
      facts.push({
        content: `File ${pathMatch[1]} is referenced`,
        category: 'structure',
        factType: 'relationship',
        project,
        entities: [pathMatch[1]],
      });
    }

    return facts;
  }

  /**
   * Calculate importance for semantic memory
   * Rules and definitions are more important than properties
   */
  private static calculateImportance(fact: SemanticFact): number {
    const typeImportance: Record<string, number> = {
      rule: 0.9,
      definition: 0.8,
      relationship: 0.7,
      property: 0.6,
    };

    let importance = typeImportance[fact.factType] ?? 0.5;

    // Higher confidence = higher importance
    if (fact.confidence) {
      importance *= 0.7 + fact.confidence * 0.3;
    }

    return Math.min(1.0, importance);
  }

  /**
   * Check if two semantic memories potentially conflict
   */
  static conflicts(a: SemanticMemoryEntry, b: SemanticMemoryEntry): boolean {
    // Same category and overlapping entities might conflict
    if (a.category !== b.category) return false;

    const entitiesA = new Set(a.metadata.entities);
    const entitiesB = new Set(b.metadata.entities);
    const overlap = [...entitiesA].filter(e => entitiesB.has(e));

    if (overlap.length === 0) return false;

    // If they share entities but say different things, they might conflict
    return a.content !== b.content;
  }
}
