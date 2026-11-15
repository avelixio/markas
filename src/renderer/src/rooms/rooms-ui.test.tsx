import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Room } from "../../../shared/rooms";
import { setLanguage, t } from "../i18n";
import { openBotRequest } from "../ui/crew-signal";
import { RoomsPage } from "./RoomsPage";

const room = (overrides: Partial<Room> = {}): Room => ({
  id: "r1",
  name: "Stock room",
  purpose: "Keep stock levels and open orders in step",
  leadBotId: "atlas",
  memberBotIds: ["juno"],
  createdAt: "2026-11-13T02:00:00.000Z",
  updatedAt: "2026-11-13T02:00:00.000Z",
  ...overrides,
});

let rooms: Room[];
let bots: Array<{ id: string; name: string; role: string }>;
let calls: Array<{ method: string; input: unknown }>;
let failNext: string | null;

beforeEach(() => {
  rooms = [];
  bots = [
    { id: "atlas", name: "Atlas", role: "Stock checks" },
    { id: "juno", name: "Juno", role: "Admin console lookups" },
    { id: "mika", name: "Mika", role: "Notes" },
  ];
  calls = [];
  failNext = null;
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("/api/", "");
      const input = (JSON.parse(String(init.body)) as { input: unknown }).input;
      calls.push({ method, input });
      const respond = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (failNext) {
        const message = failNext;
        failNext = null;
        return respond(400, { error: message });
      }
      if (method === "rooms.list") return respond(200, { result: rooms });
      if (method === "agent.listBots") return respond(200, { result: bots });
      if (method === "rooms.create") {
        const created = room({ id: "new", ...(input as Partial<Room>) });
        rooms = [...rooms, created];
        return respond(200, { result: created });
      }
      if (method === "rooms.remove") {
        rooms = rooms.filter((item) => item.id !== input);
        return respond(200, { result: null });
      }
      if (method === "rooms.ask") return respond(200, { result: { leadBotId: "atlas" } });
      return respond(404, { error: `Unknown method: ${method}` });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RoomsPage", () => {
  it("says a room needs two bots when there is only one", async () => {
    bots = bots.slice(0, 1);
    render(() => <RoomsPage />);
    expect(await screen.findByText(t("rooms.needBots.title"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("rooms.new") })).toBeDisabled();
  });

  it("makes a room from a name, a lead and the other bots", async () => {
    render(() => <RoomsPage />);
    await screen.findByText(t("rooms.empty.title"));
    fireEvent.click(screen.getByRole("button", { name: t("rooms.new") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText(t("rooms.form.name")), {
      target: { value: "Stock room" },
    });
    // The lead is not offered as a member of its own room.
    expect(within(dialog).queryByLabelText("Atlas")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Juno"));
    fireEvent.click(within(dialog).getByRole("button", { name: t("rooms.form.save") }));

    expect(await screen.findByRole("article", { name: "Stock room" })).toBeInTheDocument();
    expect(calls.find((call) => call.method === "rooms.create")?.input).toEqual({
      name: "Stock room",
      purpose: "",
      leadBotId: "atlas",
      memberBotIds: ["juno"],
    });
  });

  it("keeps the form open and says why when the host refuses the room", async () => {
    render(() => <RoomsPage />);
    await screen.findByText(t("rooms.empty.title"));
    fireEvent.click(screen.getByRole("button", { name: t("rooms.new") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText(t("rooms.form.name")), {
      target: { value: "Stock room" },
    });
    failNext = "Add at least one more bot to the room.";
    fireEvent.click(within(dialog).getByRole("button", { name: t("rooms.form.save") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Add at least one more bot");
  });

  it("shows who leads and who else is in a room", async () => {
    rooms = [room()];
    render(() => <RoomsPage />);
    const card = await screen.findByRole("article", { name: "Stock room" });
    expect(within(card).getByText(t("rooms.leadChip"))).toBeInTheDocument();
    expect(within(card).getByText("Juno")).toBeInTheDocument();
    expect(within(card).getByText("Admin console lookups")).toBeInTheDocument();
  });

  it("asks the room, then opens the lead's chat where the work shows", async () => {
    rooms = [room()];
    const onOpenChats = vi.fn();
    render(() => <RoomsPage onOpenChats={onOpenChats} />);
    const card = await screen.findByRole("article", { name: "Stock room" });
    const ask = within(card).getByRole("button", { name: t("rooms.ask.send") });
    expect(ask).toBeDisabled();
    fireEvent.input(within(card).getByLabelText(t("rooms.ask.label", { name: "Stock room" })), {
      target: { value: "Is order 88213 stuck?" },
    });
    fireEvent.click(ask);
    await vi.waitFor(() => expect(onOpenChats).toHaveBeenCalledOnce());
    expect(calls.find((call) => call.method === "rooms.ask")?.input).toEqual({
      roomId: "r1",
      text: "Is order 88213 stuck?",
    });
    expect(openBotRequest()?.botId).toBe("atlas");
  });

  it("keeps the question and says why when it could not be sent", async () => {
    rooms = [room()];
    render(() => <RoomsPage />);
    const card = await screen.findByRole("article", { name: "Stock room" });
    const box = within(card).getByLabelText(t("rooms.ask.label", { name: "Stock room" }));
    fireEvent.input(box, { target: { value: "Is order 88213 stuck?" } });
    failNext = "The bot that leads this room no longer exists.";
    fireEvent.click(within(card).getByRole("button", { name: t("rooms.ask.send") }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("no longer exists");
    expect(box).toHaveValue("Is order 88213 stuck?");
  });

  it("removes a room only after a confirmation", async () => {
    rooms = [room()];
    render(() => <RoomsPage />);
    const card = await screen.findByRole("article", { name: "Stock room" });
    fireEvent.click(
      within(card).getByRole("button", { name: t("rooms.remove", { name: "Stock room" }) }),
    );
    expect(calls.some((call) => call.method === "rooms.remove")).toBe(false);
    fireEvent.click(within(card).getByRole("button", { name: t("rooms.remove.yes") }));
    expect(await screen.findByText(t("rooms.empty.title"))).toBeInTheDocument();
  });
});
