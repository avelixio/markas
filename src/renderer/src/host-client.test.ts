import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_EVENT,
  closeHostEvents,
  createHostClient,
  establishSession,
  HostUnauthorizedError,
} from "./host-client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.instances = [];
  closeHostEvents();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host client", () => {
  it("posts a method call as JSON and returns the result", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { result: [{ id: "atlas" }] }));
    const client = createHostClient();
    await expect(client.agent.listBots()).resolves.toEqual([{ id: "atlas" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/agent.listBots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: undefined }),
    });
  });

  it("surfaces the host's error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "botId is required." }));
    await expect(createHostClient().agent.deleteBot("")).rejects.toThrow("botId is required.");
  });

  it("reports a missing session as unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized." }));
    await expect(createHostClient().getAppInfo()).rejects.toBeInstanceOf(HostUnauthorizedError);
  });

  it("delivers agent events from the event stream and announces the connection state", () => {
    const client = createHostClient();
    const events: unknown[] = [];
    const states: boolean[] = [];
    const onState = (event: Event) =>
      states.push((event as CustomEvent<{ connected: boolean }>).detail.connected);
    window.addEventListener(CONNECTION_EVENT, onState);

    const unsubscribe = client.agent.onEvent((event) => events.push(event));
    const source = FakeEventSource.instances[0];
    expect(source?.url).toBe("/api/events");
    source?.emit("open");
    source?.emit("agent", { data: JSON.stringify({ type: "status" }) });
    source?.emit("error");
    unsubscribe();
    source?.emit("agent", { data: JSON.stringify({ type: "ignored" }) });

    expect(events).toEqual([{ type: "status" }]);
    expect(states).toEqual([true, false]);
    window.removeEventListener(CONNECTION_EVENT, onState);
  });

  it("opens only one event stream however many listeners subscribe", () => {
    const client = createHostClient();
    client.agent.onEvent(() => undefined);
    client.agent.onEvent(() => undefined);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("refuses to open links that are not HTTP(S)", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const client = createHostClient();
    await expect(client.openUrl("javascript:alert(1)")).rejects.toThrow("Only HTTP(S) links");
    await client.openUrl("https://example.com/a");
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});

describe("session sign-in", () => {
  const token = "a".repeat(64);

  it("swaps the token in the URL fragment for a session and removes it from the address", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const history = { replaceState: vi.fn() } as unknown as History;
    const location = { hash: `#token=${token}`, pathname: "/", search: "" } as Location;
    await establishSession(location, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(fetchMock).toHaveBeenCalledWith("/api/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it("does nothing without a token and rejects a refused token", async () => {
    const history = { replaceState: vi.fn() } as unknown as History;
    await establishSession({ hash: "", pathname: "/", search: "" } as Location, history);
    await establishSession(
      { hash: "#token=short", pathname: "/", search: "" } as Location,
      history,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized." }));
    await expect(
      establishSession({ hash: `#token=${token}`, pathname: "/", search: "" } as Location, history),
    ).rejects.toBeInstanceOf(HostUnauthorizedError);
  });
});
