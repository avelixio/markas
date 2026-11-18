import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { SetupEngineStatus, SetupInstallResult, SetupSignInState } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { engineName } from "../setup/setup-client";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";

/** A model server on this computer, as the host found it. */
interface LocalServer {
  id: string;
  name: string;
  address: string;
  running: boolean;
  models: string[];
  connected: boolean;
}

interface SignInQuestion {
  key: string;
  message: string;
  kind: "text" | "select";
  options: Array<{ label: string; value: string }>;
  placeholder: string | null;
  when: { key: string; value: string } | null;
}

interface SignInMethod {
  index: number;
  kind: "browser" | "key";
  label: string;
  questions: SignInQuestion[];
}

interface OpenCodeProvider {
  id: string;
  name: string;
  connected: boolean;
  models: number;
  methods: SignInMethod[];
}

const ENGINE_ICONS: Record<string, IconName> = {
  claude: "sparkle",
  codex: "terminal",
  opencode: "panel",
};

/** How often an engine is looked at again while the person signs in to it. */
const SIGN_IN_POLL_MS = 3_000;
/** How many OpenCode providers are shown before a search narrows them. */
const SHOWN_PROVIDERS = 12;
/**
 * Providers most people mean, shown right after the connected ones before any search.
 * The order is only a convenience: every provider OpenCode knows is reached by search.
 */
const COMMON_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "github-copilot",
  "deepseek",
  "mistral",
  "groq",
  "xai",
  "amazon-bedrock",
  "azure",
  "ollama",
];

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The parts of a provider row: its mark, what it is, what was found, how it stands, one action. */
function ProviderRow(props: {
  name: string;
  detail: string;
  icon: IconName;
  detected: boolean;
  state: "connected" | "waiting" | "not-connected" | "not-found";
  children?: unknown;
  open?: boolean;
}) {
  const stateLabel = () => t(`providers.state.${props.state}`);
  return (
    <article
      data-component="ProviderRow"
      classList={{ "mk-provider": true, "is-open": props.open === true }}
    >
      <div data-slot="summary" class="mk-provider__summary">
        <span class="mk-provider__mark" aria-hidden="true">
          <Icon name={props.icon} size={16} />
        </span>
        <span data-slot="text" class="mk-provider__text">
          <strong>{props.name}</strong>
          <small>{props.detail}</small>
        </span>
        <Show when={props.detected}>
          <span data-slot="detected" class="mk-chip mk-chip--info">
            <Icon name="check" size={12} />
            {t("providers.detected")}
          </span>
        </Show>
        <span
          data-slot="state"
          classList={{
            "mk-chip": true,
            "mk-chip--accent": props.state === "connected",
            "mk-chip--warn": props.state === "waiting",
          }}
        >
          {stateLabel()}
        </span>
        {props.children as never}
      </div>
    </article>
  );
}

/** One engine: Detected when its program is on this computer, then Connect. */
function EngineRow(props: { engine: SetupEngineStatus; onChanged: () => void }) {
  const [waiting, setWaiting] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  let timer: number | undefined;
  onCleanup(() => window.clearInterval(timer));

  const detected = () => props.engine.state !== "not-installed";
  const connected = () => props.engine.state === "signed-in";
  const detail = () => {
    const engine = props.engine;
    if (engine.state === "not-installed") return t("providers.engine.notInstalled");
    if (engine.state === "signed-in") {
      return engine.email
        ? t("providers.engine.signedInAs", { version: engine.version ?? "", email: engine.email })
        : t("providers.engine.ready", { version: engine.version ?? "" });
    }
    return engine.message ?? t("providers.engine.found", { version: engine.version ?? "" });
  };

  async function connect(): Promise<void> {
    setProblem(null);
    try {
      const started = await callHost<SetupSignInState>("setup.signIn", props.engine.engine);
      if (started.state === "signed-in") return props.onChanged();
      if (started.state !== "waiting") {
        setProblem(started.message ?? t("providers.connect.failed"));
        return;
      }
      setWaiting(true);
      // The engine's own sign-in opened in the browser; look until it says it is signed in.
      timer = window.setInterval(() => {
        void callHost<SetupEngineStatus[]>("setup.engineStatus").then((statuses) => {
          const now = statuses.find((status) => status.engine === props.engine.engine);
          if (now?.state === "signed-in") {
            window.clearInterval(timer);
            setWaiting(false);
            props.onChanged();
          }
        });
      }, SIGN_IN_POLL_MS);
    } catch (error) {
      setProblem(describe(error));
    }
  }

  /** Installs the engine with its maker's own installer, then looks at it again. */
  async function install(): Promise<void> {
    setProblem(null);
    setInstalling(true);
    try {
      const result = await callHost<SetupInstallResult>("setup.installEngine", props.engine.engine);
      if (result.result === "failed") setProblem(result.message);
      else props.onChanged();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setInstalling(false);
    }
  }

  async function cancel(): Promise<void> {
    window.clearInterval(timer);
    setWaiting(false);
    await callHost("setup.cancelSignIn", props.engine.engine).catch(() => undefined);
  }

  return (
    <ProviderRow
      name={engineName(props.engine.engine)}
      detail={detail()}
      icon={ENGINE_ICONS[props.engine.engine] ?? "sliders"}
      detected={detected()}
      state={
        connected()
          ? "connected"
          : waiting()
            ? "waiting"
            : detected()
              ? "not-connected"
              : "not-found"
      }
    >
      <Show when={!detected()}>
        <button
          type="button"
          data-slot="install"
          class="mk-button mk-button--small"
          aria-label={t("providers.install.label", { name: engineName(props.engine.engine) })}
          aria-busy={installing()}
          disabled={installing()}
          onClick={() => void install()}
        >
          {installing() ? t("providers.installing") : t("providers.install")}
        </button>
      </Show>
      <Show when={!connected() && detected()}>
        <Show
          when={waiting()}
          fallback={
            <button
              type="button"
              data-slot="connect"
              class="mk-button mk-button--primary mk-button--small"
              aria-label={t("providers.connect.label", { name: engineName(props.engine.engine) })}
              onClick={() => void connect()}
            >
              {t("providers.connect")}
            </button>
          }
        >
          <button
            type="button"
            class="mk-button mk-button--ghost mk-button--small"
            onClick={() => void cancel()}
          >
            {t("providers.cancel")}
          </button>
        </Show>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <span class="mk-form-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </ProviderRow>
  );
}

/** A model server on this computer: Detected when it answered, then Connect. */
function LocalServerRow(props: { server: LocalServer; onChanged: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const host = () => props.server.address.replace(/^https?:\/\//, "");

  async function act(kind: "connect" | "disconnect"): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await callHost(`providers.local.${kind}`, { id: props.server.id });
      props.onChanged();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProviderRow
      name={props.server.name}
      detail={
        props.server.running
          ? t("providers.local.running", { address: host(), count: props.server.models.length })
          : t("providers.local.notRunning", { address: host() })
      }
      icon="activity"
      detected={props.server.running}
      state={
        props.server.connected ? "connected" : props.server.running ? "not-connected" : "not-found"
      }
    >
      <Show when={props.server.connected}>
        <button
          type="button"
          class="mk-button mk-button--ghost mk-button--small"
          disabled={busy()}
          onClick={() => void act("disconnect")}
        >
          {t("providers.disconnect")}
        </button>
      </Show>
      <Show when={!props.server.connected && props.server.running}>
        <button
          type="button"
          data-slot="connect"
          class="mk-button mk-button--primary mk-button--small"
          aria-label={t("providers.connect.label", { name: props.server.name })}
          aria-busy={busy()}
          disabled={busy()}
          onClick={() => void act("connect")}
        >
          {busy() ? t("providers.connecting") : t("providers.connect")}
        </button>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <span class="mk-form-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </ProviderRow>
  );
}

type SignInStep =
  | { kind: "choose" }
  | { kind: "questions"; method: SignInMethod; answers: Record<string, string> }
  | { kind: "key"; method: SignInMethod }
  | { kind: "browser"; method: SignInMethod; url: string; finish: "wait" | "code" };

/** A provider through OpenCode: Connect opens the ways in, and Markas waits for the one chosen. */
function OpenCodeProviderRow(props: { provider: OpenCodeProvider; onChanged: () => void }) {
  const [step, setStep] = createSignal<SignInStep | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [value, setValue] = createSignal("");
  const [showKey, setShowKey] = createSignal(false);
  let cancelled = false;

  const detail = () =>
    props.provider.connected
      ? t("providers.openCode.models", { count: props.provider.models })
      : t("providers.openCode.noModels");

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  };

  function choose(method: SignInMethod): void {
    setValue("");
    if (method.kind === "key") return void setStep({ kind: "key", method });
    if (method.questions.length > 0) {
      const answers: Record<string, string> = {};
      for (const question of method.questions) {
        if (question.kind === "select" && question.options[0]) {
          answers[question.key] = question.options[0].value;
        }
      }
      return void setStep({ kind: "questions", method, answers });
    }
    void startBrowser(method, {});
  }

  function startBrowser(method: SignInMethod, answers: Record<string, string>) {
    cancelled = false;
    return run(async () => {
      const started = await callHost<{ url: string; finish: "wait" | "code" }>(
        "providers.openCode.startSignIn",
        { providerId: props.provider.id, method: method.index, answers },
      );
      window.open(started.url, "_blank", "noopener,noreferrer");
      setStep({ kind: "browser", method, url: started.url, finish: started.finish });
      if (started.finish === "wait") await finish(method);
    });
  }

  async function finish(method: SignInMethod, code?: string): Promise<void> {
    const done = await callHost<{ connected: boolean }>("providers.openCode.finishSignIn", {
      providerId: props.provider.id,
      method: method.index,
      ...(code ? { code } : {}),
    });
    if (cancelled) return;
    if (!done.connected) throw new Error(t("providers.connect.failed"));
    setStep(null);
    props.onChanged();
  }

  const saveKey = (method: SignInMethod) =>
    run(async () => {
      await callHost("providers.openCode.saveKey", {
        providerId: props.provider.id,
        key: value(),
      });
      setValue("");
      setStep(null);
      props.onChanged();
      void method;
    });

  const disconnect = () =>
    run(async () => {
      await callHost("providers.openCode.disconnect", { providerId: props.provider.id });
      props.onChanged();
    });

  const close = () => {
    // A wait for the browser is called off in the host too, so nothing keeps waiting there.
    if (step()?.kind === "browser") {
      void callHost("providers.openCode.cancelSignIn", { providerId: props.provider.id }).catch(
        () => undefined,
      );
    }
    cancelled = true;
    setStep(null);
    setValue("");
    setProblem(null);
  };

  const visibleQuestions = (current: Extract<SignInStep, { kind: "questions" }>) =>
    current.method.questions.filter(
      (question) => !question.when || current.answers[question.when.key] === question.when.value,
    );

  return (
    <div data-component="OpenCodeProviderRow" class="mk-provider-wrap">
      <ProviderRow
        name={props.provider.name}
        detail={detail()}
        icon="globe"
        detected={false}
        open={step() !== null}
        state={
          props.provider.connected
            ? "connected"
            : step()?.kind === "browser"
              ? "waiting"
              : "not-connected"
        }
      >
        <Show
          when={step() === null}
          fallback={
            <button
              type="button"
              class="mk-button mk-button--ghost mk-button--small"
              onClick={close}
            >
              {t("providers.cancel")}
            </button>
          }
        >
          <Show
            when={props.provider.connected}
            fallback={
              <button
                type="button"
                data-slot="connect"
                class="mk-button mk-button--small"
                aria-label={t("providers.connect.label", { name: props.provider.name })}
                onClick={() => setStep({ kind: "choose" })}
              >
                {t("providers.connect")}
              </button>
            }
          >
            <button
              type="button"
              class="mk-button mk-button--ghost mk-button--small"
              disabled={busy()}
              aria-label={t("providers.disconnect.label", { name: props.provider.name })}
              onClick={() => void disconnect()}
            >
              {t("providers.disconnect")}
            </button>
          </Show>
        </Show>
      </ProviderRow>

      <Show when={step()}>
        {(current) => (
          <div data-slot="sign-in" class="mk-provider__sign-in">
            <Show when={current().kind === "choose"}>
              <fieldset class="mk-provider__methods">
                <legend class="mk-visually-hidden">{t("providers.methods")}</legend>
                <For each={props.provider.methods}>
                  {(method) => (
                    <button
                      type="button"
                      class="mk-button mk-button--small"
                      disabled={busy()}
                      onClick={() => choose(method)}
                    >
                      <Icon name={method.kind === "key" ? "key" : "external"} size={12} />
                      {method.label}
                    </button>
                  )}
                </For>
              </fieldset>
            </Show>

            <Show
              when={
                current().kind === "questions"
                  ? (current() as Extract<SignInStep, { kind: "questions" }>)
                  : null
              }
            >
              {(asking) => (
                <form
                  class="mk-provider__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void startBrowser(asking().method, asking().answers);
                  }}
                >
                  <For each={visibleQuestions(asking())}>
                    {(question) => (
                      <label class="mk-provider__field">
                        <span>{question.message}</span>
                        <Show
                          when={question.kind === "select"}
                          fallback={
                            <input
                              class="mk-input"
                              placeholder={question.placeholder ?? ""}
                              value={asking().answers[question.key] ?? ""}
                              onInput={(event) =>
                                setStep({
                                  ...asking(),
                                  answers: {
                                    ...asking().answers,
                                    [question.key]: event.currentTarget.value,
                                  },
                                })
                              }
                            />
                          }
                        >
                          <select
                            class="mk-input"
                            value={asking().answers[question.key] ?? ""}
                            onChange={(event) =>
                              setStep({
                                ...asking(),
                                answers: {
                                  ...asking().answers,
                                  [question.key]: event.currentTarget.value,
                                },
                              })
                            }
                          >
                            <For each={question.options}>
                              {(option) => <option value={option.value}>{option.label}</option>}
                            </For>
                          </select>
                        </Show>
                      </label>
                    )}
                  </For>
                  <button
                    type="submit"
                    class="mk-button mk-button--primary mk-button--small"
                    disabled={busy()}
                  >
                    {t("providers.continue")}
                  </button>
                </form>
              )}
            </Show>

            <Show
              when={
                current().kind === "key"
                  ? (current() as Extract<SignInStep, { kind: "key" }>)
                  : null
              }
            >
              {(asking) => (
                <form
                  class="mk-provider__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveKey(asking().method);
                  }}
                >
                  <label class="mk-provider__field">
                    <span>{t("providers.key.label", { name: props.provider.name })}</span>
                    <span class="mk-provider__inline">
                      <input
                        class="mk-input"
                        type={showKey() ? "text" : "password"}
                        spellcheck={false}
                        value={value()}
                        onInput={(event) => setValue(event.currentTarget.value)}
                      />
                      <button
                        type="button"
                        class="mk-button mk-button--ghost mk-button--small"
                        aria-pressed={showKey()}
                        onClick={() => setShowKey(!showKey())}
                      >
                        {showKey() ? t("providers.key.hide") : t("providers.key.show")}
                      </button>
                    </span>
                  </label>
                  <button
                    type="submit"
                    class="mk-button mk-button--primary mk-button--small"
                    aria-busy={busy()}
                    disabled={busy() || !value().trim()}
                  >
                    {busy() ? t("providers.connecting") : t("providers.key.save")}
                  </button>
                </form>
              )}
            </Show>

            <Show
              when={
                current().kind === "browser"
                  ? (current() as Extract<SignInStep, { kind: "browser" }>)
                  : null
              }
            >
              {(signing) => (
                <div class="mk-provider__form">
                  <p class="mk-quiet" role="status">
                    {signing().finish === "wait"
                      ? t("providers.browser.wait")
                      : t("providers.browser.code")}{" "}
                    <a href={signing().url} target="_blank" rel="noopener noreferrer">
                      {t("providers.browser.openAgain")}
                    </a>
                  </p>
                  <Show when={signing().finish === "code"}>
                    <form
                      class="mk-provider__inline"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(() => finish(signing().method, value()));
                      }}
                    >
                      <label class="mk-provider__field">
                        <span>{t("providers.browser.codeLabel")}</span>
                        <input
                          class="mk-input"
                          autocomplete="one-time-code"
                          spellcheck={false}
                          value={value()}
                          onInput={(event) => setValue(event.currentTarget.value)}
                        />
                      </label>
                      <button
                        type="submit"
                        class="mk-button mk-button--primary mk-button--small"
                        disabled={busy() || !value().trim()}
                      >
                        {t("providers.continue")}
                      </button>
                    </form>
                  </Show>
                </div>
              )}
            </Show>

            <p class="mk-quiet mk-provider__note">{t("providers.keptByEngine")}</p>
            <Show when={problem()}>
              {(message) => (
                <p class="mk-form-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * Where the person connects what the bots run on: the engines, model servers found on this
 * computer, and the providers OpenCode can use. Each shows whether it was found, how it stands,
 * and one Connect.
 */
export function ProvidersPanel(props: {
  engines: SetupEngineStatus[];
  onEnginesChanged: () => void;
}) {
  const [local, { refetch: rescan }] = createResource(() =>
    callHost<LocalServer[]>("providers.local.scan"),
  );
  const openCodeReady = () =>
    props.engines.some(
      (engine) => engine.engine === "opencode" && engine.state !== "not-installed",
    );
  const [openCode, { refetch: reloadOpenCode }] = createResource(openCodeReady, (ready) =>
    ready ? callHost<OpenCodeProvider[]>("providers.openCode.list") : Promise.resolve([]),
  );
  const [query, setQuery] = createSignal("");
  /** The providers, or none while they cannot be read: a failed read is shown on its own. */
  const providerList = () => (openCode.error ? [] : (openCode() ?? []));

  const shownProviders = createMemo(() => {
    const all = providerList();
    const words = query().trim().toLowerCase();
    if (words) {
      return all.filter(
        (provider) =>
          provider.name.toLowerCase().includes(words) || provider.id.toLowerCase().includes(words),
      );
    }
    // Before a search, the connected ones, then the common ones; a search reaches all of them.
    const connected = all.filter((provider) => provider.connected);
    const rank = (provider: OpenCodeProvider) => {
      const place = COMMON_PROVIDERS.indexOf(provider.id);
      return place === -1 ? COMMON_PROVIDERS.length : place;
    };
    const rest = all.filter((provider) => !provider.connected).sort((a, b) => rank(a) - rank(b));
    return [...connected, ...rest].slice(0, Math.max(SHOWN_PROVIDERS, connected.length));
  });

  const changed = () => {
    props.onEnginesChanged();
    void rescan();
    void reloadOpenCode();
  };

  return (
    <section data-component="ProvidersPanel" class="mk-providers" aria-label={t("providers.title")}>
      <div data-slot="engines" class="mk-providers__group">
        <h2 class="mk-section-title">{t("switchboard.engines")}</h2>
        <For each={props.engines}>
          {(engine) => <EngineRow engine={engine} onChanged={changed} />}
        </For>
      </div>

      <div data-slot="local" class="mk-providers__group">
        <div class="mk-providers__heading">
          <h2 class="mk-section-title">{t("providers.local.title")}</h2>
          <small class="mk-quiet">{t("providers.local.note")}</small>
          <button
            type="button"
            class="mk-button mk-button--ghost mk-button--small"
            onClick={() => void rescan()}
          >
            <Icon name="refresh" size={12} />
            {t("providers.scanAgain")}
          </button>
        </div>
        <Show
          when={!local.loading}
          fallback={
            <p class="mk-quiet" role="status">
              {t("providers.scanning")}
            </p>
          }
        >
          <For each={local() ?? []}>
            {(server) => <LocalServerRow server={server} onChanged={changed} />}
          </For>
        </Show>
      </div>

      <Show when={openCodeReady()}>
        <div data-slot="opencode" class="mk-providers__group">
          <div class="mk-providers__heading">
            <h2 class="mk-section-title">{t("providers.openCode.title")}</h2>
            <input
              class="mk-input mk-providers__search"
              type="search"
              aria-label={t("providers.openCode.search")}
              placeholder={t("providers.openCode.searchCount", {
                count: providerList().length,
              })}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <Show
            when={!openCode.error}
            fallback={
              <p class="mk-form-error" role="alert">
                {describe(openCode.error)}{" "}
                <button
                  type="button"
                  class="mk-button mk-button--ghost mk-button--small"
                  onClick={() => void reloadOpenCode()}
                >
                  {t("common.retry")}
                </button>
              </p>
            }
          >
            <Show
              when={!openCode.loading}
              fallback={
                <p class="mk-quiet" role="status">
                  {t("providers.openCode.loading")}
                </p>
              }
            >
              <For
                each={shownProviders()}
                fallback={<p class="mk-quiet">{t("providers.openCode.none")}</p>}
              >
                {(provider) => <OpenCodeProviderRow provider={provider} onChanged={changed} />}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  );
}
