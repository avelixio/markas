import { createEffect, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { ArchivePage, LogbookPage } from "../areas/AreaPages";
import { FuelPage, SwitchboardPage } from "../areas/EnginePages";
import { OptimizerPage } from "../areas/OptimizerPage";
import { SettingsPage } from "../areas/SettingsPage";
import { callHost } from "../host-client";
import { LANGUAGES, language, type MessageKey, setLanguage, t, tCount } from "../i18n";
import { KeyringPage } from "../keyring/KeyringPage";
import { RoomsPage } from "../rooms/RoomsPage";
import { RoundsPage } from "../rounds/RoundsPage";
import {
  crewSignal,
  crewState,
  needsPerson,
  openAreaRequest,
  requestOpenBot,
  shownNotices,
} from "./crew-signal";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { Notifications } from "./Notifications";
import "./shell.css";

type Area =
  | "chats"
  | "rooms"
  | "rounds"
  | "keyring"
  | "switchboard"
  | "fuel"
  | "optimizer"
  | "archive"
  | "logbook"
  | "settings";

const AREAS: Array<{ id: Area; icon: IconName; label: MessageKey }> = [
  { id: "chats", icon: "chat", label: "nav.chats" },
  { id: "rooms", icon: "team", label: "nav.rooms" },
  { id: "rounds", icon: "routine", label: "nav.rounds" },
  { id: "keyring", icon: "key", label: "nav.keyring" },
  { id: "switchboard", icon: "link", label: "nav.switchboard" },
  { id: "fuel", icon: "zap", label: "nav.fuel" },
  { id: "optimizer", icon: "sparkle", label: "nav.optimizer" },
  { id: "archive", icon: "folder", label: "nav.archive" },
  { id: "logbook", icon: "activity", label: "nav.logbook" },
  { id: "settings", icon: "sliders", label: "nav.settings" },
];

/**
 * The frame around every area: the navigation rail on the left, the chosen area beside it.
 * Chats stays mounted while another area is open, so a running conversation is never lost.
 */
export function Shell(props: { chats: JSX.Element }) {
  const [area, setArea] = createSignal<Area>("chats");
  const [noticesOpen, setNoticesOpen] = createSignal(false);
  // The chat area can send the person to another area, such as Switchboard for an engine.
  createEffect(
    on(
      openAreaRequest,
      (request) => {
        const wanted = AREAS.find((item) => item.id === request?.area);
        if (wanted) setArea(wanted.id);
      },
      { defer: true },
    ),
  );
  const noticeCount = () => shownNotices().length;
  const noticesUrgent = () => shownNotices().some((notice) => needsPerson(notice.kind));
  /** The crew's state in words, for the beacon: who waits on the person, else who is working. */
  const beaconLabel = () => {
    const signal = crewSignal();
    if (signal.waiting > 0) return tCount("beacon.waiting", signal.waiting);
    if (signal.working > 0) return tCount("beacon.working", signal.working);
    return t("beacon.idle");
  };

  return (
    <div data-component="Shell" class="mk-shell">
      <nav data-slot="rail" class="mk-rail" aria-label={t("nav.areas")}>
        <button
          type="button"
          data-slot="beacon"
          data-state={crewState(crewSignal())}
          class="mk-rail__logo mk-beacon"
          aria-label={beaconLabel()}
          title={beaconLabel()}
          onClick={() => setArea("chats")}
        >
          <Icon name="logo" size={18} />
        </button>
        <For each={AREAS}>
          {(item) => (
            <button
              type="button"
              classList={{ "mk-rail__item": true, "is-active": area() === item.id }}
              aria-current={area() === item.id ? "page" : undefined}
              onClick={() => setArea(item.id)}
            >
              <Icon name={item.icon} size={18} />
              <span>{t(item.label)}</span>
            </button>
          )}
        </For>
        <span class="mk-rail__space" />
        <button
          type="button"
          data-slot="bell"
          classList={{ "mk-rail__item": true, "is-active": noticesOpen() }}
          aria-expanded={noticesOpen()}
          aria-label={
            noticeCount() > 0 ? tCount("notices.bell", noticeCount()) : t("notices.bell.none")
          }
          onClick={() => setNoticesOpen((open) => !open)}
        >
          <span class="mk-rail__bell">
            <Icon name="bell" size={18} />
            <Show when={noticeCount() > 0}>
              <i classList={{ "mk-rail__badge": true, "is-urgent": noticesUrgent() }}>
                {noticeCount() > 9 ? "9+" : noticeCount()}
              </i>
            </Show>
          </span>
          <span>{t("notices.title")}</span>
        </button>
        <label class="mk-rail__language">
          <span class="mk-visually-hidden">{t("nav.language")}</span>
          <Icon name="globe" size={14} />
          <select
            id="markas-language"
            value={language()}
            onChange={(event) => {
              const next = event.currentTarget.value === "id" ? "id" : "en";
              setLanguage(next);
              // Told to the host too, so Dispatch and every other window follow the choice.
              void callHost("setup.save", { language: next }).catch(() => undefined);
            }}
          >
            <For each={LANGUAGES}>
              {(code) => <option value={code}>{code.toUpperCase()}</option>}
            </For>
          </select>
        </label>
      </nav>
      <Show when={noticesOpen()}>
        <Notifications
          onClose={() => setNoticesOpen(false)}
          onOpenBot={(botId) => {
            requestOpenBot(botId);
            setArea("chats");
            setNoticesOpen(false);
          }}
        />
      </Show>
      <div data-slot="area" class="mk-area" hidden={area() !== "chats"}>
        {props.chats}
      </div>
      <Switch>
        <Match when={area() === "rooms"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <RoomsPage onOpenChats={() => setArea("chats")} />
          </div>
        </Match>
        <Match when={area() === "rounds"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <RoundsPage />
          </div>
        </Match>
        <Match when={area() === "keyring"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <KeyringPage />
          </div>
        </Match>
        <Match when={area() === "switchboard"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <SwitchboardPage />
          </div>
        </Match>
        <Match when={area() === "optimizer"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <OptimizerPage />
          </div>
        </Match>
        <Match when={area() === "fuel"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <FuelPage />
          </div>
        </Match>
        <Match when={area() === "archive"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <ArchivePage />
          </div>
        </Match>
        <Match when={area() === "settings"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <SettingsPage />
          </div>
        </Match>
        <Match when={area() === "logbook"}>
          <div data-slot="area" class="mk-area mk-area--page">
            <LogbookPage />
          </div>
        </Match>
      </Switch>
    </div>
  );
}
