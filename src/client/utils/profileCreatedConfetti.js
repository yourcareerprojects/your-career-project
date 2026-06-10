import confettiImport from 'canvas-confetti';

/** Webpack production may expose the library as `.default` or harmony `.A`. */
function resolveConfettiExport(mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (mod && typeof mod.A === 'function') return mod.A;
  return null;
}

const confettiExport = resolveConfettiExport(confettiImport);

/** Lazily create on first fire so the canvas is always attached after the document is ready. */
let confettiInstance = null;

function getConfetti() {
  if (confettiInstance) return confettiInstance;
  if (!confettiExport) return null;
  confettiInstance =
    confettiExport.create != null
      ? confettiExport.create(null, { useWorker: false, resize: true })
      : confettiExport;
  return confettiInstance;
}

const CONFETTI_Z_INDEX = 9999;
/** Side-stream confetti duration (ms); initial burst is separate. */
const CELEBRATION_DURATION_MS = 1000;
/** Side-stream star burst when both simulation rankings are complete. */
const STAR_BURST_SIDE_STREAM_MS = 900;

const BRAND_CELEBRATION_COLORS = [
  '#90CAF9',
  '#64B5F6',
  '#B3E5FC',
  '#FFD54F',
  '#FFCA28',
  '#FFC107',
  '#D32F2F',
  '#E53935',
  '#C62828',
];

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-viewport confetti burst when the user completes profile creation or a full profile update.
 */
export function fireProfileCreatedConfetti() {
  const confetti = getConfetti();
  if (!confetti) return;
  if (prefersReducedMotion()) return;

  const end = Date.now() + CELEBRATION_DURATION_MS;

  confetti({
    particleCount: 90,
    spread: 80,
    startVelocity: 42,
    origin: { x: 0.5, y: 0.55 },
    zIndex: CONFETTI_Z_INDEX,
  });

  const sideStream = () => {
    confetti({
      particleCount: 2,
      angle: 60,
      spread: 62,
      origin: { x: 0, y: 0.62 },
      zIndex: CONFETTI_Z_INDEX,
    });
    confetti({
      particleCount: 2,
      angle: 120,
      spread: 62,
      origin: { x: 1, y: 0.62 },
      zIndex: CONFETTI_Z_INDEX,
    });

    if (Date.now() < end) {
      requestAnimationFrame(sideStream);
    }
  };

  requestAnimationFrame(sideStream);
}

/**
 * Star burst when both simulation role rankings are complete (non-blocking).
 */
export function fireStarBurstConfetti() {
  const confetti = getConfetti();
  if (!confetti) return;
  if (prefersReducedMotion()) return;

  const colors = BRAND_CELEBRATION_COLORS;
  const starBurst = (options) =>
    confetti({
      shapes: ['star'],
      colors,
      zIndex: CONFETTI_Z_INDEX,
      ...options,
    });

  starBurst({
    particleCount: 48,
    spread: 110,
    startVelocity: 32,
    decay: 0.93,
    origin: { x: 0.5, y: 0.55 },
  });

  const end = Date.now() + STAR_BURST_SIDE_STREAM_MS;

  const sideStream = () => {
    starBurst({
      particleCount: 2,
      angle: 60,
      spread: 62,
      startVelocity: 36,
      decay: 0.94,
      origin: { x: 0, y: 0.55 },
    });
    starBurst({
      particleCount: 2,
      angle: 120,
      spread: 62,
      startVelocity: 36,
      decay: 0.94,
      origin: { x: 1, y: 0.55 },
    });

    if (Date.now() < end) {
      requestAnimationFrame(sideStream);
    }
  };

  requestAnimationFrame(sideStream);
}
