import { afterEach, describe, expect, it, vi } from "vitest";
import { afterExit, EXIT_MS, prefersReducedMotion } from "./motion";

const reduce = (on: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: on && query.includes("reduce"), media: query })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("motion", () => {
  it("plays the exit, then does what it leads to", () => {
    vi.useFakeTimers();
    reduce(false);
    const steps: string[] = [];
    afterExit(
      () => steps.push("exit"),
      () => steps.push("done"),
    );
    expect(steps).toEqual(["exit"]);
    vi.advanceTimersByTime(EXIT_MS);
    expect(steps).toEqual(["exit", "done"]);
  });

  it("skips the exit at once when the person asked for less motion", () => {
    reduce(true);
    expect(prefersReducedMotion()).toBe(true);
    const steps: string[] = [];
    afterExit(
      () => steps.push("exit"),
      () => steps.push("done"),
    );
    expect(steps).toEqual(["done"]);
  });

  it("treats a browser without the question as full motion", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
