/**
 * CortexOS Landing Page — Advanced Motion Graphics Engine
 * Spring physics, stagger animations, morphing shapes, and particle systems
 */

// ═══════════════════════════════════════════════════════════════
// SPRING PHYSICS ENGINE
// ═══════════════════════════════════════════════════════════════

class SpringPhysics {
  constructor(config = {}) {
    this.stiffness = config.stiffness || 170;
    this.damping = config.damping || 26;
    this.mass = config.mass || 1;
    this.velocity = 0;
    this.current = config.from || 0;
    this.target = config.to || 1;
    this.done = false;
    this.onUpdate = config.onUpdate || (() => {});
    this.onComplete = config.onComplete || (() => {});
  }

  setTarget(target) {
    this.target = target;
    this.done = false;
    this._tick();
  }

  _tick() {
    if (this.done) return;

    const springForce = -this.stiffness * (this.current - this.target);
    const dampingForce = -this.damping * this.velocity;
    const acceleration = (springForce + dampingForce) / this.mass;

    this.velocity += acceleration * (1 / 60);
    this.current += this.velocity * (1 / 60);

    if (Math.abs(this.velocity) < 0.001 && Math.abs(this.current - this.target) < 0.001) {
      this.current = this.target;
      this.velocity = 0;
      this.done = true;
      this.onUpdate(this.current);
      this.onComplete();
      return;
    }

    this.onUpdate(this.current);
    requestAnimationFrame(() => this._tick());
  }
}

// ═══════════════════════════════════════════════════════════════
// STAGGER ANIMATION SYSTEM
// ═══════════════════════════════════════════════════════════════

class StaggerAnimator {
  constructor() {
    this.queue = [];
  }

  add(elements, animation, options = {}) {
    const stagger = options.stagger || 80;
    const delay = options.delay || 0;

    elements.forEach((el, i) => {
      this.queue.push({
        el,
        animation,
        delay: delay + (i * stagger),
      });
    });

    return this;
  }

  play() {
    this.queue.forEach(({ el, animation, delay }) => {
      setTimeout(() => {
        if (animation === 'fadeInUp') {
          el.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        } else if (animation === 'fadeInScale') {
          el.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
        } else if (animation === 'slideInLeft') {
          el.style.transition = 'all 0.7s cubic-bezier(0.4, 0, 0.2, 1)';
          el.style.opacity = '1';
          el.style.transform = 'translateX(0)';
        }
      }, delay);
    });

    return this;
  }
}

// ═══════════════════════════════════════════════════════════════
// MORPHING BLOB BACKGROUND
// ═══════════════════════════════════════════════════════════════

class MorphingBlob {
  constructor(element) {
    this.el = element;
    this.points = 6;
    this.radius = 200;
    this.variance = 60;
    this.speed = 0.002;
    this.phase = 0;
    this.offsets = [];

    for (let i = 0; i < this.points; i++) {
      this.offsets.push({
        angle: (Math.PI * 2 * i) / this.points,
        speed: 0.001 + Math.random() * 0.003,
        offset: Math.random() * Math.PI * 2,
      });
    }

    this._animate();
  }

  _animate() {
    this.phase += this.speed;

    const points = this.offsets.map(o => {
      const r = this.radius + Math.sin(this.phase + o.offset) * this.variance;
      const x = Math.cos(o.angle + this.phase * o.speed) * r + this.radius;
      const y = Math.sin(o.angle + this.phase * o.speed) * r + this.radius;
      return { x, y };
    });

    // Generate smooth SVG path
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const next = points[(i + 1) % points.length];
      const mx = (curr.x + next.x) / 2;
      const my = (curr.y + next.y) / 2;
      path += ` Q ${curr.x} ${curr.y} ${mx} ${my}`;
    }
    path += ' Z';

    this.el.setAttribute('d', path);
    requestAnimationFrame(() => this._animate());
  }
}

// ═══════════════════════════════════════════════════════════════
// PARTICLE TRAIL SYSTEM
// ═══════════════════════════════════════════════════════════════

class ParticleTrail {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouse = { x: 0, y: 0 };
    this.maxParticles = 50;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this._spawn();
    });

    this._animate();
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _spawn() {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
      x: this.mouse.x,
      y: this.mouse.y,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      life: 1,
      decay: 0.01 + Math.random() * 0.02,
      size: 1 + Math.random() * 3,
      hue: 350 + Math.random() * 20,
    });
  }

  _animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles = this.particles.filter(p => p.life > 0);

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.size *= 0.99;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${p.life})`;
      this.ctx.fill();
    }

    requestAnimationFrame(() => this._animate());
  }
}

// ═══════════════════════════════════════════════════════════════
// ANIMATED GRADIENT MESH
// ═══════════════════════════════════════════════════════════════

class GradientMesh {
  constructor(element) {
    this.el = element;
    this.time = 0;
    this.colors = [
      { r: 233, g: 69, b: 96 },
      { r: 123, g: 47, b: 247 },
      { r: 0, g: 210, b: 255 },
      { r: 0, g: 245, b: 160 },
    ];
    this._animate();
  }

  _animate() {
    this.time += 0.005;

    const stops = this.colors.map((c, i) => {
      const offset = Math.sin(this.time + i * 1.5) * 20;
      const x = 25 + i * 25 + offset;
      const y = 50 + Math.cos(this.time * 0.7 + i) * 30;
      return `radial-gradient(circle at ${x}% ${y}%, rgba(${c.r},${c.g},${c.b},0.08) 0%, transparent 50%)`;
    });

    this.el.style.background = stops.join(', ');
    requestAnimationFrame(() => this._animate());
  }
}

// ═══════════════════════════════════════════════════════════════
// NUMBER MORPHER — Smooth digit transitions
// ═══════════════════════════════════════════════════════════════

class NumberMorpher {
  constructor(element, config = {}) {
    this.el = element;
    this.current = config.from || 0;
    this.duration = config.duration || 2000;
    this.easing = config.easing || this._easeOutCubic;
    this.format = config.format || ((n) => n.toLocaleString());
  }

  morphTo(target) {
    const start = this.current;
    const diff = target - start;
    const startTime = performance.now();

    const update = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / this.duration, 1);
      const eased = this.easing(progress);
      this.current = start + diff * eased;
      this.el.textContent = this.format(Math.round(this.current));

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    requestAnimationFrame(update);
  }

  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
}

// ═══════════════════════════════════════════════════════════════
// RIPPLE EFFECT
// ═══════════════════════════════════════════════════════════════

class RippleEffect {
  constructor(selector) {
    document.querySelectorAll(selector).forEach(el => {
      el.style.position = 'relative';
      el.style.overflow = 'hidden';

      el.addEventListener('click', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const size = Math.max(rect.width, rect.height) * 2;

        const ripple = document.createElement('span');
        ripple.style.cssText = `
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.15);
          width: ${size}px;
          height: ${size}px;
          left: ${x - size / 2}px;
          top: ${y - size / 2}px;
          transform: scale(0);
          animation: ripple-click 0.6s ease-out forwards;
          pointer-events: none;
        `;

        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });

    // Add keyframe if not exists
    if (!document.getElementById('ripple-style')) {
      const style = document.createElement('style');
      style.id = 'ripple-style';
      style.textContent = `
        @keyframes ripple-click {
          to { transform: scale(1); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE FLOW ANIMATION
// ═══════════════════════════════════════════════════════════════

class PipelineFlow {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) return;

    this.stages = this.container.querySelectorAll('.pipeline-stage');
    this._observe();
  }

  _observe() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this._animateFlow();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    observer.observe(this.container);
  }

  _animateFlow() {
    this.stages.forEach((stage, i) => {
      setTimeout(() => {
        const number = stage.querySelector('.pipeline-stage-number');
        if (number) {
          number.style.transition = 'all 0.3s ease';
          number.style.boxShadow = `0 0 20px ${this._getColor(i)}, 0 0 40px ${this._getColor(i)}40`;

          setTimeout(() => {
            number.style.boxShadow = '';
          }, 800);
        }
      }, i * 200);
    });
  }

  _getColor(index) {
    const colors = ['#e94560', '#7b2ff7', '#00d2ff', '#00f5a0', '#ffd700', '#ff6b35', '#00f5a0', '#f72585'];
    return colors[index % colors.length];
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

window.CortexMotion = {
  SpringPhysics,
  StaggerAnimator,
  MorphingBlob,
  ParticleTrail,
  GradientMesh,
  NumberMorpher,
  RippleEffect,
  PipelineFlow,
};
