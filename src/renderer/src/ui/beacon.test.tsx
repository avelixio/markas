import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t, tCount } from "../i18n";
import { crewState, setCrewSignal } from "./crew-signal";
import { Shell } from "./Shell";

beforeEach(() => {
  setLanguage("en");
  setCrewSignal({ working: 0, waiting: 0 });
  // The areas ask the host for their lists; none of that matters here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ result: [] }), { status: 200 })),
  );
});

afterEach(() => {
  setCrewSignal({ working: 0, waiting: 0 });
  vi.unstubAllGlobals();
});

describe("the beacon", () => {
  it("puts a bot that waits on the person ahead of bots that are working", () => {
    expect(crewState({ working: 0, waiting: 0 })).toBe("idle");
    expect(crewState({ working: 3, waiting: 0 })).toBe("working");
    expect(crewState({ working: 3, waiting: 1 })).toBe("waiting");
  });

  it("shows the crew's state on the rail and follows it as it changes", () => {
    render(() => <Shell chats={<p>chat area</p>} />);
    const beacon = screen.getByRole("button", { name: t("beacon.idle") });
    expect(beacon).toHaveAttribute("data-state", "idle");

    setCrewSignal({ working: 2, waiting: 0 });
    expect(beacon).toHaveAttribute("data-state", "working");
    expect(beacon).toHaveAccessibleName(tCount("beacon.working", 2));

    setCrewSignal({ working: 2, waiting: 1 });
    expect(beacon).toHaveAttribute("data-state", "waiting");
    expect(beacon).toHaveAccessibleName(tCount("beacon.waiting", 1));
  });

  it("brings the person back to Chats from any area", async () => {
    render(() => <Shell chats={<p>chat area</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
    expect(screen.getByText("chat area")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("beacon.idle") }));
    expect(screen.getByText("chat area")).toBeVisible();
  });
});
