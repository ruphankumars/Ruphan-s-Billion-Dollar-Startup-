/**
 * Language Detection and Configuration
 * Detects programming languages from file extensions and content
 */

export interface LanguageConfig {
  name: string;
  extensions: string[];
  commentSingle: string;
  commentMultiStart?: string;
  commentMultiEnd?: string;
  configFiles: string[];
  testPatterns: string[];
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    name: 'TypeScript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['tsconfig.json', 'tsconfig.*.json'],
    testPatterns: ['*.test.ts', '*.spec.ts', '*.test.tsx', '*.spec.tsx'],
  },
  javascript: {
    name: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['package.json', 'jsconfig.json'],
    testPatterns: ['*.test.js', '*.spec.js', '*.test.jsx', '*.spec.jsx'],
  },
  python: {
    name: 'Python',
    extensions: ['.py', '.pyi'],
    commentSingle: '#',
    commentMultiStart: '"""',
    commentMultiEnd: '"""',
    configFiles: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
    testPatterns: ['test_*.py', '*_test.py'],
  },
  rust: {
    name: 'Rust',
    extensions: ['.rs'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['Cargo.toml', 'Cargo.lock'],
    testPatterns: ['*_test.rs'],
  },
  go: {
    name: 'Go',
    extensions: ['.go'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['go.mod', 'go.sum'],
    testPatterns: ['*_test.go'],
  },
  java: {
    name: 'Java',
    extensions: ['.java'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    testPatterns: ['*Test.java', '*Tests.java'],
  },
  ruby: {
    name: 'Ruby',
    extensions: ['.rb', '.erb'],
    commentSingle: '#',
    configFiles: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
    testPatterns: ['*_test.rb', '*_spec.rb'],
  },
  swift: {
    name: 'Swift',
    extensions: ['.swift'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['Package.swift'],
    testPatterns: ['*Tests.swift', '*Test.swift'],
  },
  css: {
    name: 'CSS',
    extensions: ['.css', '.scss', '.sass', '.less'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['tailwind.config.js', 'postcss.config.js'],
    testPatterns: [],
  },
  html: {
    name: 'HTML',
    extensions: ['.html', '.htm', '.ejs', '.hbs'],
    commentSingle: '',
    commentMultiStart: '<!--',
    commentMultiEnd: '-->',
    configFiles: [],
    testPatterns: [],
  },
  json: {
    name: 'JSON',
    extensions: ['.json', '.jsonc'],
    commentSingle: '',
    configFiles: [],
    testPatterns: [],
  },
  yaml: {
    name: 'YAML',
    extensions: ['.yaml', '.yml'],
    commentSingle: '#',
    configFiles: [],
    testPatterns: [],
  },
  markdown: {
    name: 'Markdown',
    extensions: ['.md', '.mdx'],
    commentSingle: '',
    commentMultiStart: '<!--',
    commentMultiEnd: '-->',
    configFiles: [],
    testPatterns: [],
  },
  shell: {
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh'],
    commentSingle: '#',
    configFiles: ['.bashrc', '.zshrc'],
    testPatterns: [],
  },
  sql: {
    name: 'SQL',
    extensions: ['.sql'],
    commentSingle: '--',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: [],
    testPatterns: [],
  },
  php: {
    name: 'PHP',
    extensions: ['.php'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['composer.json', 'composer.lock'],
    testPatterns: ['*Test.php'],
  },
  csharp: {
    name: 'C#',
    extensions: ['.cs'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    configFiles: ['*.csproj', '*.sln'],
    testPatterns: ['*Tests.cs', '*Test.cs'],
  },
};

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string | null {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();

  for (const [lang, config] of Object.entries(LANGUAGES)) {
    if (config.extensions.includes(ext)) {
      return lang;
    }
  }

  return null;
}

/**
 * Get language config
 */
export function getLanguageConfig(language: string): LanguageConfig | null {
  return LANGUAGES[language] || null;
}

/**
 * Detect project languages from file list
 */
export function detectProjectLanguages(files: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang) {
      counts[lang] = (counts[lang] || 0) + 1;
    }
  }

  return counts;
}

/**
 * Detect config files present in a file list
 */
export function detectConfigFiles(files: string[]): string[] {
  const configFiles: string[] = [];
  const fileNames = new Set(files.map(f => f.split('/').pop()!));

  for (const config of Object.values(LANGUAGES)) {
    for (const pattern of config.configFiles) {
      if (pattern.includes('*')) {
        // Glob pattern — check if any file matches
        const prefix = pattern.split('*')[0];
        for (const fileName of fileNames) {
          if (fileName.startsWith(prefix)) {
            configFiles.push(fileName);
          }
        }
      } else if (fileNames.has(pattern)) {
        configFiles.push(pattern);
      }
    }
  }

  return [...new Set(configFiles)];
}
