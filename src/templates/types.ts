/**
 * Project Template System — Types
 *
 * Defines project scaffolding templates for quick CortexOS project setup.
 */

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  framework?: string;
  files: TemplateFile[];
  dependencies?: string[];
  devDependencies?: string[];
  postCreate?: string[];     // Commands to run after scaffolding
  tags?: string[];
}

export interface TemplateFile {
  path: string;              // Relative path within project (supports {{var}} interpolation)
  content: string;           // File content (supports {{var}} interpolation)
  conditional?: string;      // Only create if this key is truthy in vars
}

export interface ScaffoldOptions {
  targetDir: string;
  vars?: Record<string, string>;
  overwrite?: boolean;
  skipPostCreate?: boolean;
}

export interface ScaffoldResult {
  filesCreated: string[];
  commandsRun: string[];
  errors: string[];
}
