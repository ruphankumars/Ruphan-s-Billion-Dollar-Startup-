import { homedir, platform, cpus, totalmem } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Get the CortexOS global data directory
 */
export function getGlobalDir(): string {
  return join(homedir(), '.cortexos');
}

/**
 * Get the CortexOS global config file path
 */
export function getGlobalConfigPath(): string {
  return join(getGlobalDir(), 'config.yaml');
}

/**
 * Get the project config file path
 */
export function getProjectConfigPath(projectDir: string): string {
  return join(projectDir, '.cortexos.yaml');
}

/**
 * Get the project data directory
 */
export function getProjectDataDir(projectDir: string): string {
  return join(projectDir, '.cortexos');
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return platform() === 'darwin';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return platform() === 'linux';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return platform() === 'win32';
}

/**
 * Get the number of available CPU cores
 */
export function getCPUCount(): number {
  return cpus().length;
}

/**
 * Get available memory in GB
 */
export function getMemoryGB(): number {
  return Math.round(totalmem() / (1024 * 1024 * 1024));
}

/**
 * Determine optimal number of parallel agents based on system resources
 */
export function getOptimalParallelism(): number {
  const cores = getCPUCount();
  const memGB = getMemoryGB();
  // Each agent uses ~200MB, leave 4GB for system
  const maxByMemory = Math.floor((memGB - 4) / 0.2);
  // Leave 2 cores for system
  const maxByCPU = Math.max(1, cores - 2);
  // Cap at 16
  return Math.min(maxByCPU, maxByMemory, 16);
}

/**
 * Check if a command is available in PATH
 */
export function isCommandAvailable(command: string): boolean {
  try {
    const { execSync } = require('child_process');
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the user's default shell
 */
export function getDefaultShell(): string {
  return process.env.SHELL || (isWindows() ? 'cmd.exe' : '/bin/bash');
}
