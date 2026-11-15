import { createSignal, Match, Show, Switch } from "solid-js";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { type BotDraft, type BotsClient, EMPTY_DRAFT, type ImportResult } from "./bots-client";
import { DispatchStep } from "./DispatchStep";
import { ReadyBotsStep } from "./ReadyBotsStep";
import { type DraftSource, ReviewStep } from "./ReviewStep";
import { SetupNotice } from "./SetupStage";
import "./bots.css";

/** A bot file is text. Anything larger than this is something else. */
export const MAX_BOT_FILE_BYTES = 256 * 1024;

interface BotStepsProps {
  client: BotsClient;
  firstBot?: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  onShare?: () => void;
  onDone: (botId: string) => void;
}

type View = "dispatch" | "ready" | "review";
type ImportFailure = { file: string; text: string; message: string; line: number | null };

/**
 * Steps 5 to 7 of setup, and the same path whenever a new bot is made later:
 * Dispatch in the middle, a ready-made bot or a bot file as other ways in, then one review screen.
 */
export function BotSteps(props: BotStepsProps) {
  const [view, setView] = createSignal<View>("dispatch");
  const [cameFrom, setCameFrom] = createSignal<"dispatch" | "ready">("dispatch");
  const [draft, setDraft] = createSignal<BotDraft>(EMPTY_DRAFT);
  const [source, setSource] = createSignal<DraftSource>("form");
  const [importFailure, setImportFailure] = createSignal<ImportFailure | null>(null);
  const [repairing, setRepairing] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  function review(next: BotDraft, from: DraftSource): void {
    setDraft(next);
    setSource(from);
    setCameFrom(view() === "ready" ? "ready" : "dispatch");
    setImportFailure(null);
    setView("review");
  }

  function settle(file: string, text: string, result: ImportResult): void {
    if (result.ok) review(result.draft, "file");
    else setImportFailure({ file, text, message: result.message, line: result.line });
  }

  async function importFile(file: File): Promise<void> {
    setImportFailure(null);
    if (file.size > MAX_BOT_FILE_BYTES) {
      setImportFailure({
        file: file.name,
        text: "",
        message: t("ready.import.tooBig"),
        line: null,
      });
      return;
    }
    let text = "";
    try {
      text = await file.text();
      settle(file.name, text, await props.client.importFile(file.name, text));
    } catch (error) {
      settle(file.name, text, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        line: null,
      });
    }
  }

  async function repair(failure: ImportFailure): Promise<void> {
    if (repairing()) return;
    setRepairing(true);
    try {
      settle(failure.file, failure.text, await props.client.repairFile(failure.file, failure.text));
    } catch (error) {
      settle(failure.file, failure.text, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        line: null,
      });
    } finally {
      setRepairing(false);
    }
  }

  const pickFile = () => fileInput?.click();

  const importNotice = () => (
    <Show when={importFailure()}>
      {(failure) => (
        <SetupNotice
          tone="danger"
          title={t("ready.import.failed.title", { file: failure().file })}
          body={`${
            failure().line === null
              ? failure().message
              : t("ready.import.failed.line", {
                  line: failure().line as number,
                  message: failure().message,
                })
          } ${t("ready.import.failed.body")}`}
        >
          <Show when={failure().text}>
            <button
              type="button"
              class="mk-button mk-button--primary mk-button--small"
              disabled={repairing()}
              onClick={() => void repair(failure())}
            >
              {repairing() ? t("ready.import.repairing") : t("ready.import.repair")}
            </button>
          </Show>
          <button type="button" class="mk-button mk-button--small" onClick={pickFile}>
            <Icon name="file" size={12} />
            {t("ready.import.another")}
          </button>
        </SetupNotice>
      )}
    </Show>
  );

  return (
    <div data-component="BotSteps">
      <input
        ref={fileInput}
        type="file"
        accept=".md,.bot.md,text/markdown,text/plain"
        class="mk-visually-hidden"
        aria-label={t("ready.import")}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importFile(file);
        }}
      />
      <Switch>
        <Match when={view() === "dispatch"}>
          <DispatchStep
            client={props.client}
            firstBot={props.firstBot}
            importNotice={importNotice()}
            onPickReady={() => {
              setImportFailure(null);
              setView("ready");
            }}
            onImport={pickFile}
            onForm={() => review(EMPTY_DRAFT, "form")}
            onReview={(next) => review(next, "dispatch")}
            onBack={props.onBack}
            onSkip={props.onSkip}
          />
        </Match>
        <Match when={view() === "ready"}>
          <ReadyBotsStep
            client={props.client}
            importNotice={importNotice()}
            onBack={() => {
              setImportFailure(null);
              setView("dispatch");
            }}
            onImport={pickFile}
            onReview={(next) => review(next, "ready")}
            onShare={props.onShare}
          />
        </Match>
        <Match when={view() === "review"}>
          <ReviewStep
            client={props.client}
            draft={draft()}
            source={source()}
            onBack={() => setView(cameFrom())}
            onDone={props.onDone}
          />
        </Match>
      </Switch>
    </div>
  );
}
