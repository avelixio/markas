/** The motion rhythm shared with ui/tokens.css: exits take this long, then the element goes. */
export const EXIT_MS = 120;

/** True when the person asked their system for less motion; then nothing waits on an animation. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Plays an exit, then does what it leads to. The end state never depends on the animation
 * finishing: the step runs after a timer, and at once with reduced motion.
 */
export function afterExit(start: () => void, done: () => void, ms = EXIT_MS): void {
  if (prefersReducedMotion()) {
    done();
    return;
  }
  start();
  setTimeout(done, ms);
}
