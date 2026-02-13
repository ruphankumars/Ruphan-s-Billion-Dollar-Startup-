/**
 * Template Registry — Project Scaffolding Engine
 *
 * Provides built-in project templates and scaffolding for quick CortexOS setup.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ProjectTemplate, ScaffoldOptions, ScaffoldResult } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════

export class TemplateRegistry {
  private templates: Map<string, ProjectTemplate> = new Map();

  constructor() {
    // Register all built-in templates
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /** Register a custom template */
  register(template: ProjectTemplate): void {
    this.templates.set(template.id, template);
  }

  /** Get a template by ID */
  get(id: string): ProjectTemplate | undefined {
    return this.templates.get(id);
  }

  /** List all available templates */
  list(filter?: { language?: string; tags?: string[] }): ProjectTemplate[] {
    let templates = Array.from(this.templates.values());

    if (filter?.language) {
      templates = templates.filter(t => t.language === filter.language);
    }
    if (filter?.tags?.length) {
      templates = templates.filter(t =>
        filter.tags!.some(tag => t.tags?.includes(tag))
      );
    }

    return templates;
  }

  /** Remove a template */
  remove(id: string): boolean {
    return this.templates.delete(id);
  }

  /** Scaffold a project from a template */
  async scaffold(templateId: string, options: ScaffoldOptions): Promise<ScaffoldResult> {
    const template = this.templates.get(templateId);
    if (!template) {
      return { filesCreated: [], commandsRun: [], errors: [`Template "${templateId}" not found`] };
    }

    const result: ScaffoldResult = { filesCreated: [], commandsRun: [], errors: [] };
    const vars: Record<string, string> = { name: 'my-project', ...options.vars };

    // Create target directory
    if (!existsSync(options.targetDir)) {
      mkdirSync(options.targetDir, { recursive: true });
    }

    // Create files
    for (const file of template.files) {
      // Check conditional
      if (file.conditional && !vars[file.conditional]) continue;

      const filePath = join(options.targetDir, interpolate(file.path, vars));
      const content = interpolate(file.content, vars);

      if (existsSync(filePath) && !options.overwrite) {
        result.errors.push(`File already exists: ${filePath}`);
        continue;
      }

      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
        result.filesCreated.push(filePath);
      } catch (err) {
        result.errors.push(`Failed to create ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Run post-create commands
    if (!options.skipPostCreate && template.postCreate) {
      for (const cmd of template.postCreate) {
        try {
          execSync(cmd, { cwd: options.targetDir, stdio: 'pipe', timeout: 60000 });
          result.commandsRun.push(cmd);
        } catch (err) {
          result.errors.push(`Command failed: ${cmd}`);
        }
      }
    }

    return result;
  }

  /** Detect project type from an existing directory */
  detectProjectType(dir: string): string | null {
    if (existsSync(join(dir, 'package.json'))) {
      if (existsSync(join(dir, 'tsconfig.json'))) return 'typescript-api';
      if (existsSync(join(dir, 'next.config.js')) || existsSync(join(dir, 'next.config.ts'))) return 'fullstack';
      return 'typescript-api';
    }
    if (existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'pyproject.toml'))) return 'python-ml';
    if (existsSync(join(dir, 'Cargo.toml'))) return 'library';
    if (existsSync(join(dir, 'go.mod'))) return 'library';
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE INTERPOLATION
// ═══════════════════════════════════════════════════════════════

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ═══════════════════════════════════════════════════════════════
// BUILT-IN TEMPLATES
// ═══════════════════════════════════════════════════════════════

const CORTEXOS_CONFIG = `# CortexOS Configuration
providers:
  default: anthropic

agents:
  maxParallel: 4
  maxIterations: 25

quality:
  gates: [syntax, lint, type-check, test]
  autoFix: true

cost:
  budgetPerRun: 1.0
  budgetPerDay: 10.0
`;

const CORTEXOS_MINIMAL_CONFIG = `# CortexOS — Minimal Config
providers:
  default: anthropic
`;

export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  // ─── Minimal ──────────────────────────────────────────
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Bare minimum CortexOS config — just the essentials',
    language: 'any',
    tags: ['starter', 'minimal'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_MINIMAL_CONFIG },
      { path: '.gitignore', content: 'node_modules/\n.cortexos/memory/\n.env\n' },
    ],
  },

  // ─── TypeScript API ───────────────────────────────────
  {
    id: 'typescript-api',
    name: 'TypeScript API',
    description: 'Express + TypeScript REST API with CortexOS agent integration',
    language: 'typescript',
    framework: 'express',
    tags: ['api', 'backend', 'typescript'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_CONFIG },
      { path: '.gitignore', content: 'node_modules/\ndist/\n.cortexos/memory/\n.env\n' },
      {
        path: 'package.json',
        content: JSON.stringify({
          name: '{{name}}',
          version: '1.0.0',
          type: 'module',
          scripts: {
            build: 'tsc',
            dev: 'tsx watch src/index.ts',
            test: 'vitest',
            lint: 'eslint src/',
            'cortex': 'cortexos run',
          },
          dependencies: {
            express: '^4.18.0',
            cortexos: 'latest',
          },
          devDependencies: {
            typescript: '^5.0.0',
            tsx: '^4.0.0',
            vitest: '^2.0.0',
            '@types/express': '^4.17.0',
            '@types/node': '^20.0.0',
            eslint: '^9.0.0',
          },
        }, null, 2),
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            esModuleInterop: true,
            declaration: true,
          },
          include: ['src'],
        }, null, 2),
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
`,
      },
    ],
    postCreate: ['npm install'],
  },

  // ─── React App ────────────────────────────────────────
  {
    id: 'react-app',
    name: 'React App',
    description: 'React + TypeScript frontend with Vite and CortexOS agent support',
    language: 'typescript',
    framework: 'react',
    tags: ['frontend', 'react', 'typescript'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_CONFIG },
      { path: '.gitignore', content: 'node_modules/\ndist/\n.cortexos/memory/\n.env\n' },
      {
        path: 'package.json',
        content: JSON.stringify({
          name: '{{name}}',
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'tsc && vite build',
            preview: 'vite preview',
            test: 'vitest',
            cortex: 'cortexos run',
          },
          dependencies: {
            react: '^18.3.0',
            'react-dom': '^18.3.0',
            cortexos: 'latest',
          },
          devDependencies: {
            typescript: '^5.0.0',
            vite: '^5.0.0',
            '@vitejs/plugin-react': '^4.0.0',
            vitest: '^2.0.0',
            '@types/react': '^18.3.0',
            '@types/react-dom': '^18.3.0',
          },
        }, null, 2),
      },
      {
        path: 'src/App.tsx',
        content: `export default function App() {
  return (
    <div>
      <h1>{{name}}</h1>
      <p>Built with CortexOS</p>
    </div>
  );
}
`,
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>{{name}}</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
      },
      {
        path: 'src/main.tsx',
        content: `import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
`,
      },
    ],
    postCreate: ['npm install'],
  },

  // ─── Python ML ────────────────────────────────────────
  {
    id: 'python-ml',
    name: 'Python ML',
    description: 'Python machine learning project with CortexOS agent support',
    language: 'python',
    tags: ['ml', 'python', 'data-science'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_CONFIG },
      { path: '.gitignore', content: '__pycache__/\n*.pyc\n.venv/\n.cortexos/memory/\n.env\ndist/\n*.egg-info/\n' },
      {
        path: 'requirements.txt',
        content: 'numpy>=1.24.0\npandas>=2.0.0\nscikit-learn>=1.3.0\npytest>=7.0.0\n',
      },
      {
        path: 'pyproject.toml',
        content: `[project]
name = "{{name}}"
version = "1.0.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
      },
      {
        path: 'src/__init__.py',
        content: '"""{{name}} — Built with CortexOS"""\n',
      },
      {
        path: 'tests/test_main.py',
        content: `def test_import():
    import src
    assert src is not None
`,
      },
    ],
    postCreate: ['python3 -m venv .venv'],
  },

  // ─── Full-Stack ───────────────────────────────────────
  {
    id: 'fullstack',
    name: 'Full-Stack',
    description: 'Next.js full-stack application with CortexOS agent integration',
    language: 'typescript',
    framework: 'nextjs',
    tags: ['fullstack', 'nextjs', 'typescript'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_CONFIG },
      { path: '.gitignore', content: 'node_modules/\n.next/\n.cortexos/memory/\n.env\n' },
      {
        path: 'package.json',
        content: JSON.stringify({
          name: '{{name}}',
          version: '1.0.0',
          scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            test: 'vitest',
            cortex: 'cortexos run',
          },
          dependencies: {
            next: '^14.0.0',
            react: '^18.3.0',
            'react-dom': '^18.3.0',
            cortexos: 'latest',
          },
          devDependencies: {
            typescript: '^5.0.0',
            vitest: '^2.0.0',
            '@types/react': '^18.3.0',
            '@types/node': '^20.0.0',
          },
        }, null, 2),
      },
      {
        path: 'app/page.tsx',
        content: `export default function Home() {
  return <main><h1>{{name}}</h1><p>Built with CortexOS + Next.js</p></main>;
}
`,
      },
      {
        path: 'app/layout.tsx',
        content: `export const metadata = { title: '{{name}}' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`,
      },
    ],
    postCreate: ['npm install'],
  },

  // ─── Library ──────────────────────────────────────────
  {
    id: 'library',
    name: 'TypeScript Library',
    description: 'TypeScript library/package template with tsup bundling',
    language: 'typescript',
    tags: ['library', 'npm', 'typescript'],
    files: [
      { path: '.cortexos.yaml', content: CORTEXOS_CONFIG },
      { path: '.gitignore', content: 'node_modules/\ndist/\n.cortexos/memory/\n.env\n' },
      {
        path: 'package.json',
        content: JSON.stringify({
          name: '{{name}}',
          version: '0.1.0',
          type: 'module',
          main: 'dist/index.js',
          types: 'dist/index.d.ts',
          exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
          scripts: {
            build: 'tsup src/index.ts --format esm --dts',
            dev: 'tsup src/index.ts --format esm --dts --watch',
            test: 'vitest',
            cortex: 'cortexos run',
          },
          devDependencies: {
            typescript: '^5.0.0',
            tsup: '^8.0.0',
            vitest: '^2.0.0',
            cortexos: 'latest',
          },
        }, null, 2),
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            declaration: true,
          },
          include: ['src'],
        }, null, 2),
      },
      {
        path: 'src/index.ts',
        content: `/**
 * {{name}} — Built with CortexOS
 */

export function hello(): string {
  return 'Hello from {{name}}!';
}
`,
      },
      {
        path: 'test/index.test.ts',
        content: `import { describe, it, expect } from 'vitest';
import { hello } from '../src/index.js';

describe('{{name}}', () => {
  it('should return greeting', () => {
    expect(hello()).toContain('Hello');
  });
});
`,
      },
    ],
  },
];
