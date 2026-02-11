/**
 * Prompt Analyzer
 * Scores complexity, detects domains, identifies intent,
 * and suggests agent roles for a given prompt.
 */

import type { PromptAnalysis, PromptIntent } from './types.js';

export class PromptAnalyzer {
  /**
   * Analyze a raw user prompt
   */
  analyze(prompt: string): PromptAnalysis {
    const lower = prompt.toLowerCase();

    return {
      original: prompt,
      complexity: this.scoreComplexity(prompt),
      domains: this.detectDomains(lower),
      intent: this.detectIntent(lower),
      estimatedSubtasks: this.estimateSubtasks(prompt),
      languages: this.detectLanguages(lower),
      entities: this.extractEntities(prompt),
      suggestedRoles: this.suggestRoles(lower),
    };
  }

  /**
   * Score prompt complexity from 0 (trivial) to 1 (very complex)
   */
  private scoreComplexity(prompt: string): number {
    let score = 0;

    // Length-based complexity
    const words = prompt.split(/\s+/).length;
    if (words > 10) score += 0.1;
    if (words > 25) score += 0.1;
    if (words > 50) score += 0.1;
    if (words > 100) score += 0.1;

    // Multiple requirements (and, also, plus, additionally)
    const conjunctions = (prompt.match(/\b(and|also|plus|additionally|moreover|furthermore|as well)\b/gi) || []).length;
    score += Math.min(conjunctions * 0.05, 0.15);

    // Multiple files/components mentioned
    const fileRefs = (prompt.match(/\b[\w/]+\.\w{1,4}\b/g) || []).length;
    score += Math.min(fileRefs * 0.05, 0.15);

    // Technical terms increase complexity
    const techTerms = (prompt.match(/\b(api|database|auth|oauth|jwt|websocket|graphql|rest|crud|middleware|migration|deploy|ci|cd|docker|kubernetes|redis|postgres|mongo)\b/gi) || []).length;
    score += Math.min(techTerms * 0.05, 0.2);

    // Multiple action verbs
    const actions = (prompt.match(/\b(add|create|build|implement|fix|update|modify|refactor|optimize|test|deploy|configure|setup|integrate)\b/gi) || []).length;
    score += Math.min(actions * 0.05, 0.15);

    return Math.min(1.0, Math.max(0.1, score));
  }

  /**
   * Detect domains the prompt relates to
   */
  private detectDomains(lower: string): string[] {
    const domains: string[] = [];
    const domainPatterns: Record<string, RegExp> = {
      web: /\b(html|css|react|vue|angular|next|svelte|dom|browser|frontend|web|page|component)\b/,
      api: /\b(api|endpoint|route|rest|graphql|grpc|webhook|http|request|response)\b/,
      database: /\b(database|db|sql|postgres|mysql|mongo|redis|query|schema|migration|orm)\b/,
      auth: /\b(auth|login|signup|password|jwt|oauth|token|session|permission|role|access)\b/,
      testing: /\b(test|spec|assert|mock|stub|coverage|e2e|integration|unit)\b/,
      devops: /\b(deploy|docker|kubernetes|k8s|ci|cd|pipeline|terraform|aws|gcp|azure)\b/,
      cli: /\b(cli|command|terminal|shell|script|bash|zsh)\b/,
      mobile: /\b(mobile|ios|android|flutter|react.native|swift|kotlin|app)\b/,
      ml: /\b(machine learning|ml|ai|model|train|predict|neural|tensor|embedding)\b/,
      security: /\b(security|vulnerability|xss|csrf|injection|encrypt|ssl|tls|certificate)\b/,
    };

    for (const [domain, pattern] of Object.entries(domainPatterns)) {
      if (pattern.test(lower)) {
        domains.push(domain);
      }
    }

    return domains.length > 0 ? domains : ['general'];
  }

  /**
   * Detect the primary intent of the prompt
   */
  private detectIntent(lower: string): PromptIntent {
    const intentPatterns: [PromptIntent, RegExp][] = [
      ['fix', /\b(fix|bug|error|crash|broken|issue|problem|debug|wrong|fails?|failing)\b/],
      ['create', /\b(create|build|add|new|implement|make|generate|scaffold|setup|init)\b/],
      ['modify', /\b(change|update|modify|edit|alter|adjust|tweak|replace)\b/],
      ['refactor', /\b(refactor|restructure|reorganize|clean|simplify|extract|decouple)\b/],
      ['test', /\b(test|spec|coverage|assert|verify|validate)\b/],
      ['document', /\b(document|docs|readme|comment|explain|describe|jsdoc|typedef)\b/],
      ['analyze', /\b(analyze|understand|investigate|review|audit|inspect|check|find)\b/],
      ['optimize', /\b(optimize|performance|speed|fast|slow|memory|cache|efficient)\b/],
      ['deploy', /\b(deploy|publish|release|ship|launch|production|stage|ci|cd)\b/],
    ];

    for (const [intent, pattern] of intentPatterns) {
      if (pattern.test(lower)) {
        return intent;
      }
    }

    return 'unknown';
  }

  /**
   * Estimate how many subtasks this prompt needs
   */
  private estimateSubtasks(prompt: string): number {
    let estimate = 1;

    // Count action verbs
    const actions = (prompt.match(/\b(add|create|build|implement|fix|update|modify|refactor|optimize|test|deploy|write|setup|configure|integrate)\b/gi) || []).length;
    estimate = Math.max(estimate, actions);

    // Count "and" conjunctions connecting tasks
    const ands = (prompt.match(/\band\b/gi) || []).length;
    estimate += Math.floor(ands * 0.5);

    // Count bullet points or numbered items
    const listItems = (prompt.match(/(?:^|\n)\s*(?:\d+[.)]\s|-\s|\*\s)/g) || []).length;
    estimate = Math.max(estimate, listItems);

    // Cap at reasonable number
    return Math.min(estimate, 10);
  }

  /**
   * Detect programming languages mentioned
   */
  private detectLanguages(lower: string): string[] {
    const languages: string[] = [];
    const langPatterns: Record<string, RegExp> = {
      typescript: /\b(typescript|ts|\.tsx?)\b/,
      javascript: /\b(javascript|js|\.jsx?|node|npm)\b/,
      python: /\b(python|py|pip|django|flask|fastapi)\b/,
      rust: /\b(rust|cargo|\.rs)\b/,
      go: /\b(golang|go\b(?![\s]to)|\.go)\b/,
      java: /\b(java\b|spring|maven|gradle)\b/,
      ruby: /\b(ruby|rails|gem|\.rb)\b/,
      swift: /\b(swift|swiftui|\.swift)\b/,
      php: /\b(php|laravel|composer)\b/,
      csharp: /\b(c#|csharp|\.cs|\.net|dotnet)\b/,
      sql: /\b(sql|postgres|mysql|sqlite)\b/,
      html: /\b(html|htm)\b/,
      css: /\b(css|scss|sass|tailwind|styled)\b/,
    };

    for (const [lang, pattern] of Object.entries(langPatterns)) {
      if (pattern.test(lower)) {
        languages.push(lang);
      }
    }

    return languages;
  }

  /**
   * Extract key entities from the prompt
   */
  private extractEntities(prompt: string): string[] {
    const entities: string[] = [];

    // File paths
    const filePaths = prompt.match(/\b[\w/-]+\.[\w]{1,6}\b/g) || [];
    entities.push(...filePaths);

    // Quoted strings
    const quoted = prompt.match(/["'`]([\w\s./-]+)["'`]/g) || [];
    entities.push(...quoted.map(q => q.replace(/["'`]/g, '')));

    // CamelCase or PascalCase identifiers
    const identifiers = prompt.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || [];
    entities.push(...identifiers);

    return [...new Set(entities)].slice(0, 20);
  }

  /**
   * Suggest agent roles based on prompt analysis
   */
  private suggestRoles(lower: string): string[] {
    const roles: Set<string> = new Set();

    // Always start with orchestrator for complex tasks
    roles.add('orchestrator');

    // Researcher for understanding/investigation
    if (/\b(understand|analyze|investigate|review|find|search|read)\b/.test(lower)) {
      roles.add('researcher');
    }

    // Developer for code changes
    if (/\b(add|create|implement|build|write|fix|modify|update|code)\b/.test(lower)) {
      roles.add('developer');
    }

    // Architect for design decisions
    if (/\b(design|architect|structure|plan|organize|pattern)\b/.test(lower)) {
      roles.add('architect');
    }

    // Tester for testing
    if (/\b(test|spec|coverage|assert|verify|validate)\b/.test(lower)) {
      roles.add('tester');
    }

    // Validator always runs at end
    roles.add('validator');

    return Array.from(roles);
  }
}
