import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import { SetupActions, SetupNotice, SetupPanel, SetupStage } from "./SetupStage";
import {
  ENGINES,
  type EngineId,
  type EngineState,
  type EngineStatus,
  engineName,
  type InstallResult,
  type SetupClient,
} from "./setup-client";

type InstallFailure = Extract<InstallResult, { ok: false }>;

interface EnginesStepProps {
  client: SetupClient;
  onBack: () => void;
  onNext: (ready: EngineId[]) => void;
  onGetHelp?: () => void;
  /** How often the engines are checked again, in milliseconds. */
  pollMs?: number;
}

const CHECKING = (id: EngineId): EngineStatus => ({
  id,
  state: "checking",
  version: null,
  email: null,
  message: null,
});

const CHIP: Record<EngineState, { label: MessageKey; tone: string }> = {
  checking: { label: "setup.engines.checking", tone: "neutral" },
  "not-installed": { label: "setup.engines.notInstalled", tone: "neutral" },
  installing: { label: "setup.engines.installing", tone: "info" },
  "sign-in-required": { label: "setup.engines.notSignedIn", tone: "warn" },
  "signing-in": { label: "setup.engines.waiting", tone: "info" },
  ready: { label: "setup.engines.ready", tone: "accent" },
  outdated: { label: "setup.engines.outdated", tone: "warn" },
  error: { label: "setup.engines.problem", tone: "danger" },
};

const INSTALL_REASON: Partial<Record<InstallFailure["reason"], MessageKey>> = {
  offline: "setup.engines.installFailed.offline",
  permission: "setup.engines.installFailed.permission",
  "missing-tool": "setup.engines.installFailed.missingTool",
};

/**
 * Step 2: every engine shows where it stands and the one thing to do next.
 * Installing, signing in and waiting all happen here, and each failure offers another way.
 */
export function EnginesStep(props: EnginesStepProps) {
  const [statuses, setStatuses] = createSignal<EngineStatus[]>(ENGINES.map(CHECKING));
  const [statusFailed, setStatusFailed] = createSignal(false);
  const [working, setWorking] = createSignal<
    Partial<Record<EngineId, "installing" | "signing-in">>
  >({});
  const [installFailures, setInstallFailures] = createSignal<
    Partial<Record<EngineId, InstallFailure>>
  >({});
  const [slowSignIns, setSlowSignIns] = createSignal<Partial<Record<EngineId, string>>>({});
  const [commands, setCommands] = createSignal<Partial<Record<EngineId, string>>>({});
  const [copied, setCopied] = createSignal<EngineId | null>(null);
  const [locating, setLocating] = createSignal<EngineId | null>(null);
  const [locatePath, setLocatePath] = createSignal("");
  const [locateError, setLocateError] = createSignal("");
  const [locateBusy, setLocateBusy] = createSignal(false);
  let disposed = false;

  /** True once the host has said how the engines stand. */
  const [reported, setReported] = createSignal(false);
  const shown = createMemo<EngineStatus[]>(() =>
    // Until the host answers every engine is being checked; after that, only the engines
    // the host knows are shown, so one it does not know is never left "checking" for ever.
    ENGINES.filter((id) => !reported() || statuses().some((candidate) => candidate.id === id)).map(
      (id) => {
        const status = statuses().find((candidate) => candidate.id === id) ?? CHECKING(id);
        const local = working()[id];
        // A finished sign-in or install shows as soon as the host reports it, even mid-request.
        return local && status.state !== "ready" ? { ...status, state: local } : status;
      },
    ),
  );
  const ready = createMemo(() =>
    shown()
      .filter((status) => status.state === "ready")
      .map((status) => status.id),
  );
  const settled = createMemo(() => shown().every((status) => status.state !== "checking"));

  async function refresh(): Promise<void> {
    try {
      const next = await props.client.engineStatus();
      if (disposed) return;
      setStatuses(next);
      setReported(true);
      setStatusFailed(false);
    } catch {
      if (!disposed) setStatusFailed(true);
    }
  }

  onMount(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), props.pollMs ?? 2500);
    onCleanup(() => {
      disposed = true;
      window.clearInterval(timer);
    });
  });

  const setFor = <T,>(
    setter: (
      update: (current: Partial<Record<EngineId, T>>) => Partial<Record<EngineId, T>>,
    ) => void,
    engine: EngineId,
    value: T | undefined,
  ) =>
    setter((current) => {
      const next = { ...current };
      if (value === undefined) delete next[engine];
      else next[engine] = value;
      return next;
    });

  async function install(engine: EngineId): Promise<void> {
    setFor(setInstallFailures, engine, undefined);
    setFor(setWorking, engine, "installing");
    let result: InstallResult;
    try {
      result = await props.client.installEngine(engine);
    } catch (error) {
      result = { ok: false, reason: "failed", message: messageOf(error) };
    }
    if (disposed) return;
    setFor(setWorking, engine, undefined);
    if (!result.ok && result.reason !== "cancelled") {
      setFor(setInstallFailures, engine, result);
      void loadCommand(engine, "install");
    }
    await refresh();
  }

  async function cancelInstall(engine: EngineId): Promise<void> {
    await props.client.cancelInstall(engine).catch(() => undefined);
  }

  async function signIn(engine: EngineId): Promise<void> {
    setFor(setSlowSignIns, engine, undefined);
    setFor(setWorking, engine, "signing-in");
    let message: string | null = null;
    try {
      const result = await props.client.signIn(engine);
      if (!result.ok) message = result.message;
    } catch (error) {
      message = messageOf(error);
    }
    if (disposed) return;
    setFor(setWorking, engine, undefined);
    if (message !== null) {
      setFor(setSlowSignIns, engine, message);
      void loadCommand(engine, "sign-in");
    }
    await refresh();
  }

  async function loadCommand(engine: EngineId, kind: "install" | "sign-in"): Promise<void> {
    try {
      const command =
        kind === "install"
          ? await props.client.installCommand(engine)
          : await props.client.signInCommand(engine);
      if (!disposed) setFor(setCommands, engine, command);
    } catch {
      // Without the command the other ways forward still work.
    }
  }

  async function copyCommand(engine: EngineId): Promise<void> {
    const command = commands()[engine];
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(engine);
      window.setTimeout(() => setCopied((current) => (current === engine ? null : current)), 2000);
    } catch {
      // The command is also shown as text, so it can be selected by hand.
    }
  }

  function openLocate(engine: EngineId): void {
    setLocating(engine);
    setLocatePath("");
    setLocateError("");
  }

  async function submitLocate(event: Event): Promise<void> {
    event.preventDefault();
    const engine = locating();
    const path = locatePath().trim();
    if (!engine || !path || locateBusy()) return;
    setLocateBusy(true);
    setLocateError("");
    try {
      const result = await props.client.locateEngine(engine, path);
      if (result.ok) {
        setLocating(null);
        setFor(setInstallFailures, engine, undefined);
        await refresh();
      } else {
        setLocateError(result.message);
      }
    } catch (error) {
      setLocateError(messageOf(error));
    } finally {
      setLocateBusy(false);
    }
  }

  const detail = (status: EngineStatus): string => {
    const name = engineName(status.id);
    switch (status.state) {
      case "ready":
        return [
          status.version ? t("setup.engines.version", { version: status.version }) : null,
          status.email,
        ]
          .filter(Boolean)
          .join(" · ");
      case "not-installed":
        return t("setup.engines.detail.notInstalled");
      case "installing":
        return t("setup.engines.detail.installing");
      case "sign-in-required":
        return t("setup.engines.detail.signIn", { engine: name });
      case "signing-in":
        return t("setup.engines.detail.waiting");
      case "checking":
        return t("setup.engines.checking");
      default:
        return status.message ?? "";
    }
  };

  return (
    <SetupStage step="engines" label="setup.engines.label">
      <SetupPanel title={t("setup.engines.title")} body={t("setup.engines.body")}>
        <ul data-slot="engines" class="mk-setup__engines">
          <For each={shown()}>
            {(status) => {
              const name = () => engineName(status.id);
              const failure = () => installFailures()[status.id];
              const slow = () => slowSignIns()[status.id];
              return (
                <li data-component="EngineRow" data-engine={status.id} data-state={status.state}>
                  <div data-slot="summary" class="mk-setup__engine">
                    <span class="mk-setup__engine-mark" aria-hidden="true">
                      <Icon name="terminal" size={16} />
                    </span>
                    <span data-slot="name" class="mk-setup__engine-copy">
                      <strong>{name()}</strong>
                      <small>{detail(status)}</small>
                    </span>
                    <span class={`mk-setup__chip mk-setup__chip--${CHIP[status.state].tone}`}>
                      {t(CHIP[status.state].label)}
                    </span>
                    <Switch>
                      <Match when={status.state === "not-installed"}>
                        <button
                          type="button"
                          class="mk-button mk-button--small"
                          onClick={() => void install(status.id)}
                        >
                          <Icon name="download" size={12} />
                          {t("setup.engines.install")}
                        </button>
                      </Match>
                      <Match when={status.state === "outdated"}>
                        <button
                          type="button"
                          class="mk-button mk-button--small"
                          onClick={() => void install(status.id)}
                        >
                          <Icon name="download" size={12} />
                          {t("setup.engines.update")}
                        </button>
                      </Match>
                      <Match when={status.state === "installing"}>
                        <button
                          type="button"
                          class="mk-button mk-button--ghost mk-button--small"
                          onClick={() => void cancelInstall(status.id)}
                        >
                          {t("setup.engines.cancel")}
                        </button>
                      </Match>
                      <Match when={status.state === "sign-in-required"}>
                        <button
                          type="button"
                          class="mk-button mk-button--primary mk-button--small"
                          onClick={() => void signIn(status.id)}
                        >
                          {t("setup.engines.signIn")}
                        </button>
                      </Match>
                      <Match when={status.state === "signing-in"}>
                        <button
                          type="button"
                          class="mk-button mk-button--ghost mk-button--small"
                          onClick={() => void signIn(status.id)}
                        >
                          <Icon name="external" size={12} />
                          {t("setup.engines.openLoginAgain")}
                        </button>
                      </Match>
                      <Match when={status.state === "error"}>
                        <button
                          type="button"
                          class="mk-button mk-button--small"
                          onClick={() => void refresh()}
                        >
                          <Icon name="refresh" size={12} />
                          {t("setup.engines.retry")}
                        </button>
                      </Match>
                    </Switch>
                  </div>

                  <Show when={failure()}>
                    {(failed) => (
                      <SetupNotice
                        tone="danger"
                        title={t("setup.engines.installFailed.title", { engine: name() })}
                        body={`${reasonText(failed())} ${t("setup.engines.installFailed.body")}`}
                      >
                        <button
                          type="button"
                          class="mk-button mk-button--primary mk-button--small"
                          onClick={() => void install(status.id)}
                        >
                          <Icon name="refresh" size={12} />
                          {t("setup.engines.retry")}
                        </button>
                        <Show when={commands()[status.id]}>
                          <button
                            type="button"
                            class="mk-button mk-button--small"
                            onClick={() => void copyCommand(status.id)}
                          >
                            <Icon name="terminal" size={12} />
                            {copied() === status.id
                              ? t("setup.engines.copied")
                              : t("setup.engines.copyInstall")}
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="mk-button mk-button--small"
                          onClick={() => openLocate(status.id)}
                        >
                          <Icon name="folder" size={12} />
                          {t("setup.engines.locate")}
                        </button>
                        <Show when={commands()[status.id]}>
                          <code data-slot="command" class="mk-setup__command">
                            {commands()[status.id]}
                          </code>
                        </Show>
                      </SetupNotice>
                    )}
                  </Show>

                  <Show when={slow() !== undefined && status.state !== "ready"}>
                    <SetupNotice
                      tone="warn"
                      title={t("setup.engines.signInSlow.title", { engine: name() })}
                      body={t("setup.engines.signInSlow.body", { engine: name() })}
                    >
                      <button
                        type="button"
                        class="mk-button mk-button--primary mk-button--small"
                        onClick={() => void signIn(status.id)}
                      >
                        <Icon name="external" size={12} />
                        {t("setup.engines.openLoginAgain")}
                      </button>
                      <Show when={commands()[status.id]}>
                        <button
                          type="button"
                          class="mk-button mk-button--small"
                          onClick={() => void copyCommand(status.id)}
                        >
                          <Icon name="terminal" size={12} />
                          {copied() === status.id
                            ? t("setup.engines.copied")
                            : t("setup.engines.signInTerminal")}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="mk-button mk-button--ghost mk-button--small"
                        onClick={() => setFor(setSlowSignIns, status.id, undefined)}
                      >
                        {t("setup.engines.skip", { engine: name() })}
                      </button>
                      <Show when={commands()[status.id]}>
                        <code data-slot="command" class="mk-setup__command">
                          {commands()[status.id]}
                        </code>
                      </Show>
                    </SetupNotice>
                  </Show>

                  <Show when={locating() === status.id}>
                    <form
                      data-slot="locate"
                      class="mk-setup__locate"
                      onSubmit={(event) => void submitLocate(event)}
                    >
                      <strong>{t("setup.engines.locate.title", { engine: name() })}</strong>
                      <p class="mk-quiet">{t("setup.engines.locate.body", { engine: name() })}</p>
                      <label class="mk-field">
                        <span>{t("setup.engines.locate.path")}</span>
                        <input
                          class="mk-input mk-input--mono"
                          value={locatePath()}
                          onInput={(event) => setLocatePath(event.currentTarget.value)}
                          autofocus
                        />
                      </label>
                      <Show when={locateError()}>
                        <p class="mk-form-error" role="alert">
                          {locateError()}
                        </p>
                      </Show>
                      <div class="mk-setup__notice-actions">
                        <button
                          type="submit"
                          class="mk-button mk-button--primary mk-button--small"
                          disabled={!locatePath().trim() || locateBusy()}
                        >
                          {locateBusy()
                            ? t("setup.engines.locate.checking")
                            : t("setup.engines.locate.use")}
                        </button>
                        <button
                          type="button"
                          class="mk-button mk-button--ghost mk-button--small"
                          onClick={() => setLocating(null)}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>

        <Switch>
          <Match when={statusFailed()}>
            <SetupNotice
              tone="danger"
              title={t("setup.engines.statusFailed.title")}
              body={t("setup.engines.statusFailed.body")}
            />
          </Match>
          <Match when={ready().length === 0 && settled()}>
            <SetupNotice
              tone="warn"
              title={t("setup.engines.none.title")}
              body={t("setup.engines.none.body")}
            >
              <Show when={props.onGetHelp}>
                <button
                  type="button"
                  class="mk-button mk-button--ghost mk-button--small"
                  onClick={props.onGetHelp}
                >
                  <Icon name="external" size={12} />
                  {t("setup.engines.getHelp")}
                </button>
              </Show>
            </SetupNotice>
          </Match>
          <Match when={ready().length < ENGINES.length}>
            <SetupNotice
              tone="info"
              title={t("setup.engines.one.title")}
              body={t("setup.engines.one.body")}
            />
          </Match>
        </Switch>

        <SetupActions
          onBack={props.onBack}
          onNext={() => props.onNext(ready())}
          nextDisabled={ready().length === 0}
          aside={
            <button type="button" class="mk-button mk-button--ghost" onClick={() => void refresh()}>
              <Icon name="refresh" size={14} />
              {t("setup.engines.checkAgain")}
            </button>
          }
        />
      </SetupPanel>
    </SetupStage>
  );
}

function reasonText(failure: InstallFailure): string {
  const key = INSTALL_REASON[failure.reason];
  return key ? t(key) : failure.message;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
