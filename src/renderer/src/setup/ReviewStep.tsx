import { createSignal, For, Match, Show, Switch } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { ACCESS_LEVELS } from "../../../shared/access";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import { SIGIL_COLORS, SIGIL_PATTERN_COUNT, Sigil } from "../ui/Sigil";
import type { BotDraft, BotsClient, CreateResult } from "./bots-client";
import { SetupNotice, SetupStage } from "./SetupStage";
import { engineName } from "./setup-client";

export type DraftSource = "dispatch" | "ready" | "file" | "form";

interface ReviewStepProps {
  client: BotsClient;
  draft: BotDraft;
  source: DraftSource;
  onBack: () => void;
  /** The bot exists. `openChat` asks to land in its conversation. */
  onDone: (botId: string) => void;
}

const SOURCE_LABEL: Record<DraftSource, MessageKey> = {
  dispatch: "review.from.dispatch",
  ready: "review.from.ready",
  file: "review.from.file",
  form: "review.from.form",
};

type Problem =
  | { kind: "folder"; folder: string; suggested: string }
  | { kind: "failed"; message: string }
  | { kind: "test"; botId: string; message: string };

/** Step 7: everything about the bot on one screen, changeable, before anything is created. */
export function ReviewStep(props: ReviewStepProps) {
  const [draft, setDraft] = createStore<BotDraft>(structuredClone(props.draft));
  const [busy, setBusy] = createSignal<"creating" | "testing" | null>(null);
  const [problem, setProblem] = createSignal<Problem | null>(null);
  const [asked, setAsked] = createSignal(false);

  const name = () => draft.name.trim();
  const complete = () => name() !== "" && draft.instructions.trim() !== "";

  function handle(result: CreateResult): void {
    if (result.ok) {
      if (result.testRun.state === "failed") {
        setProblem({ kind: "test", botId: result.botId, message: result.testRun.message });
      } else {
        props.onDone(result.botId);
      }
    } else if (result.reason === "folder-in-use") {
      setProblem({ kind: "folder", folder: result.folder, suggested: result.suggestedFolder });
    } else {
      setProblem({ kind: "failed", message: result.message });
    }
  }

  async function create(options?: { adoptExistingFolder?: boolean }): Promise<void> {
    if (busy()) return;
    if (!complete()) {
      setAsked(true);
      return;
    }
    setBusy("creating");
    setProblem(null);
    try {
      handle(
        await props.client.create(structuredClone({ ...unwrap(draft), name: name() }), options),
      );
    } catch (error) {
      setProblem({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  async function runAgain(botId: string): Promise<void> {
    if (busy()) return;
    setBusy("testing");
    try {
      const result = await props.client.runTest(botId);
      if (result.state === "passed") props.onDone(botId);
      else setProblem({ kind: "test", botId, message: result.message });
    } catch (error) {
      setProblem({
        kind: "test",
        botId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SetupStage step="review" label="review.label" width={1000}>
      <div data-component="BotReview" class="mk-review">
        <div data-slot="who" class="mk-review__column">
          <div data-slot="header" class="mk-review__head">
            <Sigil pattern={draft.sigil.pattern} color={draft.sigil.color} size={56} />
            <span>
              <h1>{name() || t("review.create.unnamed")}</h1>
              <small>{t(SOURCE_LABEL[props.source])}</small>
            </span>
          </div>

          <label class="mk-field">
            <span>{t("review.name")}</span>
            <input
              class="mk-input"
              value={draft.name}
              placeholder={t("review.name.placeholder")}
              maxLength={40}
              onInput={(event) => setDraft("name", event.currentTarget.value)}
            />
          </label>

          <fieldset class="mk-review__sigil" aria-label={t("review.sigil")}>
            <legend>{t("review.sigil")}</legend>
            <div data-slot="patterns">
              <For each={Array.from({ length: SIGIL_PATTERN_COUNT }, (_, index) => index)}>
                {(pattern) => (
                  <button
                    type="button"
                    aria-label={t("review.sigil.pattern", { number: pattern + 1 })}
                    aria-pressed={draft.sigil.pattern === pattern}
                    classList={{ "is-on": draft.sigil.pattern === pattern }}
                    onClick={() => setDraft("sigil", "pattern", pattern)}
                  >
                    <Sigil pattern={pattern} color={draft.sigil.color} size={32} />
                  </button>
                )}
              </For>
            </div>
            <div data-slot="colours">
              <For each={SIGIL_COLORS}>
                {(color) => (
                  <button
                    type="button"
                    aria-label={color}
                    aria-pressed={draft.sigil.color === color}
                    classList={{ "mk-review__colour": true, "is-on": draft.sigil.color === color }}
                    style={{ background: `var(--mk-sigil-${color})` }}
                    onClick={() => setDraft("sigil", "color", color)}
                  />
                )}
              </For>
            </div>
          </fieldset>

          <label class="mk-field">
            <span>{t("review.role")}</span>
            <input
              class="mk-input"
              value={draft.role}
              placeholder={t("review.role.placeholder")}
              maxLength={120}
              onInput={(event) => setDraft("role", event.currentTarget.value)}
            />
          </label>

          <label class="mk-field">
            <span>{t("review.instructions")}</span>
            <textarea
              class="mk-input mk-review__instructions"
              value={draft.instructions}
              placeholder={t("review.instructions.placeholder")}
              onInput={(event) => setDraft("instructions", event.currentTarget.value)}
            />
          </label>

          <label class="mk-field">
            <span>{t("review.folder")}</span>
            <input
              class="mk-input mk-input--mono"
              value={draft.folder}
              placeholder={t("review.folder.default")}
              onInput={(event) => setDraft("folder", event.currentTarget.value)}
            />
          </label>
        </div>

        <div data-slot="rules" class="mk-review__column">
          <fieldset class="mk-review__access" aria-label={t("review.access")}>
            <legend>{t("review.access")}</legend>
            <For each={ACCESS_LEVELS}>
              {(level) => (
                <label classList={{ "mk-setup__choice": true, "is-on": draft.access === level }}>
                  <input
                    type="radio"
                    name="markas-review-access"
                    checked={draft.access === level}
                    onChange={() => setDraft("access", level)}
                  />
                  <span>
                    <strong>{t(`access.${level}.name`)}</strong>
                    <small>{t(`access.${level}.body`)}</small>
                  </span>
                </label>
              )}
            </For>
            <Show when={props.source !== "form"}>
              <p class="mk-quiet">{t("review.access.fromFile")}</p>
            </Show>
          </fieldset>

          <Show when={draft.round} fallback={<p class="mk-quiet">{t("review.round.none")}</p>}>
            {(round) => (
              <label data-slot="round" class="mk-review__round">
                <Icon name="routine" size={16} />
                <span>
                  <strong>{round().label}</strong>
                  <small>{t("review.round.body")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={round().enabled}
                  onChange={(event) => setDraft("round", "enabled", event.currentTarget.checked)}
                />
              </label>
            )}
          </Show>

          <p class="mk-quiet">
            {draft.model
              ? t("review.runsOn.model", {
                  engine: draft.engine ? engineName(draft.engine) : t("setup.model.engineDefault"),
                  model: draft.model,
                })
              : draft.engine
                ? t("review.runsOn", { engine: engineName(draft.engine) })
                : t("review.runsOn.default")}
          </p>
        </div>
      </div>

      <Show when={asked() && !complete()}>
        <SetupNotice tone="info" title={t("review.needName")} />
      </Show>

      <Show when={problem()}>
        {(current) => (
          <Switch>
            <Match
              when={current().kind === "folder" && (current() as Problem & { kind: "folder" })}
            >
              {(found) => (
                <SetupNotice
                  tone="warn"
                  title={t("review.folderInUse.title", { folder: found().folder })}
                  body={t("review.folderInUse.body", { name: name() })}
                >
                  <button
                    type="button"
                    class="mk-button mk-button--primary mk-button--small"
                    onClick={() => {
                      setDraft("folder", found().suggested);
                      void create();
                    }}
                  >
                    {t("review.folderInUse.useSuggested", { folder: found().suggested })}
                  </button>
                  <button
                    type="button"
                    class="mk-button mk-button--ghost mk-button--small"
                    onClick={() => void create({ adoptExistingFolder: true })}
                  >
                    {t("review.folderInUse.adopt")}
                  </button>
                </SetupNotice>
              )}
            </Match>
            <Match
              when={current().kind === "failed" && (current() as Problem & { kind: "failed" })}
            >
              {(found) => (
                <SetupNotice
                  tone="danger"
                  title={t("review.failed.title", { name: name() })}
                  body={`${found().message} ${t("review.failed.body")}`}
                >
                  <button
                    type="button"
                    class="mk-button mk-button--primary mk-button--small"
                    onClick={() => void create()}
                  >
                    <Icon name="refresh" size={12} />
                    {t("setup.engines.retry")}
                  </button>
                </SetupNotice>
              )}
            </Match>
            <Match when={current().kind === "test" && (current() as Problem & { kind: "test" })}>
              {(found) => (
                <SetupNotice
                  tone="danger"
                  title={t("review.testFailed.title", { name: name() })}
                  body={`${found().message} ${t("review.testFailed.body")}`}
                >
                  <button
                    type="button"
                    class="mk-button mk-button--primary mk-button--small"
                    onClick={() => props.onDone(found().botId)}
                  >
                    {t("review.testFailed.open", { name: name() })}
                  </button>
                  <button
                    type="button"
                    class="mk-button mk-button--small"
                    disabled={busy() !== null}
                    onClick={() => void runAgain(found().botId)}
                  >
                    <Icon name="refresh" size={12} />
                    {t("review.testFailed.again")}
                  </button>
                  <button
                    type="button"
                    class="mk-button mk-button--ghost mk-button--small"
                    onClick={() => props.onDone(found().botId)}
                  >
                    {t("review.testFailed.skip")}
                  </button>
                </SetupNotice>
              )}
            </Match>
          </Switch>
        )}
      </Show>

      <div data-slot="actions" class="mk-setup__actions">
        <button
          type="button"
          class="mk-button mk-button--ghost"
          disabled={busy() !== null || problem()?.kind === "test"}
          onClick={props.onBack}
        >
          <Icon name="chevronLeft" size={14} />
          {t("setup.back")}
        </button>
        <span class="mk-setup__space" />
        <span class="mk-quiet">
          {busy() === "testing" ? t("review.testing", { name: name() }) : t("review.later")}
        </span>
        <Show when={problem()?.kind !== "test"}>
          <button
            type="button"
            class="mk-button mk-button--primary"
            disabled={busy() !== null}
            onClick={() => void create()}
          >
            <Icon name="arrowRight" size={14} />
            {busy() === "creating"
              ? t("review.creating")
              : name()
                ? t("review.create", { name: name() })
                : t("review.create.unnamed")}
          </button>
        </Show>
      </div>
    </SetupStage>
  );
}
