/**
 * LSP Manager — Multi-language LSP manager with auto-discovery.
 * Manages LSP client lifecycles for different languages,
 * auto-discovers installed language servers, and caches connections.
 */

import { LSPClient, type LSPClientOptions, type LSPDiagnostic, type LSPLocation, type LSPHoverResult } from './lsp-client.js';
import { getLogger } from '../core/logger.js';
import { execSync } from 'child_process';

const logger = getLogger();

export interface LanguageServerConfig {
  /** Language ID (e.g. 'typescript', 'python') */
  languageId: string;
  /** Command to launch the server */
  command: string;
  /** Arguments for the server */
  args?: string[];
  /** File extensions this server handles */
  extensions: string[];
}

/** Well-known language server configurations */
const KNOWN_SERVERS: LanguageServerConfig[] = [
  {
    languageId: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    languageId: 'python',
    command: 'pylsp',
    args: [],
    extensions: ['.py'],
  },
  {
    languageId: 'go',
    command: 'gopls',
    args: ['serve'],
    extensions: ['.go'],
  },
  {
    languageId: 'rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
  },
  {
    languageId: 'c',
    command: 'clangd',
    args: [],
    extensions: ['.c', '.h', '.cpp', '.hpp', '.cc'],
  },
  {
    languageId: 'java',
    command: 'jdtls',
    args: [],
    extensions: ['.java'],
  },
];

/**
 * LSPManager orchestrates multiple language server clients.
 * Auto-discovers installed servers and provides a unified API.
 */
export class LSPManager {
  private clients = new Map<string, LSPClient>();
  private availableServers = new Map<string, LanguageServerConfig>();
  private discovered = false;
  private customServers: LanguageServerConfig[] = [];

  constructor(customServers?: LanguageServerConfig[]) {
    if (customServers) {
      this.customServers = customServers;
    }
  }

  /**
   * Discover which language servers are installed on the system
   */
  async discoverServers(): Promise<LanguageServerConfig[]> {
    const allServers = [...this.customServers, ...KNOWN_SERVERS];
    const available: LanguageServerConfig[] = [];

    for (const server of allServers) {
      if (this.isCommandAvailable(server.command)) {
        this.availableServers.set(server.languageId, server);
        available.push(server);
        logger.debug({ server: server.command, language: server.languageId }, 'Language server discovered');
      }
    }

    this.discovered = true;
    return available;
  }

  /**
   * Get (or create and initialize) an LSP client for the given language
   */
  async getClient(languageId: string, workspaceDir: string): Promise<LSPClient | null> {
    // Return existing client if available and ready
    const existing = this.clients.get(languageId);
    if (existing?.isReady()) {
      return existing;
    }

    // Discover servers on first use
    if (!this.discovered) {
      await this.discoverServers();
    }

    // Find server config
    const serverConfig = this.availableServers.get(languageId);
    if (!serverConfig) {
      logger.debug({ language: languageId }, 'No language server available');
      return null;
    }

    // Create and initialize client
    const clientOptions: LSPClientOptions = {
      command: serverConfig.command,
      args: serverConfig.args,
      workspaceDir,
    };

    const client = new LSPClient(clientOptions);
    const initialized = await client.initialize();

    if (!initialized) {
      logger.warn({ language: languageId, server: serverConfig.command }, 'Failed to initialize language server');
      return null;
    }

    this.clients.set(languageId, client);
    return client;
  }

  /**
   * Get the appropriate language ID for a file extension
   */
  getLanguageForExtension(ext: string): string | null {
    const allServers = [...this.customServers, ...KNOWN_SERVERS];
    for (const server of allServers) {
      if (server.extensions.includes(ext)) {
        return server.languageId;
      }
    }
    return null;
  }

  /**
   * Get diagnostics for a file through the appropriate language server
   */
  async getDiagnostics(
    filePath: string,
    content: string,
    languageId: string,
    workspaceDir: string,
  ): Promise<LSPDiagnostic[]> {
    const client = await this.getClient(languageId, workspaceDir);
    if (!client) return [];

    client.openDocument(filePath, content, languageId);

    // Small delay to allow the server to process
    await new Promise(resolve => setTimeout(resolve, 500));

    const diagnostics = client.getDiagnostics(filePath);
    client.closeDocument(filePath);

    return diagnostics;
  }

  /**
   * Get definition location through the appropriate language server
   */
  async getDefinition(
    filePath: string,
    content: string,
    line: number,
    character: number,
    languageId: string,
    workspaceDir: string,
  ): Promise<LSPLocation[]> {
    const client = await this.getClient(languageId, workspaceDir);
    if (!client) return [];

    client.openDocument(filePath, content, languageId);
    const result = await client.getDefinition(filePath, line, character);
    client.closeDocument(filePath);

    return result;
  }

  /**
   * Get references through the appropriate language server
   */
  async getReferences(
    filePath: string,
    content: string,
    line: number,
    character: number,
    languageId: string,
    workspaceDir: string,
  ): Promise<LSPLocation[]> {
    const client = await this.getClient(languageId, workspaceDir);
    if (!client) return [];

    client.openDocument(filePath, content, languageId);
    const result = await client.getReferences(filePath, line, character);
    client.closeDocument(filePath);

    return result;
  }

  /**
   * Get hover information through the appropriate language server
   */
  async getHover(
    filePath: string,
    content: string,
    line: number,
    character: number,
    languageId: string,
    workspaceDir: string,
  ): Promise<LSPHoverResult | null> {
    const client = await this.getClient(languageId, workspaceDir);
    if (!client) return null;

    client.openDocument(filePath, content, languageId);
    const result = await client.getHover(filePath, line, character);
    client.closeDocument(filePath);

    return result;
  }

  /**
   * List all available (discovered) language servers
   */
  getAvailableLanguages(): string[] {
    return [...this.availableServers.keys()];
  }

  /**
   * List all active (connected) language servers
   */
  getActiveLanguages(): string[] {
    const active: string[] = [];
    for (const [lang, client] of this.clients) {
      if (client.isReady()) {
        active.push(lang);
      }
    }
    return active;
  }

  /**
   * Shutdown all active language server clients
   */
  async shutdownAll(): Promise<void> {
    const shutdowns: Promise<void>[] = [];

    for (const [lang, client] of this.clients) {
      logger.debug({ language: lang }, 'Shutting down language server');
      shutdowns.push(client.shutdown());
    }

    await Promise.allSettled(shutdowns);
    this.clients.clear();
  }

  /**
   * Check if a command is available on the system PATH
   */
  private isCommandAvailable(command: string): boolean {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${whichCmd} ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
