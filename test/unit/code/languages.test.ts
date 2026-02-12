import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  detectLanguage,
  getLanguageConfig,
  detectProjectLanguages,
  detectConfigFiles,
} from '../../../src/code/languages.js';

describe('detectLanguage', () => {
  it('should detect TypeScript from .ts extension', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
  });

  it('should detect TypeScript from .tsx extension', () => {
    expect(detectLanguage('components/App.tsx')).toBe('typescript');
  });

  it('should detect Python from .py extension', () => {
    expect(detectLanguage('scripts/main.py')).toBe('python');
  });

  it('should detect Rust from .rs extension', () => {
    expect(detectLanguage('src/lib.rs')).toBe('rust');
  });

  it('should detect Go from .go extension', () => {
    expect(detectLanguage('cmd/server.go')).toBe('go');
  });

  it('should detect JavaScript from .js extension', () => {
    expect(detectLanguage('lib/utils.js')).toBe('javascript');
  });

  it('should detect Ruby from .rb extension', () => {
    expect(detectLanguage('app/models/user.rb')).toBe('ruby');
  });

  it('should detect Swift from .swift extension', () => {
    expect(detectLanguage('Sources/App.swift')).toBe('swift');
  });

  it('should return null for unknown extension', () => {
    expect(detectLanguage('file.unknown')).toBeNull();
  });

  it('should return null for extensionless file', () => {
    expect(detectLanguage('Makefile')).toBeNull();
  });

  it('should handle case insensitivity via lowercasing', () => {
    // The implementation lowercases the extension
    expect(detectLanguage('file.TS')).toBe('typescript');
  });
});

describe('getLanguageConfig', () => {
  it('should return config for typescript', () => {
    const config = getLanguageConfig('typescript');
    expect(config).not.toBeNull();
    expect(config!.name).toBe('TypeScript');
    expect(config!.extensions).toContain('.ts');
    expect(config!.extensions).toContain('.tsx');
  });

  it('should return config for python', () => {
    const config = getLanguageConfig('python');
    expect(config).not.toBeNull();
    expect(config!.name).toBe('Python');
    expect(config!.extensions).toContain('.py');
  });

  it('should return null for nonexistent language', () => {
    expect(getLanguageConfig('nonexistent')).toBeNull();
  });

  it('should include comment syntax in config', () => {
    const config = getLanguageConfig('typescript');
    expect(config!.commentSingle).toBe('//');
    expect(config!.commentMultiStart).toBe('/*');
    expect(config!.commentMultiEnd).toBe('*/');
  });

  it('should include test patterns in config', () => {
    const config = getLanguageConfig('typescript');
    expect(config!.testPatterns).toContain('*.test.ts');
    expect(config!.testPatterns).toContain('*.spec.ts');
  });

  it('should include config files in config', () => {
    const config = getLanguageConfig('typescript');
    expect(config!.configFiles).toContain('tsconfig.json');
  });
});

describe('LANGUAGES registry', () => {
  it('should have at least 15 language entries', () => {
    expect(Object.keys(LANGUAGES).length).toBeGreaterThanOrEqual(15);
  });

  it('should have name and extensions for every language', () => {
    for (const [key, config] of Object.entries(LANGUAGES)) {
      expect(config.name, `${key} should have a name`).toBeTruthy();
      expect(config.extensions, `${key} should have extensions`).toBeDefined();
      expect(Array.isArray(config.extensions), `${key} extensions should be an array`).toBe(true);
    }
  });

  it('should include typescript config with tsconfig.json', () => {
    expect(LANGUAGES.typescript.configFiles).toContain('tsconfig.json');
  });

  it('should include rust config with Cargo.toml', () => {
    expect(LANGUAGES.rust.configFiles).toContain('Cargo.toml');
  });

  it('should include python config with pyproject.toml', () => {
    expect(LANGUAGES.python.configFiles).toContain('pyproject.toml');
  });

  it('should include go config with go.mod', () => {
    expect(LANGUAGES.go.configFiles).toContain('go.mod');
  });
});

describe('detectProjectLanguages', () => {
  it('should count languages correctly', () => {
    const files = [
      'src/index.ts',
      'src/utils.ts',
      'src/helper.js',
      'lib/main.py',
      'lib/utils.py',
      'lib/extras.py',
    ];
    const counts = detectProjectLanguages(files);

    expect(counts.typescript).toBe(2);
    expect(counts.javascript).toBe(1);
    expect(counts.python).toBe(3);
  });

  it('should return an empty object for an empty file list', () => {
    const counts = detectProjectLanguages([]);
    expect(Object.keys(counts).length).toBe(0);
  });

  it('should skip files with unknown extensions', () => {
    const counts = detectProjectLanguages(['README', 'Makefile', 'data.bin']);
    expect(Object.keys(counts).length).toBe(0);
  });

  it('should handle a mix of recognized and unrecognized files', () => {
    const files = ['app.ts', 'notes.txt', 'server.go', 'data.csv'];
    const counts = detectProjectLanguages(files);

    expect(counts.typescript).toBe(1);
    expect(counts.go).toBe(1);
    expect(Object.keys(counts).length).toBe(2);
  });
});

describe('detectConfigFiles', () => {
  it('should find package.json as a JavaScript config file', () => {
    const files = ['src/index.js', 'package.json', 'README.md'];
    const configs = detectConfigFiles(files);

    expect(configs).toContain('package.json');
  });

  it('should find Cargo.toml as a Rust config file', () => {
    const files = ['src/lib.rs', 'Cargo.toml', 'Cargo.lock'];
    const configs = detectConfigFiles(files);

    expect(configs).toContain('Cargo.toml');
    expect(configs).toContain('Cargo.lock');
  });

  it('should find tsconfig.json as a TypeScript config file', () => {
    const files = ['src/app.ts', 'tsconfig.json'];
    const configs = detectConfigFiles(files);

    expect(configs).toContain('tsconfig.json');
  });

  it('should handle glob patterns like tsconfig.*.json', () => {
    const files = ['tsconfig.build.json', 'tsconfig.test.json'];
    const configs = detectConfigFiles(files);

    expect(configs).toContain('tsconfig.build.json');
    expect(configs).toContain('tsconfig.test.json');
  });

  it('should return an empty array when no files are provided', () => {
    const configs = detectConfigFiles([]);
    expect(configs.length).toBe(0);
  });

  it('should not include non-config files as exact matches', () => {
    const files = ['src/index.ts', 'src/utils.ts'];
    const configs = detectConfigFiles(files);

    // Exact-match config files like package.json, tsconfig.json should not appear
    expect(configs).not.toContain('package.json');
    expect(configs).not.toContain('tsconfig.json');
    expect(configs).not.toContain('Cargo.toml');
  });

  it('should not include duplicate config files', () => {
    const files = ['package.json', 'package.json'];
    const configs = detectConfigFiles(files);

    const packageJsonCount = configs.filter(c => c === 'package.json').length;
    expect(packageJsonCount).toBe(1);
  });

  it('should find go.mod for Go projects', () => {
    const files = ['main.go', 'go.mod', 'go.sum'];
    const configs = detectConfigFiles(files);

    expect(configs).toContain('go.mod');
    expect(configs).toContain('go.sum');
  });
});
