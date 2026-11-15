import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_AVATAR_SHAPES } from "../../../shared/ipc";
import { AgentMark } from "../components/AgentMark";
import { CONNECTION_EVENT } from "../host-client";
import { ConnectionBanner } from "./ConnectionBanner";
import { Icon } from "./Icon";
import { ICONS } from "./icons";
import { SIGIL_COLORS, SIGIL_PATTERN_COUNT, Sigil } from "./Sigil";

const announce = (connected: boolean) =>
  window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { connected } }));

describe("ConnectionBanner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays hidden while connected and through a brief drop", () => {
    render(() => <ConnectionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    announce(false);
    vi.advanceTimersByTime(1000);
    announce(true);
    vi.advanceTimersByTime(5000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appears after a lasting drop and clears when the stream returns", () => {
    render(() => <ConnectionBanner />);
    announce(false);
    vi.advanceTimersByTime(1600);
    expect(screen.getByRole("alert")).toHaveTextContent("Markas is disconnected");
    expect(screen.getByRole("button", { name: "Reconnect now" })).toBeInTheDocument();
    announce(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Icon", () => {
  it("draws every part of an icon and is decorative by default", () => {
    const { container } = render(() => <Icon name="search" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.querySelectorAll("path, circle")).toHaveLength(ICONS.search.length);
  });

  it("is announced when it has a label", () => {
    render(() => <Icon name="warning" label="Warning" size={12} />);
    expect(screen.getByRole("img", { name: "Warning" })).toHaveAttribute("width", "12");
  });

  it("has artwork for every icon name", () => {
    for (const [name, parts] of Object.entries(ICONS)) {
      expect(parts.length, name).toBeGreaterThan(0);
    }
  });
});

describe("Sigil", () => {
  it("draws a different mark for each of the eight patterns", () => {
    const marks = new Set<string>();
    for (let pattern = 0; pattern < SIGIL_PATTERN_COUNT; pattern += 1) {
      const { container, unmount } = render(() => <Sigil pattern={pattern} color="mint" />);
      marks.add(container.querySelector('[data-slot="mark"]')?.innerHTML ?? "");
      unmount();
    }
    expect(marks.size).toBe(SIGIL_PATTERN_COUNT);
  });

  it("takes its tile colour from the sigil token and wraps out-of-range patterns", () => {
    const { container } = render(() => <Sigil pattern={9} color="coral" size={40} />);
    expect(container.querySelector('[data-slot="tile"]')).toHaveAttribute(
      "fill",
      "var(--mk-sigil-coral)",
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(SIGIL_COLORS).toHaveLength(8);
  });
});

describe("AgentMark", () => {
  it("maps each stored avatar shape to its own pattern", () => {
    const patterns = BOT_AVATAR_SHAPES.map((shape) => {
      const { container, unmount } = render(() => <AgentMark shape={shape} />);
      const pattern = container.querySelector("svg")?.getAttribute("data-pattern");
      unmount();
      return pattern;
    });
    expect(new Set(patterns).size).toBe(BOT_AVATAR_SHAPES.length);
  });
});
