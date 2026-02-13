import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TemplateRegistry,
  BUILTIN_TEMPLATES,
} from '../../../src/templates/registry.js';

describe('TemplateRegistry', () => {
  let registry: TemplateRegistry;
  let tmpDir: string;

  beforeEach(() => {
    registry = new TemplateRegistry();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortexos-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads builtin templates by default', () => {
    const templates = registry.list();
    expect(templates.length).toBeGreaterThan(0);
  });

  it('BUILTIN_TEMPLATES has correct number of entries', () => {
    // BUILTIN_TEMPLATES: minimal, typescript-api, react-app, python-ml, fullstack, library = 6
    expect(BUILTIN_TEMPLATES).toHaveLength(6);
  });

  it('get returns template by ID', () => {
    const firstBuiltin = BUILTIN_TEMPLATES[0];
    const template = registry.get(firstBuiltin.id);
    expect(template).toBeDefined();
    expect(template!.id).toBe(firstBuiltin.id);
  });

  it('list returns all templates', () => {
    const templates = registry.list();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBe(BUILTIN_TEMPLATES.length);
  });

  it('list with language filter works', () => {
    const allTemplates = registry.list();
    const languages = [
      ...new Set(
        allTemplates
          .filter((t: any) => t.language)
          .map((t: any) => t.language)
      ),
    ];

    if (languages.length > 0) {
      const filtered = registry.list({ language: languages[0] as string });
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(
        filtered.every((t: any) => t.language === languages[0])
      ).toBe(true);
    }
  });

  it('register adds a custom template', () => {
    const customTemplate = {
      id: 'custom-template',
      name: 'Custom Template',
      description: 'A custom template for testing',
      language: 'typescript',
      files: [
        {
          path: 'index.ts',
          content: 'console.log("hello");',
        },
      ],
    };

    registry.register(customTemplate as any);
    const retrieved = registry.get('custom-template');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Custom Template');
  });

  it('remove deletes a template', () => {
    const template = {
      id: 'to-remove-template',
      name: 'To Remove',
      description: 'Will be removed',
      language: 'javascript',
      files: [],
    };

    registry.register(template as any);
    expect(registry.get('to-remove-template')).toBeDefined();

    registry.remove('to-remove-template');
    expect(registry.get('to-remove-template')).toBeUndefined();
  });

  it('scaffold creates files', async () => {
    const template = {
      id: 'scaffold-test',
      name: 'Scaffold Test',
      description: 'Template for scaffold testing',
      language: 'typescript',
      files: [
        { path: 'src/index.ts', content: 'export default {};' },
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'README.md', content: '# Test Project' },
      ],
    };

    registry.register(template as any);
    // scaffold(templateId, options: ScaffoldOptions) where ScaffoldOptions has targetDir
    await registry.scaffold('scaffold-test', { targetDir: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(true);
  });

  it('scaffold applies variable interpolation', async () => {
    const template = {
      id: 'interpolation-test',
      name: 'Interpolation Test',
      description: 'Tests variable interpolation',
      language: 'typescript',
      files: [
        {
          path: 'package.json',
          content: '{"name": "{{name}}", "version": "{{version}}"}',
        },
        {
          path: 'src/index.ts',
          content: '// {{name}} v{{version}}\nexport const name = "{{name}}";',
        },
      ],
    };

    registry.register(template as any);
    // ScaffoldOptions uses `vars` not `variables`, and the default var is `name`
    await registry.scaffold('interpolation-test', {
      targetDir: tmpDir,
      vars: {
        name: 'my-awesome-app',
        version: '1.0.0',
      },
    });

    const pkgContent = fs.readFileSync(
      path.join(tmpDir, 'package.json'),
      'utf-8'
    );
    expect(pkgContent).toContain('my-awesome-app');
    expect(pkgContent).toContain('1.0.0');
    expect(pkgContent).not.toContain('{{name}}');

    const indexContent = fs.readFileSync(
      path.join(tmpDir, 'src', 'index.ts'),
      'utf-8'
    );
    expect(indexContent).toContain('my-awesome-app');
  });

  it('scaffold respects conditional files', async () => {
    const template = {
      id: 'conditional-test',
      name: 'Conditional Test',
      description: 'Tests conditional file inclusion',
      language: 'typescript',
      files: [
        { path: 'index.ts', content: 'export {};' },
        {
          path: 'jest.config.ts',
          content: 'export default {};',
          conditional: 'useJest',  // field is `conditional`, not `condition`
        },
        {
          path: 'vitest.config.ts',
          content: 'export default {};',
          conditional: 'useVitest',
        },
      ],
    };

    registry.register(template as any);
    // conditional checks: file is only created if vars[conditional] is truthy
    await registry.scaffold('conditional-test', {
      targetDir: tmpDir,
      vars: { useVitest: 'true' },
      // useJest is not set, so jest.config.ts should NOT be created
    });

    expect(fs.existsSync(path.join(tmpDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'jest.config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'vitest.config.ts'))).toBe(true);
  });

  it('detectProjectType detects TypeScript project', () => {
    // Create a fake TS project in tmpDir
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      '{"compilerOptions": {}}'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      '{"dependencies": {"typescript": "^5.0.0"}}'
    );

    const projectType = registry.detectProjectType(tmpDir);
    // detectProjectType returns 'typescript-api' when package.json + tsconfig.json exist
    expect(projectType).toBe('typescript-api');
  });

  it('detectProjectType detects Python project', () => {
    // Create a fake Python project in tmpDir
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'flask==2.0.0\nrequests>=2.28.0'
    );
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'print("hello")');

    const projectType = registry.detectProjectType(tmpDir);
    // detectProjectType returns 'python-ml' for requirements.txt or pyproject.toml
    expect(projectType).toBe('python-ml');
  });
});
