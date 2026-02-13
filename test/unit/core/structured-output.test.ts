import { describe, it, expect } from 'vitest';
import {
  StructuredOutputParser,
  PRESET_SCHEMAS,
  type OutputSchema,
} from '../../../src/core/structured-output.js';

describe('StructuredOutputParser', () => {
  const parser = new StructuredOutputParser();

  const simpleSchema: OutputSchema = {
    name: 'test',
    fields: {
      name: { type: 'string', required: true },
      age: { type: 'number', required: true },
      active: { type: 'boolean', required: false, default: true },
    },
  };

  // ─── Direct JSON Parsing ─────────────────────────────────────

  describe('parse — direct JSON', () => {
    it('should parse valid JSON matching schema', () => {
      const raw = '{"name": "Alice", "age": 30}';
      const result = parser.parse(raw, simpleSchema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Alice', age: 30, active: true });
      expect(result.format).toBe('json');
      expect(result.errors).toHaveLength(0);
    });

    it('should fail on missing required field', () => {
      const raw = '{"name": "Alice"}';
      const result = parser.parse(raw, simpleSchema);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toBe('$.age');
      expect(result.errors[0].message).toContain('Required');
    });

    it('should apply defaults for missing optional fields', () => {
      const raw = '{"name": "Bob", "age": 25}';
      const result = parser.parse(raw, simpleSchema);

      expect(result.success).toBe(true);
      expect((result.data as any).active).toBe(true);
    });

    it('should parse JSON arrays', () => {
      const arraySchema: OutputSchema = {
        name: 'list',
        fields: {
          items: { type: 'array', required: true, items: { type: 'string' } },
        },
      };
      const raw = '{"items": ["a", "b", "c"]}';
      const result = parser.parse(raw, arraySchema);

      expect(result.success).toBe(true);
      expect((result.data as any).items).toEqual(['a', 'b', 'c']);
    });
  });

  // ─── Markdown JSON Parsing ───────────────────────────────────

  describe('parse — markdown JSON', () => {
    it('should extract JSON from markdown code blocks', () => {
      const raw = `Here is the result:

\`\`\`json
{"name": "Charlie", "age": 40}
\`\`\`

That's the output.`;

      const result = parser.parse(raw, simpleSchema);
      expect(result.success).toBe(true);
      expect((result.data as any).name).toBe('Charlie');
      expect(result.format).toBe('markdown_json');
    });

    it('should extract JSON from generic code blocks', () => {
      const raw = `Result:
\`\`\`
{"name": "Diana", "age": 35}
\`\`\``;

      const result = parser.parse(raw, simpleSchema);
      expect(result.success).toBe(true);
      expect((result.data as any).name).toBe('Diana');
    });
  });

  // ─── Fuzzy JSON Parsing ──────────────────────────────────────

  describe('parse — fuzzy JSON', () => {
    it('should extract JSON embedded in prose', () => {
      const raw = 'Sure! Here is the result: {"name": "Eve", "age": 28} Hope that helps!';
      const result = parser.parse(raw, simpleSchema);

      expect(result.success).toBe(true);
      expect((result.data as any).name).toBe('Eve');
    });

    it('should return failure when no JSON found', () => {
      const raw = 'This has no JSON at all.';
      const result = parser.parse(raw, simpleSchema);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.format).toBe('plain');
    });
  });

  // ─── Validation ──────────────────────────────────────────────

  describe('validation', () => {
    it('should validate enum values', () => {
      const schema: OutputSchema = {
        name: 'status',
        fields: {
          status: { type: 'string', required: true, enum: ['active', 'inactive'] },
        },
      };

      const good = parser.parse('{"status": "active"}', schema);
      expect(good.success).toBe(true);

      const bad = parser.parse('{"status": "unknown"}', schema);
      expect(bad.success).toBe(false);
      expect(bad.errors[0].message).toContain('one of');
    });

    it('should validate nested objects', () => {
      const schema: OutputSchema = {
        name: 'nested',
        fields: {
          user: {
            type: 'object',
            required: true,
            properties: {
              name: { type: 'string', required: true },
              email: { type: 'string', required: true },
            },
          },
        },
      };

      const good = parser.parse('{"user": {"name": "Test", "email": "t@t.com"}}', schema);
      expect(good.success).toBe(true);

      const bad = parser.parse('{"user": {"name": "Test"}}', schema);
      expect(bad.success).toBe(false);
      expect(bad.errors.some(e => e.path.includes('email'))).toBe(true);
    });

    it('should validate array item types', () => {
      const schema: OutputSchema = {
        name: 'array-test',
        fields: {
          numbers: { type: 'array', required: true, items: { type: 'number' } },
        },
      };

      const good = parser.parse('{"numbers": [1, 2, 3]}', schema);
      expect(good.success).toBe(true);

      const noCoerce = new StructuredOutputParser({ coerceTypes: false });
      const bad = noCoerce.parse('{"numbers": [1, "two", 3]}', schema);
      expect(bad.success).toBe(false);
    });

    it('should enforce strict mode (no extra fields)', () => {
      const schema: OutputSchema = {
        name: 'strict',
        fields: {
          name: { type: 'string', required: true },
        },
        strict: true,
      };

      const result = parser.parse('{"name": "Test", "extra": true}', schema);
      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.message.includes('Unexpected'))).toBe(true);
    });
  });

  // ─── Prompt Building ─────────────────────────────────────────

  describe('buildPrompt', () => {
    it('should generate a schema prompt', () => {
      const prompt = parser.buildPrompt(simpleSchema);
      expect(prompt).toContain('JSON object');
      expect(prompt).toContain('"name"');
      expect(prompt).toContain('"age"');
      expect(prompt).toContain('(required)');
      expect(prompt).toContain('IMPORTANT');
    });

    it('should include schema description', () => {
      const schema: OutputSchema = {
        name: 'test',
        description: 'A test output',
        fields: { x: { type: 'string', required: true } },
      };
      const prompt = parser.buildPrompt(schema);
      expect(prompt).toContain('A test output');
    });

    it('should include enum values in prompt', () => {
      const schema: OutputSchema = {
        name: 'test',
        fields: {
          level: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
        },
      };
      const prompt = parser.buildPrompt(schema);
      expect(prompt).toContain('low | medium | high');
    });
  });

  // ─── Retry Prompt ────────────────────────────────────────────

  describe('buildRetryPrompt', () => {
    it('should include errors and schema', () => {
      const errors = [{ path: '$.age', message: 'Required field is missing' }];
      const retry = parser.buildRetryPrompt(simpleSchema, errors);

      expect(retry).toContain('$.age');
      expect(retry).toContain('Required field is missing');
      expect(retry).toContain('"name"');
    });
  });

  // ─── Code Block Extraction ───────────────────────────────────

  describe('extractCodeBlocks', () => {
    it('should extract code blocks with languages', () => {
      const raw = `Here's some code:

\`\`\`typescript
const x = 1;
\`\`\`

And more:

\`\`\`python
x = 1
\`\`\``;

      const blocks = parser.extractCodeBlocks(raw);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].language).toBe('typescript');
      expect(blocks[0].code).toBe('const x = 1;');
      expect(blocks[1].language).toBe('python');
    });

    it('should handle blocks without language', () => {
      const raw = '```\nhello\n```';
      const blocks = parser.extractCodeBlocks(raw);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe('text');
    });
  });

  // ─── Table Extraction ────────────────────────────────────────

  describe('extractTable', () => {
    it('should parse markdown tables', () => {
      const raw = `
| Name  | Age |
|-------|-----|
| Alice | 30  |
| Bob   | 25  |
`;
      const rows = parser.extractTable(raw);
      expect(rows).toHaveLength(2);
      expect(rows[0].Name).toBe('Alice');
      expect(rows[0].Age).toBe('30');
      expect(rows[1].Name).toBe('Bob');
    });

    it('should return empty array for non-table content', () => {
      expect(parser.extractTable('no table here')).toEqual([]);
    });
  });

  // ─── List Extraction ─────────────────────────────────────────

  describe('extractList', () => {
    it('should extract bullet lists', () => {
      const raw = `Items:
- First item
- Second item
* Third item`;
      const list = parser.extractList(raw);
      expect(list).toEqual(['First item', 'Second item', 'Third item']);
    });

    it('should extract numbered lists', () => {
      const raw = `1. Step one
2. Step two
3. Step three`;
      const list = parser.extractList(raw);
      expect(list).toEqual(['Step one', 'Step two', 'Step three']);
    });
  });

  // ─── Preset Schemas ──────────────────────────────────────────

  describe('PRESET_SCHEMAS', () => {
    it('should define codeChange schema', () => {
      expect(PRESET_SCHEMAS.codeChange.name).toBe('code-change');
      expect(PRESET_SCHEMAS.codeChange.fields.filePath).toBeDefined();
      expect(PRESET_SCHEMAS.codeChange.fields.action.enum).toContain('create');
    });

    it('should validate against codeChange preset', () => {
      const result = parser.parse(JSON.stringify({
        filePath: 'src/main.ts',
        action: 'modify',
        content: 'console.log("hi")',
        explanation: 'Added logging',
      }), PRESET_SCHEMAS.codeChange);
      expect(result.success).toBe(true);
    });

    it('should define taskPlan schema', () => {
      expect(PRESET_SCHEMAS.taskPlan.name).toBe('task-plan');
      expect(PRESET_SCHEMAS.taskPlan.fields.steps.type).toBe('array');
    });

    it('should define bugReport schema', () => {
      expect(PRESET_SCHEMAS.bugReport.name).toBe('bug-report');
      expect(PRESET_SCHEMAS.bugReport.fields.severity.enum).toContain('critical');
    });
  });

  // ─── Config Options ──────────────────────────────────────────

  describe('config options', () => {
    it('should respect coerceTypes: false', () => {
      const strict = new StructuredOutputParser({ coerceTypes: false });
      const schema: OutputSchema = {
        name: 'test',
        fields: { count: { type: 'number', required: true } },
      };
      const result = strict.parse('{"count": "not a number"}', schema);
      expect(result.success).toBe(false);
    });

    it('should disable fallback parsers', () => {
      const noFallback = new StructuredOutputParser({ fallbackParsers: false, extractCodeBlocks: false });
      const raw = 'Here is {"name": "Test", "age": 10} in the middle';
      const result = noFallback.parse(raw, simpleSchema);
      // Without fallback parsers, embedded JSON is not found
      expect(result.success).toBe(false);
    });
  });
});
