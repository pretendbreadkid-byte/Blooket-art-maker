// Confetti for the pack opener. It moves like canvas-confetti, the library
// Blooket's own unlock screen uses: pieces fly out fast, slow down, wobble,
// flip over and fade as they fall.

const FPS_TICKS = 200;

// Where each rarity's confetti comes from, as Blooket does it:
// Rare from the bottom corners, Epic from both sides, Legendary rains from the
// top, Chroma and Unique from every corner along with their gems.
export const BURSTS = {
  none: [],
  'bottom-corners': [{ x: 0, y: 1, angle: 60 }, { x: 1, y: 1, angle: 120 }],
  sides: [{ x: 0, y: 0.55, angle: 20 }, { x: 1, y: 0.55, angle: 160 }],
  top: [{ x: 'any', y: -0.05, angle: 270, spread: 70, rain: true }],
  'all-corners': [{ x: 0, y: 1, angle: 55 }, { x: 1, y: 1, angle: 125 }, { x: 0, y: 0, angle: 315 }, { x: 1, y: 0, angle: 225 }],
};

function piece(origin, w, h, look, rand) {
  const spread = ((origin.spread ?? 50) * Math.PI) / 180;
  const angle = (origin.angle * Math.PI) / 180;
  const speed = (origin.rain ? 6 : look.speed) * (h / 900);
  return {
    x: (origin.x === 'any' ? rand() : origin.x) * w,
    y: origin.y * h,
    wobble: rand() * 10,
    wobbleSpeed: Math.min(0.11, rand() * 0.1 + 0.05),
    velocity: speed * 0.5 + rand() * speed,
    angle2D: -angle + (0.5 * spread - rand() * spread),
    tilt: (rand() * 0.5 + 0.25) * Math.PI,
    color: look.colors[Math.floor(rand() * look.colors.length)],
    image: look.images?.length && rand() < look.imageShare ? look.images[Math.floor(rand() * look.images.length)] : null,
    tick: 0,
    ticks: FPS_TICKS * (origin.rain ? 1.6 : 1),
    decay: origin.rain ? 0.97 : 0.9,
    gravity: 3 * (origin.rain ? 0.55 : 1) * (h / 900),
    drift: (rand() - 0.5) * (origin.rain ? 1.2 : 0.4),
    scalar: (look.scalar || 1.5) * Math.max(0.7, h / 900),
    round: rand() < 0.35,
  };
}

// Moves a piece one frame on. Returns false once it has faded out.
export function step(p) {
  p.x += Math.cos(p.angle2D) * p.velocity + p.drift;
  p.y += Math.sin(p.angle2D) * p.velocity + p.gravity;
  p.velocity *= p.decay;
  p.wobble += p.wobbleSpeed;
  p.tilt += 0.1;
  p.tick += 1;
  return p.tick < p.ticks;
}

function draw(ctx, p) {
  const fade = 1 - p.tick / p.ticks;
  const s = p.scalar;
  const wx = p.x + 10 * s * Math.cos(p.wobble), wy = p.y + 10 * s * Math.sin(p.wobble);
  ctx.globalAlpha = fade;
  if (p.image) {
    const size = 34 * s;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);
    ctx.scale(1, Math.abs(Math.cos(p.wobble)) * 0.6 + 0.4);
    ctx.drawImage(p.image, -size / 2, -size / 2, size, size);
    ctx.restore();
    return;
  }
  ctx.fillStyle = p.color;
  const r = (Math.random() + 2) * s;
  ctx.beginPath();
  if (p.round) {
    ctx.ellipse(p.x, p.y, Math.abs(wx - p.x) * 0.6 + 1, Math.abs(wy - p.y) * 0.6 + 1, (Math.PI / 10) * p.wobble, 0, Math.PI * 2);
  } else {
    ctx.moveTo(Math.floor(p.x), Math.floor(p.y));
    ctx.lineTo(Math.floor(p.x + r * Math.cos(p.tilt)), Math.floor(p.y + r * Math.sin(p.tilt)));
    ctx.lineTo(Math.floor(wx + r * Math.cos(p.tilt)), Math.floor(wy + r * Math.sin(p.tilt)));
    ctx.lineTo(Math.floor(wx), Math.floor(wy));
  }
  ctx.closePath();
  ctx.fill();
}

// A full-screen canvas over `host`. fire() adds a burst; it runs until every piece is gone.
export function confettiLayer(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  let pieces = [], frame = 0, timers = [];

  const fit = () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = host.clientWidth * ratio;
    canvas.height = host.clientHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const loop = () => {
    ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);
    pieces = pieces.filter(step);
    pieces.forEach((p) => draw(ctx, p));
    ctx.globalAlpha = 1;
    frame = pieces.length ? requestAnimationFrame(loop) : 0;
  };

  const burst = (kind, look) => {
    const w = host.clientWidth, h = host.clientHeight;
    for (const origin of BURSTS[kind] || []) {
      for (let i = 0; i < look.count; i++) pieces.push(piece(origin, w, h, look, Math.random));
    }
    if (!frame) frame = requestAnimationFrame(loop);
  };

  return {
    // look: { colors, count, speed, waves, gap, images, imageShare, scalar }
    fire(kind, look) {
      if (kind === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      fit();
      for (let i = 0; i < (look.waves || 1); i++) timers.push(setTimeout(() => burst(kind, look), i * (look.gap || 200)));
    },
    stop() {
      timers.forEach(clearTimeout);
      timers = [];
      pieces = [];
      cancelAnimationFrame(frame);
      frame = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
