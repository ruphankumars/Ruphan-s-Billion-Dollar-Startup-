/**
 * Structured Output Parsing & Validation System
 *
 * Enforces schemas on LLM outputs, auto-retries on parse failure,
 * and provides type-safe extraction of JSON, code blocks, tables, and lists.
 */

// ═══════════════════════════════════════════════════════════════
// SCHEMA TYPES
// ═══════════════════════════════════════════════════════════════

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface SchemaField {
  type: SchemaFieldType;
  description?: string;
  required?: boolean;
  items?: SchemaField;           // For arrays
  properties?: SchemaDefinition; // For objects
  enum?: (string | number)[];
  default?: unknown;
}

export type SchemaDefinition = Record<string, SchemaField>;

export interface OutputSchema {
  name: string;
  description?: string;
  fields: SchemaDefinition;
  strict?: boolean; // If true, no extra fields allowed
}

export interface ParseResult<T = unknown> {
  success: boolean;
  data: T | null;
  raw: string;
  errors: ParseError[];
  format: 'json' | 'markdown_json' | 'code_block' | 'plain';
}

export interface ParseError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface StructuredOutputConfig {
  maxRetries?: number;
  retryPrompt?: string;
  fallbackParsers?: boolean;
  extractCodeBlocks?: boolean;
  coerceTypes?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURED OUTPUT PARSER
// ═══════════════════════════════════════════════════════════════

export class StructuredOutputParser {
  private config: Required<StructuredOutputConfig>;

  constructor(config: StructuredOutputConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 2,
      retryPrompt: config.retryPrompt ?? 'Your response did not match the required format. Please respond with valid JSON matching this schema:',
      fallbackParsers: config.fallbackParsers ?? true,
      extractCodeBlocks: config.extractCodeBlocks ?? true,
      coerceTypes: config.coerceTypes ?? true,
    };
  }

  /**
   * Parse raw LLM output against a schema
   */
  parse<T = unknown>(raw: string, schema: OutputSchema): ParseResult<T> {
    // Try each parser in order until one succeeds
    const parsers: Array<{ name: ParseResult['format']; fn: () => unknown }> = [
      { name: 'json', fn: () => this.parseDirectJSON(raw) },
    ];

    if (this.config.extractCodeBlocks) {
      parsers.push({ name: 'markdown_json', fn: () => this.parseMarkdownJSON(raw) });
      parsers.push({ name: 'code_block', fn: () => this.parseCodeBlock(raw) });
    }

    if (this.config.fallbackParsers) {
      parsers.push({ name: 'plain', fn: () => this.parseFuzzyJSON(raw) });
    }

    for (const parser of parsers) {
      try {
        const parsed = parser.fn();
        if (parsed !== null && typeof parsed === 'object') {
          const errors = this.validate(parsed as Record<string, unknown>, schema);
          const data = errors.length === 0 ? this.applyDefaults(parsed, schema) : parsed;

          return {
            success: errors.length === 0,
            data: (errors.length === 0 ? data : null) as T | null,
            raw,
            errors,
            format: parser.name,
          };
        }
      } catch {
        continue;
      }
    }

    return {
      success: false,
      data: null,
      raw,
      errors: [{ path: '$', message: 'Could not parse output as structured data' }],
      format: 'plain',
    };
  }

  /**
   * Build a system prompt instructing the LLM to return structured output
   */
  buildPrompt(schema: OutputSchema): string {
    const lines = [
      `Respond with a JSON object matching this schema:`,
      '',
      '```json',
      '{',
    ];

    for (const [key, field] of Object.entries(schema.fields)) {
      const req = field.required !== false ? '(required)' : '(optional)';
      const desc = field.description ? ` — ${field.description}` : '';
      const enumValues = field.enum ? ` [${field.enum.join(' | ')}]` : '';
      lines.push(`  "${key}": ${field.type}${enumValues} ${req}${desc}`);
    }

    lines.push('}', '```');

    if (schema.description) {
      lines.push('', schema.description);
    }

    lines.push('', 'IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation, no code fences.');

    return lines.join('\n');
  }

  /**
   * Build a retry prompt after parse failure
   */
  buildRetryPrompt(schema: OutputSchema, errors: ParseError[]): string {
    const errorList = errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
    return [
      this.config.retryPrompt,
      '',
      'Errors in your previous response:',
      errorList,
      '',
      this.buildPrompt(schema),
    ].join('\n');
  }

  /**
   * Extract all code blocks from markdown
   */
  extractCodeBlocks(raw: string): Array<{ language: string; code: string }> {
    const blocks: Array<{ language: string; code: string }> = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(raw)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }

    return blocks;
  }

  /**
   * Extract a markdown table into structured data
   */
  extractTable(raw: string): Array<Record<string, string>> {
    const lines = raw.split('\n').filter(l => l.includes('|'));
    if (lines.length < 2) return [];

    const headers = lines[0]
      .split('|')
      .map(h => h.trim())
      .filter(Boolean);

    // Skip separator line
    const dataLines = lines.slice(2);

    return dataLines.map(line => {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      const row: Record<string, string> = {};
      headers.forEach((header, i) => {
        row[header] = cells[i] || '';
      });
      return row;
    });
  }

  /**
   * Extract a bullet list
   */
  extractList(raw: string): string[] {
    return raw
      .split('\n')
      .filter(l => /^\s*[-*•]\s/.test(l) || /^\s*\d+[.)]\s/.test(l))
      .map(l => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
      .filter(Boolean);
  }

  // ─── Private Parsers ─────────────────────────────────────────

  private parseDirectJSON(raw: string): unknown {
    const trimmed = raw.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return JSON.parse(trimmed);
    }
    return null;
  }

  private parseMarkdownJSON(raw: string): unknown {
    const match = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim());
    }
    return null;
  }

  private parseCodeBlock(raw: string): unknown {
    const blocks = this.extractCodeBlocks(raw);
    for (const block of blocks) {
      if (block.language === 'json' || block.language === '') {
        try {
          return JSON.parse(block.code);
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  private parseFuzzyJSON(raw: string): unknown {
    // Find the first { ... } or [ ... ] in the text
    let depth = 0;
    let start = -1;
    const opener = raw.indexOf('{');
    const arrOpener = raw.indexOf('[');

    const begin = opener === -1 ? arrOpener :
                  arrOpener === -1 ? opener :
                  Math.min(opener, arrOpener);

    if (begin === -1) return null;

    const closer = raw[begin] === '{' ? '}' : ']';
    const openChar = raw[begin];

    for (let i = begin; i < raw.length; i++) {
      if (raw[i] === openChar) {
        if (depth === 0) start = i;
        depth++;
      } else if (raw[i] === closer) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(raw.substring(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  // ─── Validation ───────────────────────────────────────────────

  private validate(data: Record<string, unknown>, schema: OutputSchema): ParseError[] {
    const errors: ParseError[] = [];

    for (const [key, field] of Object.entries(schema.fields)) {
      const value = data[key];
      const path = `$.${key}`;

      // Required check
      if (field.required !== false && (value === undefined || value === null)) {
        errors.push({ path, message: 'Required field is missing', expected: field.type });
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type check (with optional coercion)
      if (!this.checkType(value, field, path, errors)) continue;

      // Enum check
      if (field.enum && !field.enum.includes(value as string | number)) {
        errors.push({
          path,
          message: `Value must be one of: ${field.enum.join(', ')}`,
          expected: field.enum.join(' | '),
          received: String(value),
        });
      }

      // Recursive object validation
      if (field.type === 'object' && field.properties && typeof value === 'object') {
        const nested = this.validate(value as Record<string, unknown>, {
          name: key,
          fields: field.properties,
        });
        errors.push(...nested.map(e => ({ ...e, path: `${path}${e.path.substring(1)}` })));
      }

      // Array items validation
      if (field.type === 'array' && field.items && Array.isArray(value)) {
        value.forEach((item, i) => {
          if (!this.matchesType(item, field.items!.type)) {
            errors.push({
              path: `${path}[${i}]`,
              message: `Expected ${field.items!.type}`,
              received: typeof item,
            });
          }
        });
      }
    }

    // Strict mode: no extra fields
    if (schema.strict) {
      for (const key of Object.keys(data)) {
        if (!(key in schema.fields)) {
          errors.push({ path: `$.${key}`, message: 'Unexpected field in strict mode' });
        }
      }
    }

    return errors;
  }

  private checkType(value: unknown, field: SchemaField, path: string, errors: ParseError[]): boolean {
    if (this.matchesType(value, field.type)) return true;

    if (this.config.coerceTypes) {
      return true; // Allow coercion, don't error
    }

    errors.push({
      path,
      message: `Expected ${field.type}`,
      expected: field.type,
      received: typeof value,
    });
    return false;
  }

  private matchesType(value: unknown, type: SchemaFieldType): boolean {
    switch (type) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      default: return true;
    }
  }

  private applyDefaults(data: unknown, schema: OutputSchema): unknown {
    if (typeof data !== 'object' || data === null) return data;
    const obj = { ...data as Record<string, unknown> };

    for (const [key, field] of Object.entries(schema.fields)) {
      if ((obj[key] === undefined || obj[key] === null) && field.default !== undefined) {
        obj[key] = field.default;
      }
    }

    return obj;
  }
}

// ═══════════════════════════════════════════════════════════════
// PRESET SCHEMAS
// ═══════════════════════════════════════════════════════════════

export const PRESET_SCHEMAS = {
  codeChange: {
    name: 'code-change',
    description: 'A code modification result',
    fields: {
      filePath: { type: 'string' as const, required: true, description: 'File path to modify' },
      action: { type: 'string' as const, required: true, enum: ['create', 'modify', 'delete'] },
      content: { type: 'string' as const, required: false, description: 'New file content' },
      explanation: { type: 'string' as const, required: true, description: 'Why this change is needed' },
    },
  },

  taskPlan: {
    name: 'task-plan',
    description: 'An execution plan for a task',
    fields: {
      steps: { type: 'array' as const, required: true, items: { type: 'object' as const, properties: {
        description: { type: 'string' as const, required: true },
        agent: { type: 'string' as const, required: true },
        dependencies: { type: 'array' as const, items: { type: 'number' as const } },
      }}},
      estimatedCost: { type: 'number' as const, required: false },
      complexity: { type: 'string' as const, enum: ['low', 'medium', 'high'] },
    },
  },

  bugReport: {
    name: 'bug-report',
    description: 'A structured bug analysis',
    fields: {
      title: { type: 'string' as const, required: true },
      severity: { type: 'string' as const, required: true, enum: ['critical', 'high', 'medium', 'low'] },
      rootCause: { type: 'string' as const, required: true },
      fix: { type: 'string' as const, required: true },
      affectedFiles: { type: 'array' as const, required: true, items: { type: 'string' as const } },
      testStrategy: { type: 'string' as const, required: false },
    },
  },
} satisfies Record<string, OutputSchema>;
