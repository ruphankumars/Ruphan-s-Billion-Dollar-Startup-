/**
 * CortexOS Landing Page — Neural Network Canvas Animation
 * Interactive particle network with mouse-reactive physics
 */

// ═══════════════════════════════════════════════════════════════
// NEURAL NETWORK VISUALIZATION
// ═══════════════════════════════════════════════════════════════

class NeuralCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [];
    this.mouse = { x: -1000, y: -1000 };
    this.raf = null;
    this.config = {
      nodeCount: 80,
      connectionDistance: 200,
      mouseRepelDistance: 200,
      mouseRepelForce: 0.0002,
      nodeSpeed: 0.5,
      lineOpacity: 0.15,
      nodeColor: { r: 233, g: 69, b: 96 },
      glowSize: 3,
    };

    this._bindEvents();
    this._resize();
    this._animate();
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._initNodes();
  }

  _initNodes() {
    const area = this.canvas.width * this.canvas.height;
    const count = Math.min(this.config.nodeCount, Math.floor(area / 15000));
    this.nodes = [];

    for (let i = 0; i < count; i++) {
      this.nodes.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * this.config.nodeSpeed,
        vy: (Math.random() - 0.5) * this.config.nodeSpeed,
        radius: Math.random() * 2 + 1,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.02,
        energy: 0,
      });
    }
  }

  _drawConnections() {
    const { connectionDistance, lineOpacity, nodeColor } = this.config;
    const { r, g, b } = nodeColor;

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].x - this.nodes[j].x;
        const dy = this.nodes[i].y - this.nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          const opacity = (1 - dist / connectionDistance) * lineOpacity;
          const energyBoost = (this.nodes[i].energy + this.nodes[j].energy) * 0.5;
          const finalOpacity = Math.min(opacity + energyBoost * 0.2, 0.4);

          this.ctx.beginPath();
          this.ctx.moveTo(this.nodes[i].x, this.nodes[i].y);
          this.ctx.lineTo(this.nodes[j].x, this.nodes[j].y);
          this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${finalOpacity})`;
          this.ctx.lineWidth = 0.5 + energyBoost * 0.5;
          this.ctx.stroke();
        }
      }
    }
  }

  _updateNode(node) {
    node.x += node.vx;
    node.y += node.vy;
    node.pulse += node.pulseSpeed;

    // Boundary bounce
    if (node.x < 0 || node.x > this.canvas.width) node.vx *= -1;
    if (node.y < 0 || node.y > this.canvas.height) node.vy *= -1;

    // Mouse interaction
    const mdx = this.mouse.x - node.x;
    const mdy = this.mouse.y - node.y;
    const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

    if (mdist < this.config.mouseRepelDistance) {
      const force = this.config.mouseRepelForce;
      node.vx -= mdx * force;
      node.vy -= mdy * force;
      node.energy = Math.min(1, node.energy + 0.1);
    } else {
      node.energy *= 0.95;
    }

    // Speed dampening
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    const maxSpeed = 2;
    if (speed > maxSpeed) {
      node.vx = (node.vx / speed) * maxSpeed;
      node.vy = (node.vy / speed) * maxSpeed;
    }
  }

  _drawNode(node) {
    const { nodeColor, glowSize } = this.config;
    const { r, g, b } = nodeColor;
    const pulseRadius = node.radius + Math.sin(node.pulse) * 0.5;
    const energyGlow = 1 + node.energy * 2;

    // Glow
    const gradient = this.ctx.createRadialGradient(
      node.x, node.y, 0,
      node.x, node.y, pulseRadius * glowSize * energyGlow
    );
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.6 + node.energy * 0.4})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, pulseRadius * glowSize * energyGlow, 0, Math.PI * 2);
    this.ctx.fillStyle = gradient;
    this.ctx.fill();

    // Core
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.8 + node.energy * 0.2})`;
    this.ctx.fill();
  }

  _animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawConnections();

    for (const node of this.nodes) {
      this._updateNode(node);
      this._drawNode(node);
    }

    this.raf = requestAnimationFrame(() => this._animate());
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}

// ═══════════════════════════════════════════════════════════════
// CURSOR GLOW FOLLOWER
// ═══════════════════════════════════════════════════════════════

class CursorGlow {
  constructor(elementId) {
    this.glow = document.getElementById(elementId);
    if (!this.glow) return;
    this.mx = 0;
    this.my = 0;
    this.cx = 0;
    this.cy = 0;
    this.lerp = 0.08;

    document.addEventListener('mousemove', (e) => {
      this.mx = e.clientX;
      this.my = e.clientY;
    });

    this._animate();
  }

  _animate() {
    this.cx += (this.mx - this.cx) * this.lerp;
    this.cy += (this.my - this.cy) * this.lerp;
    this.glow.style.left = this.cx + 'px';
    this.glow.style.top = this.cy + 'px';
    requestAnimationFrame(() => this._animate());
  }
}

// ═══════════════════════════════════════════════════════════════
// PARALLAX ORBS
// ═══════════════════════════════════════════════════════════════

class ParallaxOrbs {
  constructor(selector) {
    this.orbs = document.querySelectorAll(selector);
    if (!this.orbs.length) return;

    window.addEventListener('scroll', () => this._update(), { passive: true });
  }

  _update() {
    const scrollY = window.scrollY;
    this.orbs.forEach((orb, i) => {
      const speed = 0.3 + i * 0.1;
      orb.style.transform = `translateY(${scrollY * speed}px)`;
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// MAGNETIC BUTTON EFFECT
// ═══════════════════════════════════════════════════════════════

class MagneticButtons {
  constructor(selector) {
    this.buttons = document.querySelectorAll(selector);
    this.buttons.forEach(btn => this._bind(btn));
  }

  _bind(btn) {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// TILT EFFECT FOR CARDS
// ═══════════════════════════════════════════════════════════════

class TiltCards {
  constructor(selector) {
    this.cards = document.querySelectorAll(selector);
    this.cards.forEach(card => this._bind(card));
  }

  _bind(card) {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const tiltX = (y - 0.5) * 8;
      const tiltY = (x - 0.5) * -8;

      card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-8px) scale(1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
      setTimeout(() => { card.style.transition = ''; }, 500);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// FLOATING PARTICLES
// ═══════════════════════════════════════════════════════════════

class FloatingParticles {
  constructor(containerId, count = 20) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    for (let i = 0; i < count; i++) {
      this._createParticle();
    }
  }

  _createParticle() {
    const particle = document.createElement('div');
    const size = 2 + Math.random() * 4;
    const duration = 8 + Math.random() * 12;
    const delay = Math.random() * duration;
    const startX = Math.random() * 100;
    const startY = Math.random() * 100;

    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: rgba(233, 69, 96, ${0.1 + Math.random() * 0.3});
      left: ${startX}%;
      top: ${startY}%;
      pointer-events: none;
      animation: particle-float ${duration}s ${delay}s infinite ease-in-out;
      --tx: ${(Math.random() - 0.5) * 200}px;
      --ty: ${(Math.random() - 0.5) * 200}px;
    `;

    this.container.appendChild(particle);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEXT SCRAMBLE EFFECT
// ═══════════════════════════════════════════════════════════════

class TextScramble {
  constructor(el) {
    this.el = el;
    this.chars = '!<>-_\\/[]{}—=+*^?#________';
    this.frame = 0;
    this.queue = [];
    this.resolve = null;
  }

  setText(newText) {
    const oldText = this.el.textContent;
    const length = Math.max(oldText.length, newText.length);
    this.queue = [];

    for (let i = 0; i < length; i++) {
      const from = oldText[i] || '';
      const to = newText[i] || '';
      const start = Math.floor(Math.random() * 40);
      const end = start + Math.floor(Math.random() * 40);
      this.queue.push({ from, to, start, end });
    }

    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this._update();
  }

  _update() {
    let output = '';
    let complete = 0;

    for (let i = 0; i < this.queue.length; i++) {
      let { from, to, start, end, char } = this.queue[i];

      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.chars[Math.floor(Math.random() * this.chars.length)];
          this.queue[i].char = char;
        }
        output += `<span style="color:var(--accent-primary);opacity:0.6">${char}</span>`;
      } else {
        output += from;
      }
    }

    this.el.innerHTML = output;

    if (complete < this.queue.length) {
      this.frameRequest = requestAnimationFrame(() => {
        this.frame++;
        this._update();
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION PROGRESS INDICATOR
// ═══════════════════════════════════════════════════════════════

class ScrollProgress {
  constructor() {
    this.bar = document.createElement('div');
    this.bar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(90deg, #e94560, #7b2ff7, #00d2ff);
      z-index: 10000;
      transition: width 0.1s linear;
      border-radius: 0 2px 2px 0;
      box-shadow: 0 0 10px rgba(233, 69, 96, 0.5);
    `;
    document.body.appendChild(this.bar);

    window.addEventListener('scroll', () => this._update(), { passive: true });
  }

  _update() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = (scrollTop / docHeight) * 100;
    this.bar.style.width = progress + '%';
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT & INIT
// ═══════════════════════════════════════════════════════════════

window.CortexAnimations = {
  NeuralCanvas,
  CursorGlow,
  ParallaxOrbs,
  MagneticButtons,
  TiltCards,
  FloatingParticles,
  TextScramble,
  ScrollProgress,
};
