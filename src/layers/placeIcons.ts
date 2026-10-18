// One small icon per place kind, drawn to a canvas once per color and reused by every billboard.
// Drawn at 2x so they stay sharp on high-density screens. Each icon has a halo stroke under the ink.
import type { PlaceKind } from '../map/places';

const SIZE = 32;
const cache = new Map<string, string>();

type Painter = (ctx: CanvasRenderingContext2D, ink: string, halo: string) => void;

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

const PAINTERS: Record<PlaceKind, Painter> = {
  // Cities: a ringed dot.
  city: (ctx, ink, halo) => {
    ring(ctx, 16, 16, 10);
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ring(ctx, 16, 16, 4.5);
    ctx.fillStyle = ink;
    ctx.fill();
  },
  // Towns and neighborhoods: plain dots, smaller and lighter.
  town: (ctx, ink, halo) => {
    ring(ctx, 16, 16, 5.5);
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = halo;
    ctx.stroke();
  },
  neighborhood: (ctx, ink) => {
    ring(ctx, 16, 16, 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
  },
  // Peaks: a filled triangle.
  peak: (ctx, ink, halo) => {
    ctx.beginPath();
    ctx.moveTo(16, 5);
    ctx.lineTo(27, 25);
    ctx.lineTo(5, 25);
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = halo;
    ctx.stroke();
  },
  // Canyons: a chevron pointing down a V-shaped valley.
  canyon: (ctx, ink, halo) => {
    ctx.beginPath();
    ctx.moveTo(5, 9);
    ctx.lineTo(16, 24);
    ctx.lineTo(27, 9);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = halo;
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  },
  // Parks: a conifer.
  park: (ctx, ink, halo) => {
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(27, 22);
    ctx.lineTo(5, 22);
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = halo;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillRect(14, 22, 4, 6);
  },
  // Beaches: two wave lines.
  beach: (ctx, ink, halo) => {
    const wave = (y: number) => {
      ctx.beginPath();
      ctx.moveTo(4, y);
      ctx.quadraticCurveTo(10, y - 5, 16, y);
      ctx.quadraticCurveTo(22, y + 5, 28, y);
    };
    for (const [y, width, color] of [
      [13, 4.5, halo],
      [13, 2.5, ink],
      [22, 4.5, halo],
      [22, 2.5, ink],
    ] as const) {
      wave(y);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  },
  // Trailheads: a diamond sign with a dot.
  trailhead: (ctx, ink, halo) => {
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(28, 16);
    ctx.lineTo(16, 28);
    ctx.lineTo(4, 16);
    ctx.closePath();
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ring(ctx, 16, 16, 3);
    ctx.fillStyle = ink;
    ctx.fill();
  },
  // Lookouts: a target.
  lookout: (ctx, ink, halo) => {
    ring(ctx, 16, 16, 10);
    ctx.lineWidth = 4;
    ctx.strokeStyle = halo;
    ctx.stroke();
    ring(ctx, 16, 16, 10);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ring(ctx, 16, 16, 3.5);
    ctx.fillStyle = ink;
    ctx.fill();
  },
  // Landmarks: a five-point star.
  landmark: (ctx, ink, halo) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 12 : 5.2;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const x = 16 + r * Math.cos(angle);
      const y = 16 + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = halo;
    ctx.stroke();
  },
};

/** A PNG data URL for the kind, in the given ink and halo colors. Cached per combination. */
export function placeIcon(kind: PlaceKind, ink: string, halo: string): string {
  const key = `${kind}|${ink}|${halo}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  PAINTERS[kind](ctx, ink, halo);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
