export { RepoMapper, type RepoMapOptions, type RepoMapResult } from './mapper.js';
export { CodeParser, type ParseResult, type ImportInfo } from './parser.js';
export {
  extractSymbols,
  extractTSSymbols,
  extractPythonSymbols,
  type CodeSymbol,
  type SymbolType,
} from './symbols.js';
export {
  detectLanguage,
  getLanguageConfig,
  detectProjectLanguages,
  detectConfigFiles,
  LANGUAGES,
  type LanguageConfig,
} from './languages.js';
export {
  generateDiff,
  formatDiff,
  summarizeChanges,
  type FileDiff,
  type DiffHunk,
  type DiffLine,
} from './differ.js';
export { LSPClient, type LSPClientOptions, type LSPDiagnostic, type LSPLocation, type LSPHoverResult } from './lsp-client.js';
export { LSPManager, type LanguageServerConfig } from './lsp-manager.js';
