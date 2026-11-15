import { createSignal, Show } from "solid-js";
import type { ExportBotResult } from "../../../shared/bot-draft";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";

/** Hands a piece of text to the browser as a file to save. */
export function saveTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Saves a bot as a bot file the person can keep or share.
 * The file holds the bot's profile only: no keys, no conversation, no folder.
 */
export function ExportBot(props: { botId: string; botName: string }) {
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal<string | null>(null);

  async function save(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const file = await callHost<ExportBotResult>("library.exportBot", props.botId);
      saveTextFile(file.fileName, file.text);
      setSaved(file.fileName);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-component="ExportBot" class="agent-settings-notifications agent-settings-export">
      <div>
        <strong>{t("settings.export")}</strong>
        <span>{t("settings.export.hint")}</span>
        <Show when={saved()}>
          {(fileName) => (
            <span data-slot="saved" role="status">
              {t("settings.export.saved", { file: fileName() })}
            </span>
          )}
        </Show>
        <Show when={problem()}>
          {(message) => (
            <span data-slot="problem" class="agent-settings-save-error" role="alert">
              {message()}
            </span>
          )}
        </Show>
      </div>
      <button
        type="button"
        class="mk-button mk-button--small"
        disabled={busy()}
        aria-label={t("settings.export.action", { name: props.botName })}
        onClick={() => void save()}
      >
        <Icon name="download" size={12} />
        {t("settings.export.button")}
      </button>
    </div>
  );
}
