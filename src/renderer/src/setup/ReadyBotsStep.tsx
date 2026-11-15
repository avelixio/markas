import { createMemo, createSignal, For, type JSX, Match, onMount, Show, Switch } from "solid-js";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { Sigil } from "../ui/Sigil";
import type { BotDraft, BotsClient, ReadyBot } from "./bots-client";
import { SetupNotice, SetupStage } from "./SetupStage";

interface ReadyBotsStepProps {
  client: BotsClient;
  importNotice?: JSX.Element;
  onBack: () => void;
  onImport: () => void;
  onReview: (draft: BotDraft) => void;
  /** Where people share bot files. Hidden when the app has no link to open. */
  onShare?: () => void;
}

type Load = "loading" | "loaded" | "failed";

/** Step 6, the other way: start from a bot someone already built. */
export function ReadyBotsStep(props: ReadyBotsStepProps) {
  const [bots, setBots] = createSignal<ReadyBot[]>([]);
  const [load, setLoad] = createSignal<Load>("loading");
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<string | null>(null);
  const [opening, setOpening] = createSignal<string | null>(null);
  const [openFailed, setOpenFailed] = createSignal(false);

  async function loadBots(): Promise<void> {
    setLoad("loading");
    try {
      setBots(await props.client.listReady());
      setLoad("loaded");
    } catch {
      setLoad("failed");
    }
  }

  onMount(() => void loadBots());

  const categories = createMemo(() => [...new Set(bots().map((bot) => bot.category))].sort());
  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return bots().filter(
      (bot) =>
        (category() === null || bot.category === category()) &&
        (!needle ||
          bot.name.toLowerCase().includes(needle) ||
          bot.summary.toLowerCase().includes(needle) ||
          bot.tags.some((tag) => tag.toLowerCase().includes(needle))),
    );
  });

  async function add(bot: ReadyBot): Promise<void> {
    if (opening()) return;
    setOpening(bot.id);
    setOpenFailed(false);
    try {
      props.onReview(await props.client.readReady(bot.id));
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(null);
    }
  }

  return (
    <SetupStage step="bot" label="ready.label" width={1040}>
      <div data-slot="header" class="mk-setup__heading">
        <h1>{t("ready.title")}</h1>
        <p>{t("ready.body")}</p>
      </div>

      <Switch>
        <Match when={load() === "loading"}>
          <p class="mk-quiet" role="status">
            {t("ready.loading")}
          </p>
        </Match>
        <Match when={load() === "failed"}>
          <SetupNotice tone="danger" title={t("ready.failed.title")} body={t("ready.failed.body")}>
            <button
              type="button"
              class="mk-button mk-button--primary mk-button--small"
              onClick={() => void loadBots()}
            >
              <Icon name="refresh" size={12} />
              {t("setup.engines.retry")}
            </button>
            <button type="button" class="mk-button mk-button--small" onClick={props.onImport}>
              <Icon name="file" size={12} />
              {t("ready.import")}
            </button>
          </SetupNotice>
        </Match>
        <Match when={load() === "loaded"}>
          <div data-slot="filters" class="mk-ready__filters">
            <label class="mk-setup__search">
              <Icon name="search" size={14} />
              <span class="mk-visually-hidden">{t("ready.search")}</span>
              <input
                type="search"
                placeholder={t("ready.search")}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <fieldset class="mk-segmented mk-setup__fieldset" aria-label={t("ready.title")}>
              <button
                type="button"
                aria-pressed={category() === null}
                classList={{ "mk-segmented__item": true, "is-active": category() === null }}
                onClick={() => setCategory(null)}
              >
                {t("ready.all")}
              </button>
              <For each={categories()}>
                {(name) => (
                  <button
                    type="button"
                    aria-pressed={category() === name}
                    classList={{ "mk-segmented__item": true, "is-active": category() === name }}
                    onClick={() => setCategory(name)}
                  >
                    {name}
                  </button>
                )}
              </For>
            </fieldset>
          </div>
          <Show when={openFailed()}>
            <SetupNotice tone="danger" title={t("ready.open.failed")} />
          </Show>
          <ul data-slot="grid" class="mk-ready__grid">
            <For each={shown()} fallback={<li class="mk-quiet">{t("ready.none")}</li>}>
              {(bot) => (
                <li data-component="ReadyBotCard" data-bot={bot.id}>
                  <div data-slot="header" class="mk-ready__head">
                    <Sigil pattern={bot.sigil.pattern} color={bot.sigil.color} size={32} />
                    <span>
                      <strong>{bot.name}</strong>
                      <small>{t("ready.by", { author: bot.author })}</small>
                    </span>
                    <button
                      type="button"
                      class="mk-button mk-button--small"
                      aria-label={`${t("ready.add")} ${bot.name}`}
                      disabled={opening() !== null}
                      onClick={() => void add(bot)}
                    >
                      <Icon name="plus" size={12} />
                      {t("ready.add")}
                    </button>
                  </div>
                  <p>{bot.summary}</p>
                  <div data-slot="tags" class="mk-ready__tags">
                    <For each={bot.tags}>{(tag) => <span class="mk-setup__chip">{tag}</span>}</For>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>

      {props.importNotice}

      <div data-slot="actions" class="mk-setup__actions">
        <button type="button" class="mk-button mk-button--ghost" onClick={props.onBack}>
          <Icon name="chevronLeft" size={14} />
          {t("ready.back")}
        </button>
        <button type="button" class="mk-button" onClick={props.onImport}>
          <Icon name="file" size={14} />
          {t("ready.import")}
        </button>
        <span class="mk-setup__space" />
        <Show when={props.onShare}>
          <button type="button" class="mk-button mk-button--ghost" onClick={props.onShare}>
            <Icon name="external" size={14} />
            {t("ready.share")}
          </button>
        </Show>
      </div>
    </SetupStage>
  );
}
