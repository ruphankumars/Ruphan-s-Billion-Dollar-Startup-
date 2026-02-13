/**
 * CortexOS Landing Page — TypeScript Component System
 * Neumorphic UI components with type-safe DOM manipulation
 */

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface PipelineStage {
  id: number;
  name: string;
  icon: string;
  description: string;
  color: string;
}

interface FeatureCard {
  icon: string;
  title: string;
  description: string;
  tags: string[];
  gradient: string;
  accentGradient: string;
}

interface MetricData {
  title: string;
  badge: string;
  badgeType: 'green' | 'cyan' | 'pink';
  value: string | number;
  valueGradient: string;
  description: string;
  bars?: BarData[];
  hasWaveViz?: boolean;
}

interface BarData {
  label: string;
  percentage: string;
  displayValue: string;
  barClass: string;
}

interface ArchLayer {
  icon: string;
  iconGradient: string;
  name: string;
  description: string;
  tags: string[];
}

interface Provider {
  name: string;
  ring: number;
  position: { top?: string; bottom?: string; left?: string; right?: string };
}

interface TerminalLine {
  type: 'command' | 'output' | 'output-accent' | 'output-success' | 'blank';
  text: string;
  delay: number;
}

interface CounterConfig {
  target: number;
  suffix: string;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// DATA CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 1, name: 'RECALL', icon: '🔍', description: 'Retrieve relevant memories & context from persistent vector store', color: '#e94560' },
  { id: 2, name: 'ANALYZE', icon: '🧬', description: 'Parse intent, complexity, entities, and estimated subtask count', color: '#7b2ff7' },
  { id: 3, name: 'ENHANCE', icon: '✨', description: 'Augment prompt with memory, repo map, and chain-of-thought context', color: '#00d2ff' },
  { id: 4, name: 'DECOMPOSE', icon: '🔀', description: 'Break complex tasks into parallelizable subtask DAGs', color: '#00f5a0' },
  { id: 5, name: 'PLAN', icon: '📋', description: 'Assign agents, tools, and strategies with wave-based scheduling', color: '#ffd700' },
  { id: 6, name: 'EXECUTE', icon: '⚡', description: 'Run multi-agent swarm with IPC, handoffs, and tool orchestration', color: '#ff6b35' },
  { id: 7, name: 'VERIFY', icon: '✅', description: '6-gate quality check: lint, types, tests, security, review, syntax', color: '#00f5a0' },
  { id: 8, name: 'MEMORIZE', icon: '💾', description: 'Persist learnings with Ebbinghaus decay and cross-project sharing', color: '#f72585' },
];

export const FEATURES: FeatureCard[] = [
  {
    icon: '🤖',
    title: 'Multi-Agent Swarm',
    description: '9 specialized roles with wave-based parallel execution, IPC bus, agent handoffs, and dynamic pool scaling.',
    tags: ['9 roles', 'wave scheduler', 'IPC'],
    gradient: 'gradient-1',
    accentGradient: 'var(--gradient-accent)',
  },
  {
    icon: '🧠',
    title: 'Persistent Memory',
    description: 'SQLite vector store with TF-IDF + neural embeddings, Ebbinghaus decay, relation discovery, and cross-project recall.',
    tags: ['vector DB', 'consolidation', 'eviction'],
    gradient: 'gradient-2',
    accentGradient: 'var(--gradient-cool)',
  },
  {
    icon: '🔬',
    title: '6 Reasoning Strategies',
    description: 'Research-backed: ReAct, Reflexion, Tree-of-Thought, Multi-Agent Debate, RAG, and Tool Discovery — auto-selected per task.',
    tags: ['ReAct', 'ToT', 'RAG'],
    gradient: 'gradient-3',
    accentGradient: 'var(--gradient-neon)',
  },
  {
    icon: '🛡️',
    title: 'Quality Gate Pipeline',
    description: '6 gates (lint, types, tests, security, review, syntax) with auto-fix loop, circuit breaker protection, and streaming results.',
    tags: ['auto-fix', '6 gates', 'streaming'],
    gradient: 'gradient-4',
    accentGradient: 'var(--gradient-warm)',
  },
  {
    icon: '📊',
    title: 'Full Observability',
    description: 'Distributed tracing, real-time metrics dashboard with WebSocket, cost tracking with budget enforcement, and 19+ event types.',
    tags: ['tracing', 'dashboard', 'cost'],
    gradient: 'gradient-5',
    accentGradient: 'linear-gradient(135deg, #ffd700, #ff6b35)',
  },
  {
    icon: '🔌',
    title: 'Plugin Ecosystem',
    description: 'Sandboxed plugins with capability-based permissions, 5 built-in plugins (metrics, complexity, git, deps, docs), and lifecycle hooks.',
    tags: ['sandbox', '5 built-in', 'hooks'],
    gradient: 'gradient-6',
    accentGradient: 'linear-gradient(135deg, #7b2ff7, #f72585)',
  },
];

export const ARCHITECTURE_LAYERS: ArchLayer[] = [
  { icon: '🎯', iconGradient: 'rgba(233,69,96,0.2), rgba(123,47,247,0.2)', name: 'Core Engine', description: '8-stage pipeline, event bus, configuration, streaming controller', tags: ['engine.ts', 'streaming.ts', 'types.ts'] },
  { icon: '🤖', iconGradient: 'rgba(0,210,255,0.2), rgba(123,47,247,0.2)', name: 'Agent Layer', description: 'Coordinator, pool, roles, IPC bus, handoff executor, message bus', tags: ['coordinator.ts', 'pool.ts', 'ipc-bus.ts'] },
  { icon: '🧠', iconGradient: 'rgba(0,245,160,0.2), rgba(0,210,255,0.2)', name: 'Memory System', description: 'Vector store, consolidation, eviction, global pool, embeddings', tags: ['manager.ts', 'vector-sqlite.ts', 'global-pool.ts'] },
  { icon: '🌐', iconGradient: 'rgba(255,107,53,0.2), rgba(233,69,96,0.2)', name: 'Provider Network', description: '10 LLMs, failover chains, circuit breaker, rate limiter, prompt caching', tags: ['failover.ts', 'circuit-breaker.ts', 'rate-limiter.ts'] },
  { icon: '🛡️', iconGradient: 'rgba(255,215,0,0.2), rgba(255,107,53,0.2)', name: 'Quality Assurance', description: '6 gates, auto-fixer, verifier pipeline, sandbox enforcement', tags: ['verifier.ts', 'auto-fixer.ts', 'sandbox.ts'] },
  { icon: '🔌', iconGradient: 'rgba(123,47,247,0.2), rgba(247,37,133,0.2)', name: 'Plugin System', description: 'Registry, lifecycle, sandboxed execution, 5 built-in plugins, capability permissions', tags: ['registry.ts', 'sandbox.ts', 'builtin/'] },
];

export const PROVIDERS: Provider[] = [
  { name: 'Claude', ring: 1, position: { top: '-28px', left: 'calc(50% - 28px)' } },
  { name: 'GPT-4', ring: 1, position: { bottom: '-28px', left: 'calc(50% - 28px)' } },
  { name: 'Gemini', ring: 1, position: { top: 'calc(50% - 28px)', left: '-28px' } },
  { name: 'Llama', ring: 1, position: { top: 'calc(50% - 28px)', right: '-28px' } },
  { name: 'Mistral', ring: 2, position: { top: '-28px', left: 'calc(50% - 28px)' } },
  { name: 'Cohere', ring: 2, position: { bottom: '-28px', right: '20%' } },
  { name: 'Ollama', ring: 2, position: { top: '25%', left: '-28px' } },
  { name: 'Azure', ring: 3, position: { top: '10%', right: '5%' } },
  { name: 'AWS', ring: 3, position: { bottom: '15%', left: '10%' } },
  { name: 'Custom', ring: 3, position: { bottom: '-28px', left: 'calc(50% - 28px)' } },
];

export const TERMINAL_LINES: TerminalLine[] = [
  { type: 'command', text: 'npm install cortexos', delay: 0 },
  { type: 'output', text: '  added 12 packages in 2.1s', delay: 800 },
  { type: 'blank', text: '', delay: 1200 },
  { type: 'command', text: 'npx cortexos run --prompt "Fix auth bug"', delay: 1400 },
  { type: 'blank', text: '', delay: 2200 },
  { type: 'output-accent', text: '  ◆ RECALL    memories loaded (3 relevant)', delay: 2400 },
  { type: 'output-accent', text: '  ◆ ANALYZE   intent=bugfix, complexity=medium', delay: 2800 },
  { type: 'output-accent', text: '  ◆ ENHANCE   context injected (repo map + CoT)', delay: 3200 },
  { type: 'output-accent', text: '  ◆ DECOMPOSE 2 subtasks identified', delay: 3600 },
  { type: 'output-accent', text: '  ◆ PLAN      agents=[developer, tester]', delay: 4000 },
  { type: 'output-accent', text: '  ◆ EXECUTE   wave 1/1 complete ⚡', delay: 4400 },
  { type: 'output-success', text: '  ◆ VERIFY    6/6 gates passed ✓', delay: 4800 },
  { type: 'output-accent', text: '  ◆ MEMORIZE  2 learnings stored', delay: 5200 },
  { type: 'blank', text: '', delay: 5600 },
  { type: 'output-success', text: '  ✅ Done — 3 files changed, all tests green', delay: 5800 },
];

export const METRICS: MetricData[] = [
  {
    title: 'Test Coverage',
    badge: 'ALL PASS',
    badgeType: 'green',
    value: 1240,
    valueGradient: 'var(--gradient-neon)',
    description: 'Tests across 93 test files',
    bars: [
      { label: 'Unit', percentage: '75%', displayValue: '75%', barClass: 'bar-1' },
      { label: 'Integration', percentage: '20%', displayValue: '20%', barClass: 'bar-2' },
      { label: 'Benchmark', percentage: '5%', displayValue: '5%', barClass: 'bar-3' },
    ],
  },
  {
    title: 'Competitive Audit',
    badge: '36 BENCHMARKS',
    badgeType: 'cyan',
    value: 24,
    valueGradient: 'var(--gradient-cool)',
    description: 'Ahead or unique vs. competition',
    bars: [
      { label: 'Ahead', percentage: '67%', displayValue: '24', barClass: 'bar-1' },
      { label: 'Competitive', percentage: '22%', displayValue: '8', barClass: 'bar-2' },
      { label: 'Ready', percentage: '8%', displayValue: '3', barClass: 'bar-3' },
      { label: 'Remaining', percentage: '3%', displayValue: '1', barClass: 'bar-4' },
    ],
  },
  {
    title: 'Build Performance',
    badge: 'OPTIMIZED',
    badgeType: 'green',
    value: '<1s',
    valueGradient: 'var(--gradient-accent)',
    description: 'Full ESM + DTS build with tsup',
    hasWaveViz: true,
  },
  {
    title: 'Package Size',
    badge: 'LEAN',
    badgeType: 'cyan',
    value: '682kB',
    valueGradient: 'var(--gradient-warm)',
    description: 'Packed, tree-shakeable ESM output',
    bars: [
      { label: 'index.js', percentage: '73%', displayValue: '498k', barClass: 'bar-1' },
      { label: 'cortexos.js', percentage: '56%', displayValue: '382k', barClass: 'bar-4' },
      { label: 'worker.js', percentage: '8%', displayValue: '52k', barClass: 'bar-2' },
      { label: 'types.d.ts', percentage: '25%', displayValue: '170k', barClass: 'bar-3' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// COMPONENT RENDERER
// ═══════════════════════════════════════════════════════════════

export class ComponentRenderer {
  private root: HTMLElement;

  constructor(rootSelector: string) {
    const el = document.querySelector(rootSelector);
    if (!el) throw new Error(`Root element "${rootSelector}" not found`);
    this.root = el as HTMLElement;
  }

  /** Create a DOM element with attributes and children */
  private el(
    tag: string,
    attrs: Record<string, string> = {},
    children: (HTMLElement | string)[] = []
  ): HTMLElement {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        element.className = value;
      } else if (key.startsWith('data-')) {
        element.setAttribute(key, value);
      } else if (key === 'style') {
        element.setAttribute('style', value);
      } else {
        element.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    }
    return element;
  }

  /** Render pipeline stage cards */
  renderPipelineStages(container: HTMLElement): void {
    PIPELINE_STAGES.forEach((stage, i) => {
      const card = this.el('div', {
        className: 'pipeline-stage neu-raised reveal',
        style: `transition-delay: ${(i + 1) * 0.05}s`,
      }, [
        this.el('span', { className: 'pipeline-stage-icon' }, [stage.icon]),
        this.el('div', { className: 'pipeline-stage-number' }, [String(stage.id)]),
        this.el('div', { className: 'pipeline-stage-name' }, [stage.name]),
        this.el('div', { className: 'pipeline-stage-desc' }, [stage.description]),
      ]);
      container.appendChild(card);
    });
  }

  /** Render feature cards */
  renderFeatures(container: HTMLElement): void {
    FEATURES.forEach((feature, i) => {
      const tags = feature.tags.map(tag =>
        this.el('span', { className: 'feature-tag' }, [tag])
      );

      const card = this.el('div', {
        className: 'feature-card neu-raised reveal',
        style: `--card-accent: ${feature.accentGradient}; transition-delay: ${(i + 1) * 0.05}s`,
      }, [
        this.el('div', { className: `feature-icon ${feature.gradient}` }, [feature.icon]),
        this.el('div', { className: 'feature-title' }, [feature.title]),
        this.el('div', { className: 'feature-desc' }, [feature.description]),
        this.el('div', { className: 'feature-tags' }, tags),
      ]);
      container.appendChild(card);
    });
  }

  /** Render architecture layers */
  renderArchitecture(container: HTMLElement): void {
    ARCHITECTURE_LAYERS.forEach((layer, i) => {
      const tags = layer.tags.map(tag =>
        this.el('span', { className: 'arch-tag' }, [tag])
      );

      const archLayer = this.el('div', {
        className: 'arch-layer neu-raised reveal',
        style: `transition-delay: ${(i + 1) * 0.05}s`,
      }, [
        this.el('div', {
          className: 'arch-layer-icon',
          style: `background: linear-gradient(135deg, ${layer.iconGradient})`,
        }, [layer.icon]),
        this.el('div', { className: 'arch-layer-content' }, [
          this.el('div', { className: 'arch-layer-name' }, [layer.name]),
          this.el('div', { className: 'arch-layer-desc' }, [layer.description]),
        ]),
        this.el('div', { className: 'arch-layer-tags' }, tags),
      ]);
      container.appendChild(archLayer);
    });
  }

  /** Render metric cards */
  renderMetrics(container: HTMLElement): void {
    METRICS.forEach((metric, i) => {
      const children: HTMLElement[] = [
        this.el('div', { className: 'metric-card-header' }, [
          this.el('div', { className: 'metric-card-title' }, [metric.title]),
          this.el('div', { className: `metric-card-badge badge-${metric.badgeType}` }, [metric.badge]),
        ]),
      ];

      // Value
      const valueEl = this.el('div', {
        className: 'metric-value',
        style: `background: ${metric.valueGradient}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`,
      });

      if (typeof metric.value === 'number') {
        const counter = this.el('span', {
          className: 'counter',
          'data-target': String(metric.value),
        }, ['0']);
        valueEl.appendChild(counter);
        if (metric.title === 'Competitive Audit') {
          const suffix = document.createElement('span');
          suffix.style.cssText = '-webkit-text-fill-color: var(--text-tertiary)';
          suffix.textContent = '/36';
          valueEl.appendChild(suffix);
        }
      } else {
        valueEl.innerHTML = metric.value;
      }

      children.push(valueEl);
      children.push(this.el('div', { className: 'metric-description' }, [metric.description]));

      // Bars
      if (metric.bars) {
        const barRows = metric.bars.map(bar =>
          this.el('div', { className: 'metric-bar-row' }, [
            this.el('div', { className: 'metric-bar-label' }, [bar.label]),
            this.el('div', { className: 'metric-bar-track' }, [
              this.el('div', { className: `metric-bar-fill ${bar.barClass}`, 'data-width': bar.percentage }),
            ]),
            this.el('div', { className: 'metric-bar-value' }, [bar.displayValue]),
          ])
        );
        children.push(this.el('div', { className: 'metric-bars' }, barRows));
      }

      // Wave viz
      if (metric.hasWaveViz) {
        children.push(this.el('div', { className: 'wave-container', id: 'wave-viz' }));
      }

      const card = this.el('div', {
        className: 'metric-card neu-raised reveal',
        style: `transition-delay: ${(i + 1) * 0.05}s`,
      }, children);
      container.appendChild(card);
    });
  }

  /** Render terminal lines with typewriter effect */
  renderTerminal(container: HTMLElement): void {
    TERMINAL_LINES.forEach(line => {
      const div = this.el('div', {
        className: 'terminal-line',
        style: `animation-delay: ${line.delay}ms`,
      });

      if (line.type === 'blank') {
        div.innerHTML = '&nbsp;';
      } else if (line.type === 'command') {
        div.innerHTML = `<span class="terminal-prompt">❯</span> <span class="terminal-command">${line.text}</span>`;
      } else if (line.type === 'output-accent') {
        div.innerHTML = `<span class="terminal-accent">${line.text}</span>`;
      } else if (line.type === 'output-success') {
        div.innerHTML = `<span class="terminal-success">${line.text}</span>`;
      } else {
        div.innerHTML = `<span class="terminal-output">${line.text}</span>`;
      }

      container.appendChild(div);
    });
  }

  /** Render provider orbit nodes */
  renderProviders(rings: Map<number, HTMLElement>): void {
    PROVIDERS.forEach(provider => {
      const ring = rings.get(provider.ring);
      if (!ring) return;

      const style = Object.entries(provider.position)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');

      const node = this.el('div', {
        className: 'orbit-node neu-raised',
        style,
      }, [
        this.el('span', {}, [provider.name]),
      ]);
      ring.appendChild(node);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// SCROLL OBSERVER — Intersection-based reveal system
// ═══════════════════════════════════════════════════════════════

export class ScrollRevealSystem {
  private observer: IntersectionObserver;

  constructor(threshold = 0.1, rootMargin = '0px 0px -50px 0px') {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold, rootMargin }
    );
  }

  observe(selector: string): void {
    document.querySelectorAll(selector).forEach(el => {
      this.observer.observe(el);
    });
  }

  observeAll(): void {
    this.observe('.reveal');
    this.observe('.reveal-left');
    this.observe('.reveal-right');
    this.observe('.reveal-scale');
  }
}

// ═══════════════════════════════════════════════════════════════
// ANIMATED COUNTER SYSTEM
// ═══════════════════════════════════════════════════════════════

export class CounterAnimator {
  private observer: IntersectionObserver;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const counters = entry.target.querySelectorAll<HTMLElement>('[data-target]');
            counters.forEach(c => this.animate(c));
            this.observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );
  }

  observe(selector: string): void {
    document.querySelectorAll(selector).forEach(el => {
      this.observer.observe(el);
    });
  }

  private animate(el: HTMLElement): void {
    const target = parseInt(el.dataset.target || '0');
    const suffix = el.dataset.suffix || '';
    const duration = 2000;
    const start = performance.now();

    const update = (now: number): void => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      el.textContent = current.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(update);
    };

    requestAnimationFrame(update);
  }
}

// ═══════════════════════════════════════════════════════════════
// METRIC BAR ANIMATOR
// ═══════════════════════════════════════════════════════════════

export class BarAnimator {
  private observer: IntersectionObserver;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.querySelectorAll<HTMLElement>('.metric-bar-fill').forEach(bar => {
              setTimeout(() => {
                bar.style.width = bar.dataset.width || '0%';
              }, 300);
            });
            this.observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );
  }

  observe(selector: string): void {
    document.querySelectorAll(selector).forEach(el => {
      this.observer.observe(el);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// NAV SCROLL HANDLER
// ═══════════════════════════════════════════════════════════════

export class NavScrollHandler {
  private nav: HTMLElement;
  private scrollThreshold: number;

  constructor(navSelector: string, scrollThreshold = 50) {
    const nav = document.querySelector(navSelector);
    if (!nav) throw new Error(`Nav "${navSelector}" not found`);
    this.nav = nav as HTMLElement;
    this.scrollThreshold = scrollThreshold;
    this.bind();
  }

  private bind(): void {
    window.addEventListener('scroll', () => {
      this.nav.classList.toggle('scrolled', window.scrollY > this.scrollThreshold);
    }, { passive: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// SMOOTH SCROLL
// ═══════════════════════════════════════════════════════════════

export function initSmoothScroll(): void {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e: Event) => {
      e.preventDefault();
      const href = (e.currentTarget as HTMLAnchorElement).getAttribute('href');
      if (!href) return;
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// CLIPBOARD HANDLER
// ═══════════════════════════════════════════════════════════════

export function initCopyInstall(): void {
  document.querySelectorAll<HTMLElement>('.cta-install').forEach(el => {
    el.addEventListener('click', () => {
      navigator.clipboard.writeText('npm install cortexos').then(() => {
        const icon = el.querySelector('.copy-icon');
        if (icon) {
          icon.textContent = '✅';
          setTimeout(() => { icon.textContent = '📋'; }, 2000);
        }
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// WAVE VISUALIZER GENERATOR
// ═══════════════════════════════════════════════════════════════

export function initWaveVisualizer(containerId = 'wave-viz', barCount = 40): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    bar.style.height = `${10 + Math.random() * 40}px`;
    bar.style.animationDelay = `${i * 0.05}s`;
    bar.style.animationDuration = `${0.8 + Math.random() * 0.8}s`;
    container.appendChild(bar);
  }
}
