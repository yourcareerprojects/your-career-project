import confettiImport from 'canvas-confetti';

/** Webpack production may expose the library as `.default` or harmony `.A`. */
function resolveConfettiExport(mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (mod && typeof mod.A === 'function') return mod.A;
  return null;
}

const confettiExport = resolveConfettiExport(confettiImport);
/** Main-thread only — avoids blob: workers blocked by Helmet CSP on staging/production. */
const confetti =
  confettiExport?.create != null
    ? confettiExport.create(null, { useWorker: false, resize: true })
    : confettiExport;

const CONFETTI_Z_INDEX = 9999;
/** Side-stream confetti duration (ms); initial burst is separate. */
const CELEBRATION_DURATION_MS = 1000;

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-viewport confetti burst when the user completes profile creation or a full profile update.
 */
export function fireProfileCreatedConfetti() {
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
