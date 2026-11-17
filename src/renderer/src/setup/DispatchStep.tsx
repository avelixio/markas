import { createMemo, createSignal, For, type JSX, Match, onMount, Show, Switch } from "solid-js";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Sigil } from "../ui/Sigil";
import type { BotDraft, BotsClient, DispatchMessage, DispatchTurn } from "./bots-client";
import { SetupNotice, SetupStage } from "./SetupStage";
import { type EngineId, engineName } from "./setup-client";

/** Dispatch's own sigil: the same everywhere it appears. */
export const DISPATCH_SIGIL = { pattern: 4, color: "amber" } as const;

type Down = Extract<DispatchTurn, { ok: false }>;

interface DispatchStepProps {
  client: BotsClient;
  /** False when Dispatch is opened again later, from the chat list. */
  firstBot?: boolean;
  /** Shown under the composer: the import failure notice, when a file was refused. */
  importNotice?: JSX.Element;
  onPickReady: () => void;
  onImport: () => void;
  onForm: () => void;
  onReview: (draft: BotDraft) => void;
  onBack?: () => void;
  onSkip?: () => void;
}

const STARTS: Array<{
  id: "tell" | "ready" | "import";
  icon: IconName;
  title: MessageKey;
  body: MessageKey;
}> = [
  {
    id: "tell",
    icon: "chat",
    title: "dispatch.start.tell.title",
    body: "dispatch.start.tell.body",
  },
  {
    id: "ready",
    icon: "team",
    title: "dispatch.start.ready.title",
    body: "dispatch.start.ready.body",
  },
  {
    id: "import",
    icon: "file",
    title: "dispatch.start.import.title",
    body: "dispatch.start.import.body",
  },
];

/**
 * Steps 5 and 6: Dispatch in the middle of the screen. It greets, asks what the bot should do,
 * and proposes a draft. When Dispatch cannot run there is always another way to make the bot.
 */
export function DispatchStep(props: DispatchStepProps) {
  const [messages, setMessages] = createSignal<DispatchMessage[]>([]);
  const [pending, setPending] = createSignal(true);
  const [down, setDown] = createSignal<Down | null>(null);
  const [text, setText] = createSignal("");
  let input: HTMLTextAreaElement | undefined;

  const talking = createMemo(() => messages().some((message) => message.from === "you"));
  const lastId = createMemo(() => messages().at(-1)?.id);

  async function run(turn: () => Promise<DispatchTurn>): Promise<void> {
    setPending(true);
    setDown(null);
    let result: DispatchTurn;
    try {
      result = await turn();
    } catch (error) {
      result = {
        ok: false,
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
        engine: null,
        otherEngine: null,
        messages: messages(),
      };
    }
    setMessages(result.messages);
    if (!result.ok) setDown(result);
    setPending(false);
  }

  onMount(() => void run(() => props.client.openDispatch()));

  function say(value: string): void {
    const body = value.trim();
    if (!body || pending()) return;
    setText("");
    // Shown at once, so the person never wonders whether it was sent.
    setMessages((current) => [...current, { id: `local-${Date.now()}`, from: "you", text: body }]);
    void run(() => props.client.sayToDispatch(body));
  }

  function start(id: "tell" | "ready" | "import"): void {
    if (id === "tell") input?.focus();
    else if (id === "ready") props.onPickReady();
    else props.onImport();
  }

  const otherWays = () => (
    <>
      <button type="button" class="mk-button mk-button--small" onClick={props.onPickReady}>
        <Icon name="team" size={12} />
        {t("dispatch.start.ready.title")}
      </button>
      <button
        type="button"
        class="mk-button mk-button--ghost mk-button--small"
        onClick={props.onForm}
      >
        <Icon name="pencil" size={12} />
        {t("dispatch.down.form")}
      </button>
    </>
  );

  const moveTo = (engine: EngineId) => void run(() => props.client.moveDispatch(engine));

  return (
    <SetupStage
      step={talking() ? "bot" : "dispatch"}
      label={talking() ? "dispatch.describe.label" : "dispatch.label"}
      width={talking() ? 720 : 760}
    >
      <Show
        when={talking()}
        fallback={
          <div data-slot="hello" class="mk-dispatch__hello">
            <Sigil {...DISPATCH_SIGIL} size={56} />
            <h1>{t("dispatch.name")}</h1>
            <p>{t("dispatch.tagline")}</p>
          </div>
        }
      >
        <div data-slot="header" class="mk-dispatch__header">
          <Sigil {...DISPATCH_SIGIL} size={28} />
          <span>
            <strong>{t("dispatch.name")}</strong>
            <small>{t("dispatch.describe.status")}</small>
          </span>
          <button
            type="button"
            class="mk-button mk-button--ghost mk-button--small"
            onClick={props.onPickReady}
          >
            <Icon name="team" size={12} />
            {t("dispatch.describe.readyInstead")}
          </button>
        </div>
      </Show>

      <div data-slot="messages" class="mk-dispatch__messages" aria-live="polite">
        <Show when={!talking()}>
          <div data-component="DispatchMessage" class="mk-dispatch__message">
            <Sigil {...DISPATCH_SIGIL} size={24} />
            <div data-slot="body">
              <p>{t(props.firstBot === false ? "dispatch.hello.more" : "dispatch.hello")}</p>
              <div data-slot="starts" class="mk-dispatch__starts">
                <For each={STARTS}>
                  {(item) => (
                    <button
                      type="button"
                      classList={{ "mk-dispatch__start": true, "is-primary": item.id === "tell" }}
                      onClick={() => start(item.id)}
                    >
                      <span class="mk-dispatch__start-mark" aria-hidden="true">
                        <Icon name={item.icon} size={16} />
                      </span>
                      <strong>{t(item.title)}</strong>
                      <small>{t(item.body)}</small>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <For each={talking() ? messages() : []}>
          {(message) => (
            <Switch>
              <Match when={message.from === "you"}>
                <div data-component="DispatchMessage" data-from="you" class="mk-dispatch__you">
                  <span class="mk-visually-hidden">{t("dispatch.you")}: </span>
                  <p>{message.text}</p>
                </div>
              </Match>
              <Match when={message.from === "dispatch"}>
                <div
                  data-component="DispatchMessage"
                  data-from="dispatch"
                  class="mk-dispatch__message"
                >
                  <Sigil {...DISPATCH_SIGIL} size={24} />
                  <div data-slot="body">
                    <p>{message.text}</p>
                    <Show when={message.quickReplies?.length && message.id === lastId()}>
                      <div data-slot="quick-replies" class="mk-dispatch__replies">
                        <For each={message.quickReplies}>
                          {(reply) => (
                            <button type="button" disabled={pending()} onClick={() => say(reply)}>
                              {reply}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={message.draft}>
                      {(draft) => (
                        <DraftCard
                          draft={draft()}
                          current={message.id === lastId()}
                          onChange={() => input?.focus()}
                          onReview={() => props.onReview(draft())}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              </Match>
            </Switch>
          )}
        </For>

        <Show when={pending()}>
          <p class="mk-dispatch__thinking" role="status">
            <Sigil {...DISPATCH_SIGIL} size={24} />
            {t("dispatch.thinking")}
          </p>
        </Show>
      </div>

      <Show when={down()}>
        {(failure) => (
          <Switch>
            <Match when={failure().reason === "failed"}>
              <SetupNotice
                tone="danger"
                title={t("dispatch.failed.title")}
                body={t("dispatch.failed.body")}
              >
                <button
                  type="button"
                  class="mk-button mk-button--primary mk-button--small"
                  onClick={() => void run(() => props.client.redraft())}
                >
                  <Icon name="refresh" size={12} />
                  {t("dispatch.failed.again")}
                </button>
                {otherWays()}
              </SetupNotice>
            </Match>
            <Match when={failure().reason !== "failed"}>
              <SetupNotice
                tone="danger"
                title={
                  failure().reason === "limit"
                    ? t("dispatch.down.limit.title", {
                        engine: failure().engine
                          ? engineName(failure().engine as EngineId)
                          : t("dispatch.down.theEngine"),
                      })
                    : t("dispatch.down.unavailable.title")
                }
                body={
                  failure().otherEngine
                    ? t("dispatch.down.body.other", {
                        engine: engineName(failure().otherEngine as EngineId),
                      })
                    : `${failure().message} ${t("dispatch.down.body")}`.trim()
                }
              >
                <Show when={failure().otherEngine}>
                  {(other) => (
                    <button
                      type="button"
                      class="mk-button mk-button--primary mk-button--small"
                      onClick={() => moveTo(other())}
                    >
                      {t("dispatch.down.useOther", { engine: engineName(other()) })}
                    </button>
                  )}
                </Show>
                {otherWays()}
              </SetupNotice>
            </Match>
          </Switch>
        )}
      </Show>

      <form
        data-component="DispatchComposer"
        class="mk-dispatch__composer"
        onSubmit={(event) => {
          event.preventDefault();
          say(text());
        }}
      >
        <label class="mk-visually-hidden" for="markas-dispatch-input">
          {t(talking() ? "dispatch.composer.change" : "dispatch.composer")}
        </label>
        <textarea
          id="markas-dispatch-input"
          ref={input}
          rows={1}
          placeholder={t(talking() ? "dispatch.composer.change" : "dispatch.composer")}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              say(text());
            }
          }}
        />
        <span class="mk-quiet">{t("dispatch.enter")}</span>
        <button
          type="submit"
          class="mk-dispatch__send"
          aria-label={t("dispatch.send")}
          disabled={!text().trim() || pending()}
        >
          <Icon name="send" size={14} />
        </button>
      </form>

      {props.importNotice}

      <Show when={props.onBack || props.onSkip}>
        <div data-slot="actions" class="mk-setup__actions">
          <Show when={props.onBack}>
            <button type="button" class="mk-button mk-button--ghost" onClick={props.onBack}>
              <Icon name="chevronLeft" size={14} />
              {t("setup.back")}
            </button>
          </Show>
          <span class="mk-setup__space" />
          <Show when={props.onSkip}>
            <button type="button" class="mk-button mk-button--ghost" onClick={props.onSkip}>
              {t("dispatch.skip")}
            </button>
          </Show>
        </div>
      </Show>
    </SetupStage>
  );
}

function DraftCard(props: {
  draft: BotDraft;
  current: boolean;
  onChange: () => void;
  onReview: () => void;
}) {
  return (
    <div data-component="DraftCard" class="mk-dispatch__draft">
      <div data-slot="header" class="mk-dispatch__draft-head">
        <Sigil pattern={props.draft.sigil.pattern} color={props.draft.sigil.color} size={40} />
        <span>
          <strong>
            {props.draft.name}
            <em class="mk-setup__chip mk-setup__chip--accent">{t("dispatch.draft.badge")}</em>
          </strong>
          <small>{props.draft.role}</small>
        </span>
      </div>
      <dl data-slot="body">
        <div>
          <dt>{t("dispatch.draft.engine")}</dt>
          <dd>
            {[props.draft.engine ? engineName(props.draft.engine) : null, props.draft.model]
              .filter(Boolean)
              .join(" · ") || t("dispatch.draft.engineDefault")}
          </dd>
        </div>
        <div>
          <dt>{t("dispatch.draft.access")}</dt>
          <dd>{t(`access.${props.draft.access}.name`)}</dd>
        </div>
        <div>
          <dt>{t("dispatch.draft.round")}</dt>
          <dd>{props.draft.round?.label ?? t("dispatch.draft.noRound")}</dd>
        </div>
      </dl>
      <Show when={props.current}>
        <p class="mk-quiet">{t("dispatch.draft.note")}</p>
        <div data-slot="actions" class="mk-setup__actions">
          <button type="button" class="mk-button mk-button--ghost" onClick={props.onChange}>
            <Icon name="pencil" size={14} />
            {t("dispatch.draft.change")}
          </button>
          <span class="mk-setup__space" />
          <button type="button" class="mk-button mk-button--primary" onClick={props.onReview}>
            <Icon name="arrowRight" size={14} />
            {t("dispatch.draft.review")}
          </button>
        </div>
      </Show>
    </div>
  );
}
