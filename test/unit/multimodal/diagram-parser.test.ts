import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramParser } from '../../../src/multimodal/diagram-parser.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Tests ──────────────────────────────────────────────────────

describe('DiagramParser', () => {
  let parser: DiagramParser;
  let tmpDir: string;

  beforeEach(async () => {
    parser = new DiagramParser();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-diagram-test-'));
  });

  // ─── parse (image-based) ──────────────────────────────────────

  describe('parse', () => {
    it('should parse an image file and return skeleton analysis', async () => {
      const filePath = path.join(tmpDir, 'diagram.png');
      await fs.writeFile(filePath, Buffer.alloc(10));

      const result = await parser.parse(filePath);

      expect(result.id).toBeTruthy();
      expect(result.id).toContain('diagram_');
      expect(result.type).toBe('unknown');
      expect(result.nodes).toEqual([]);
      expect(result.connections).toEqual([]);
      expect(result.labels).toEqual([]);
    });

    it('should throw for non-existent files', async () => {
      await expect(parser.parse('/nonexistent/file.png')).rejects.toThrow();
    });

    it('should emit multimodal:diagram:parsed event', async () => {
      const handler = vi.fn();
      parser.on('multimodal:diagram:parsed', handler);

      const filePath = path.join(tmpDir, 'diagram.png');
      await fs.writeFile(filePath, Buffer.alloc(10));
      await parser.parse(filePath);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should increment parse count', async () => {
      const filePath = path.join(tmpDir, 'diagram.png');
      await fs.writeFile(filePath, Buffer.alloc(10));

      await parser.parse(filePath);
      await parser.parse(filePath);

      expect(parser.getStats().diagramsParsed).toBe(2);
    });
  });

  // ─── parseFromDescription ─────────────────────────────────────

  describe('parseFromDescription', () => {
    it('should parse simple connections', () => {
      const description = '[A] -> [B]: sends data\n[B] -> [C]: processes';

      const result = parser.parseFromDescription(description);

      expect(result.nodes).toHaveLength(3);
      expect(result.connections).toHaveLength(2);
      expect(result.connections[0].label).toBe('sends data');
      expect(result.connections[1].label).toBe('processes');
    });

    it('should detect nodes referenced in connections', () => {
      const description = '[Frontend] -> [API]: HTTP\n[API] -> [Database]: SQL';

      const result = parser.parseFromDescription(description);
      const labels = result.nodes.map((n) => n.label);

      expect(labels).toContain('Frontend');
      expect(labels).toContain('API');
      expect(labels).toContain('Database');
    });

    it('should handle different arrow types', () => {
      const description = [
        '[A] -> [B]: arrow',
        '[C] --> [D]: dashed',
        '[E] <-> [F]: bidirectional',
        '[G] -- [H]: line',
      ].join('\n');

      const result = parser.parseFromDescription(description);

      expect(result.connections).toHaveLength(4);
      expect(result.connections[0].type).toBe('arrow');
      expect(result.connections[1].type).toBe('dashed');
      expect(result.connections[2].type).toBe('bidirectional');
      expect(result.connections[3].type).toBe('line');
    });

    it('should handle standalone nodes', () => {
      const description = '[Standalone Node]\n[Another]';

      const result = parser.parseFromDescription(description);
      expect(result.nodes).toHaveLength(2);
      expect(result.connections).toHaveLength(0);
    });

    it('should handle connections without labels', () => {
      const description = '[A] -> [B]';

      const result = parser.parseFromDescription(description);
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].label).toBeUndefined();
    });

    it('should collect non-node text as labels', () => {
      const description = 'Title of diagram\n[A] -> [B]\nSome note about the flow';

      const result = parser.parseFromDescription(description);
      expect(result.labels).toContain('Title of diagram');
      expect(result.labels).toContain('Some note about the flow');
    });

    it('should emit multimodal:diagram:parsed event', () => {
      const handler = vi.fn();
      parser.on('multimodal:diagram:parsed', handler);

      parser.parseFromDescription('[A] -> [B]');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should generate suggested Mermaid output', () => {
      const result = parser.parseFromDescription('[A] -> [B]: flow');
      expect(result.suggestedMermaid).toBeTruthy();
      expect(result.suggestedMermaid).toContain('flowchart');
    });

    it('should not create duplicate nodes for repeated references', () => {
      const description = '[A] -> [B]\n[A] -> [C]\n[B] -> [C]';

      const result = parser.parseFromDescription(description);
      expect(result.nodes).toHaveLength(3);
    });
  });

  // ─── Diagram Type Detection ───────────────────────────────────

  describe('detectDiagramType', () => {
    it('should detect flowchart type', () => {
      const result = parser.parseFromDescription(
        '[Start] -> [Process]: step\n[Process] -> [Decision]: flow\n[Decision] -> [End]: yes',
      );
      expect(result.type).toBe('flowchart');
    });

    it('should detect sequence diagram type', () => {
      const result = parser.parseFromDescription(
        '[Actor] -> [Participant]: message\n[Participant] -> [Actor]: response',
      );
      expect(result.type).toBe('sequence');
    });

    it('should detect class diagram type', () => {
      const result = parser.parseFromDescription(
        '[Class] -> [Interface]: extends\n[Abstract] -> [Class]: implements',
      );
      expect(result.type).toBe('class');
    });

    it('should detect ER diagram type', () => {
      const result = parser.parseFromDescription(
        '[Entity] -> [Relationship]: attribute\n[Table] -> [Entity]: primary key',
      );
      expect(result.type).toBe('er');
    });

    it('should detect architecture diagram type', () => {
      const result = parser.parseFromDescription(
        '[API Gateway] -> [Service]: route\n[Service] -> [Database]: query',
      );
      expect(result.type).toBe('architecture');
    });

    it('should return unknown for ambiguous diagrams', () => {
      const result = parser.parseFromDescription('[X] -> [Y]');
      expect(result.type).toBe('unknown');
    });
  });

  // ─── Mermaid Conversion ───────────────────────────────────────

  describe('toMermaid', () => {
    it('should generate flowchart syntax for flowchart type', () => {
      const analysis = parser.parseFromDescription(
        '[Start] -> [Process]: step\n[Process] -> [Decision]: flow\n[Decision] -> [End]: yes',
      );
      const mermaid = parser.toMermaid(analysis);

      expect(mermaid).toContain('flowchart TD');
      expect(mermaid).toContain('Start');
      expect(mermaid).toContain('-->');
    });

    it('should generate dashed arrows for dashed connections', () => {
      const analysis = parser.parseFromDescription('[A] --> [B]: optional');
      const mermaid = parser.toMermaid(analysis);
      expect(mermaid).toContain('-.->' );
    });

    it('should generate sequence diagram syntax', () => {
      const analysis = parser.parseFromDescription(
        '[Actor] -> [Participant]: message\n[Participant] -> [Actor]: response',
      );
      analysis.type = 'sequence';
      const mermaid = parser.toMermaid(analysis);

      expect(mermaid).toContain('sequenceDiagram');
    });

    it('should generate class diagram syntax', () => {
      const analysis = parser.parseFromDescription(
        '[Class] -> [Interface]: extends\n[Abstract] -> [Class]: implements',
      );
      analysis.type = 'class';
      const mermaid = parser.toMermaid(analysis);

      expect(mermaid).toContain('classDiagram');
    });

    it('should generate ER diagram syntax', () => {
      const analysis = parser.parseFromDescription(
        '[Entity] -> [Relationship]: attribute\n[Table] -> [Entity]: primary key',
      );
      analysis.type = 'er';
      const mermaid = parser.toMermaid(analysis);

      expect(mermaid).toContain('erDiagram');
    });
  });

  // ─── PlantUML Conversion ──────────────────────────────────────

  describe('toPlantUML', () => {
    it('should generate PlantUML with @startuml and @enduml', () => {
      const analysis = parser.parseFromDescription('[A] -> [B]');
      const plantuml = parser.toPlantUML(analysis);

      expect(plantuml).toContain('@startuml');
      expect(plantuml).toContain('@enduml');
    });

    it('should generate sequence diagram PlantUML', () => {
      const analysis = parser.parseFromDescription(
        '[Actor] -> [Participant]: message\n[Participant] -> [Actor]: response',
      );
      analysis.type = 'sequence';
      const plantuml = parser.toPlantUML(analysis);

      expect(plantuml).toContain('participant');
    });

    it('should generate class diagram PlantUML', () => {
      const analysis = parser.parseFromDescription(
        '[Class] -> [Interface]: extends\n[Abstract] -> [Class]: implements',
      );
      analysis.type = 'class';
      const plantuml = parser.toPlantUML(analysis);

      expect(plantuml).toContain('class');
    });
  });

  // ─── Architecture Extraction ──────────────────────────────────

  describe('extractArchitecture', () => {
    it('should extract services and connections', () => {
      const analysis = parser.parseFromDescription(
        '[API Gateway] -> [Service]: HTTP\n[Service] -> [Database]: SQL',
      );

      const arch = parser.extractArchitecture(analysis);

      expect(arch.services).toHaveLength(3);
      expect(arch.connections).toHaveLength(2);
    });

    it('should infer service types from labels', () => {
      const analysis = parser.parseFromDescription(
        '[API Gateway] -> [Redis Cache]: get\n[Redis Cache] -> [PostgreSQL DB]: query',
      );

      const arch = parser.extractArchitecture(analysis);
      const types = arch.services.map((s) => s.type);

      expect(types).toContain('api-gateway');
      expect(types).toContain('cache');
      expect(types).toContain('database');
    });

    it('should include connection labels as protocol', () => {
      const analysis = parser.parseFromDescription('[A] -> [B]: gRPC');

      const arch = parser.extractArchitecture(analysis);
      expect(arch.connections[0].protocol).toBe('gRPC');
    });
  });

  // ─── Stats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zero initially', () => {
      expect(parser.getStats().diagramsParsed).toBe(0);
    });

    it('should track parsed diagrams', () => {
      parser.parseFromDescription('[A] -> [B]');
      parser.parseFromDescription('[C] -> [D]');

      expect(parser.getStats().diagramsParsed).toBe(2);
    });
  });
});
