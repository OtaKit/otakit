'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { LAND_MASK_BASE64, LAND_MASK_COLUMNS, LAND_MASK_ROWS } from './land-mask';

const GLOBE_CITIES: { name: string; lat: number; lon: number }[] = [
  { name: 'San Francisco', lat: 37.77, lon: -122.42 },
  { name: 'Seattle', lat: 47.61, lon: -122.33 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { name: 'Chicago', lat: 41.88, lon: -87.63 },
  { name: 'Toronto', lat: 43.65, lon: -79.38 },
  { name: 'New York', lat: 40.71, lon: -74.01 },
  { name: 'Miami', lat: 25.76, lon: -80.19 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13 },
  { name: 'Bogotá', lat: 4.71, lon: -74.07 },
  { name: 'Lima', lat: -12.05, lon: -77.04 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63 },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.38 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Madrid', lat: 40.42, lon: -3.7 },
  { name: 'Paris', lat: 48.86, lon: 2.35 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.9 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68 },
  { name: 'Stockholm', lat: 59.33, lon: 18.07 },
  { name: 'Budapest', lat: 47.5, lon: 19.04 },
  { name: 'Istanbul', lat: 41.01, lon: 28.98 },
  { name: 'Lagos', lat: 6.52, lon: 3.38 },
  { name: 'Cairo', lat: 30.04, lon: 31.24 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82 },
  { name: 'Johannesburg', lat: -26.2, lon: 28.05 },
  { name: 'Dubai', lat: 25.2, lon: 55.27 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88 },
  { name: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { name: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'Jakarta', lat: -6.21, lon: 106.85 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17 },
  { name: 'Manila', lat: 14.6, lon: 120.98 },
  { name: 'Seoul', lat: 37.57, lon: 126.98 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
  { name: 'Auckland', lat: -36.85, lon: 174.76 },
];

type Vec3 = [number, number, number];

type Arc = {
  points: Float32Array;
  to: number;
  start: number;
  duration: number;
  landed: boolean;
};

const DEG = Math.PI / 180;
const DOT_SAMPLES = 20000;
const ARC_SAMPLES = 48;
const TILT = 0.4;
const SPIN_PER_MS = 0.00006;
const START_LONGITUDE = 10;
const RIPPLE_MS = 1300;
const HEAT_MS = 1600;

const LAND_RGB = '39, 39, 42';
const ARC_RGB = '16, 185, 129';
const ORIGIN_RGB = '24, 24, 27';

function toVec(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/** Evenly spaced points on the sphere (Fibonacci lattice), kept where there is land. */
function buildLandDots(): Float32Array {
  const bits = Uint8Array.from(atob(LAND_MASK_BASE64), (char) => char.charCodeAt(0));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dots: number[] = [];

  for (let i = 0; i < DOT_SAMPLES; i++) {
    const lat = Math.asin(1 - (2 * i + 1) / DOT_SAMPLES) / DEG;
    if (lat < -58) continue; // Antarctica only adds noise at the bottom of the globe.
    const lon = (((i * golden) / DEG) % 360) - 180;
    const row = Math.min(LAND_MASK_ROWS - 1, Math.floor(((90 - lat) / 180) * LAND_MASK_ROWS));
    const col = Math.min(
      LAND_MASK_COLUMNS - 1,
      Math.floor(((lon + 180) / 360) * LAND_MASK_COLUMNS),
    );
    const index = row * LAND_MASK_COLUMNS + col;
    if ((bits[index >> 3] >> (index & 7)) & 1) dots.push(...toVec(lat, lon));
  }
  return Float32Array.from(dots);
}

/** Great-circle path between two points, lifted off the surface in proportion to its length. */
function buildArc(from: Vec3, to: Vec3): Float32Array {
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega) || 1e-6;
  const lift = 0.04 + 0.16 * (omega / Math.PI);
  const points = new Float32Array(ARC_SAMPLES * 3);

  for (let s = 0; s < ARC_SAMPLES; s++) {
    const t = s / (ARC_SAMPLES - 1);
    const wa = Math.sin((1 - t) * omega) / sinOmega;
    const wb = Math.sin(t * omega) / sinOmega;
    const height = 1 + lift * Math.sin(Math.PI * t);
    points[s * 3] = (from[0] * wa + to[0] * wb) * height;
    points[s * 3 + 1] = (from[1] * wa + to[1] * wb) * height;
    points[s * 3 + 2] = (from[2] * wa + to[2] * wb) * height;
  }
  return points;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Dotted globe that animates releases fanning out from one city to edge
 * locations worldwide. Pure 2D canvas: no WebGL and no runtime dependencies.
 */
export function UpdateGlobe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const land = buildLandDots();
    const dotCount = land.length / 3;
    const cityVecs = GLOBE_CITIES.map((city) => toVec(city.lat, city.lon));
    const cityHeat = new Float64Array(GLOBE_CITIES.length).fill(-Infinity);
    const buckets = Array.from({ length: 4 }, () => new Float32Array(dotCount * 2));
    const bucketSizes = new Uint32Array(4);

    let arcs: Arc[] = [];
    let ripples: { city: number; start: number; origin: boolean }[] = [];
    let phi = -START_LONGITUDE * DEG;
    let size = 0;
    let dpr = 1;
    let frame = 0;
    let lastTime = 0;
    let nextRelease = 0;
    let visible = false;
    let dragging = false;
    let dragX = 0;
    let velocity = 0;

    // Rotation for the current frame, shared by project().
    let sinP = 0;
    let cosP = 1;
    const sinT = Math.sin(TILT);
    const cosT = Math.cos(TILT);
    const projected = { x: 0, y: 0, z: 0 };

    function project(x: number, y: number, z: number) {
      const x1 = x * cosP + z * sinP;
      const z1 = -x * sinP + z * cosP;
      projected.x = x1;
      projected.y = y * cosT - z1 * sinT;
      projected.z = y * sinT + z1 * cosT;
    }

    function isVisible() {
      return projected.z >= 0 || projected.x ** 2 + projected.y ** 2 > 1;
    }

    function resize() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.round(canvas.clientWidth * dpr);
      canvas.width = size;
      canvas.height = size;
      if (reducedMotion) draw(performance.now());
    }

    function spawnRelease(now: number) {
      // Start and land on the side facing the viewer so every arc stays readable.
      const facing: { index: number; depth: number }[] = [];
      cityVecs.forEach(([x, y, z], index) => {
        project(x, y, z);
        if (projected.z > 0.15) facing.push({ index, depth: projected.z });
      });
      if (facing.length < 4) return;
      const central = facing.filter((city) => city.depth > 0.5);
      const pool = central.length ? central : facing;
      const origin = pool[Math.floor(Math.random() * pool.length)].index;
      const targets = shuffled(
        facing.map((city) => city.index).filter((index) => index !== origin),
      );
      const count = Math.min(targets.length, 5 + Math.floor(Math.random() * 3));

      ripples.push({ city: origin, start: now, origin: true });
      targets.slice(0, count).forEach((to, i) => {
        const [a, b] = [cityVecs[origin], cityVecs[to]];
        const distance = Math.acos(
          Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])),
        );
        arcs.push({
          points: buildArc(a, b),
          to,
          start: now + 200 + i * 140 + Math.random() * 160,
          duration: 1000 + 1100 * (distance / Math.PI),
          landed: false,
        });
      });
    }

    function draw(now: number) {
      if (!ctx) return;
      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.4;
      sinP = Math.sin(phi);
      cosP = Math.cos(phi);

      ctx.clearRect(0, 0, size, size);

      // Sphere body.
      const body = ctx.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.4,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      body.addColorStop(0, 'rgba(255, 255, 255, 1)');
      body.addColorStop(1, 'rgba(244, 244, 245, 1)');
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(24, 24, 27, 0.08)';
      ctx.stroke();

      // Land dots, bucketed by depth so each alpha level is one fill call.
      bucketSizes.fill(0);
      for (let i = 0; i < dotCount; i++) {
        project(land[i * 3], land[i * 3 + 1], land[i * 3 + 2]);
        if (projected.z <= 0) continue;
        const bucket = Math.min(3, Math.floor(projected.z * 4));
        const offset = bucketSizes[bucket]++ * 2;
        buckets[bucket][offset] = cx + projected.x * radius;
        buckets[bucket][offset + 1] = cy - projected.y * radius;
      }
      const dot = Math.max(1, radius * 0.0064);
      for (let b = 0; b < 4; b++) {
        ctx.beginPath();
        const points = buckets[b];
        for (let i = 0; i < bucketSizes[b]; i++) {
          ctx.rect(points[i * 2] - dot / 2, points[i * 2 + 1] - dot / 2, dot, dot);
        }
        ctx.fillStyle = `rgba(${LAND_RGB}, ${0.16 + b * 0.14})`;
        ctx.fill();
      }

      // Arcs: a comet whose tail follows the head, fading towards the origin.
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.6 * dpr;
      for (const arc of arcs) {
        const elapsed = now - arc.start;
        if (elapsed <= 0) continue;
        const head = easeInOut(clamp01(elapsed / arc.duration));
        const tail = easeInOut(clamp01((elapsed - arc.duration * 0.55) / arc.duration));
        if (head <= tail) continue;

        if (!arc.landed && head >= 1) {
          arc.landed = true;
          cityHeat[arc.to] = now;
          ripples.push({ city: arc.to, start: now, origin: false });
        }

        const first = Math.floor(tail * (ARC_SAMPLES - 1));
        const last = Math.ceil(head * (ARC_SAMPLES - 1));
        let prevX = 0;
        let prevY = 0;
        let prevVisible = false;
        for (let s = first; s <= last; s++) {
          project(arc.points[s * 3], arc.points[s * 3 + 1], arc.points[s * 3 + 2]);
          const x = cx + projected.x * radius;
          const y = cy - projected.y * radius;
          const pointVisible = isVisible();
          if (s > first && prevVisible && pointVisible) {
            const t = s / (ARC_SAMPLES - 1);
            const alpha = clamp01((t - tail) / (head - tail));
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = `rgba(${ARC_RGB}, ${0.9 * alpha})`;
            ctx.stroke();
          }
          prevX = x;
          prevY = y;
          prevVisible = pointVisible;
        }
        if (head < 1 && prevVisible) {
          ctx.beginPath();
          ctx.arc(prevX, prevY, 2.2 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${ARC_RGB}, 1)`;
          ctx.fill();
        }
      }
      arcs = arcs.filter((arc) => now - arc.start < arc.duration * 1.55);

      // City markers.
      for (let index = 0; index < cityVecs.length; index++) {
        const [x, y, z] = cityVecs[index];
        project(x, y, z);
        if (projected.z <= 0.02) continue;
        const heat = clamp01(1 - (now - cityHeat[index]) / HEAT_MS);
        ctx.beginPath();
        ctx.arc(
          cx + projected.x * radius,
          cy - projected.y * radius,
          (1.6 + heat * 1.6) * dpr,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = `rgba(${ARC_RGB}, ${(0.35 + heat * 0.65) * (0.4 + projected.z * 0.6)})`;
        ctx.fill();
      }

      // Ripples where a release starts (dark) and where it lands (green).
      ctx.lineWidth = 1.2 * dpr;
      for (const ripple of ripples) {
        const progress = (now - ripple.start) / RIPPLE_MS;
        if (progress < 0 || progress > 1) continue;
        const [x, y, z] = cityVecs[ripple.city];
        project(x, y, z);
        if (projected.z <= 0) continue;
        ctx.beginPath();
        ctx.arc(
          cx + projected.x * radius,
          cy - projected.y * radius,
          (3 + progress * (ripple.origin ? 22 : 14)) * dpr,
          0,
          Math.PI * 2,
        );
        const rgb = ripple.origin ? ORIGIN_RGB : ARC_RGB;
        ctx.strokeStyle = `rgba(${rgb}, ${(ripple.origin ? 0.5 : 0.6) * (1 - progress)})`;
        ctx.stroke();
      }
      ripples = ripples.filter((ripple) => now - ripple.start < RIPPLE_MS);
    }

    function tick(now: number) {
      const delta = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;
      if (!dragging) {
        phi += SPIN_PER_MS * delta + velocity;
        velocity *= 0.94;
      }
      if (now >= nextRelease) {
        spawnRelease(now);
        nextRelease = now + 1900 + Math.random() * 600;
      }
      draw(now);
      frame = requestAnimationFrame(tick);
    }

    function start() {
      if (reducedMotion || frame) return;
      lastTime = 0;
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      dragX = event.clientX;
      velocity = 0;
      canvas?.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging || !canvas) return;
      const step = ((event.clientX - dragX) / canvas.clientWidth) * Math.PI;
      dragX = event.clientX;
      phi -= step;
      velocity = -step * 0.5;
      if (reducedMotion) draw(performance.now());
    }

    function onPointerUp() {
      dragging = false;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !document.hidden) start();
      else stop();
    });
    intersectionObserver.observe(canvas);
    const onVisibilityChange = () => (document.hidden || !visible ? stop() : start());
    document.addEventListener('visibilitychange', onVisibilityChange);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    resize();
    draw(performance.now());

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'aspect-square w-full cursor-grab touch-pan-y active:cursor-grabbing',
        className,
      )}
    />
  );
}
