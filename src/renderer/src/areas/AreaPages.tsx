import { createResource, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import type { AttachmentSummary, BotSummary } from "../../../shared/ipc";
import { AgentAvatar } from "../components/AgentAvatar";
import { callHost } from "../host-client";
import { language, type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import "./areas.css";

interface ArchivedFile extends AttachmentSummary {
  from: string | null;
  sentTo: string[];
  addedAt: string;
}

interface LogbookEntry {
  id: string;
  time: string;
  actor: "you" | "bot" | "round";
  action: string;
  target: string;
  outcome: "done" | "failed";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(language(), { dateStyle: "medium", timeStyle: "short" });

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The frame every full-page area shares: a title, one line of what it is, then its content. */
export function AreaPage(props: {
  name: string;
  title: string;
  subtitle: string;
  /** Buttons that belong to the whole page, shown beside its title. */
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section data-component={props.name} class="mk-page" aria-label={props.title}>
      <header data-slot="header" class="mk-page__header">
        <div>
          <h1>{props.title}</h1>
          <p>{props.subtitle}</p>
        </div>
        {props.actions}
      </header>
      <div data-slot="body" class="mk-page__body">
        {props.children}
      </div>
    </section>
  );
}

export function Empty(props: { icon: IconName; title: string; body: string }) {
  return (
    <div data-slot="empty" class="mk-empty">
      <span class="mk-empty__mark">
        <Icon name={props.icon} size={22} />
      </span>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
    </div>
  );
}

export function Failed(props: { error: unknown; retry: () => void }) {
  return (
    <div class="mk-notice mk-notice--warn" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{String(props.error instanceof Error ? props.error.message : props.error)}</strong>
      </div>
      <button type="button" class="mk-button" onClick={props.retry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

/** Every file attached to a message, with who sent it and which bots got it. */
export function ArchivePage() {
  const [files, { refetch }] = createResource(() => callHost<ArchivedFile[]>("archive.list"));
  const [bots] = createResource<BotSummary[]>(() => window.markas.agent.listBots());
  const bot = (id: string) => bots()?.find((candidate) => candidate.id === id);
  const [problem, setProblem] = createSignal<string | null>(null);
  async function act(file: ArchivedFile, action: "open" | "reveal"): Promise<void> {
    setProblem(null);
    try {
      await window.markas.agent.openAttachment({ attachmentId: file.id, action });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setProblem(t("archive.openFailed", { name: file.name, reason }));
    }
  }

  const who = (id: string | null) => (
    <Show when={id} fallback={<span>{t("common.you")}</span>}>
      {(botId) => (
        <span class="mk-who">
          <AgentAvatar
            shape={bot(botId())?.avatarShape}
            color={bot(botId())?.avatarColor}
            class="mk-share__sigil"
          />
          {bot(botId())?.name ?? botId()}
        </span>
      )}
    </Show>
  );

  return (
    <AreaPage name="ArchivePage" title={t("archive.title")} subtitle={t("archive.subtitle")}>
      <Switch>
        <Match when={files.loading}>
          <p class="mk-quiet" role="status">
            {t("common.loading")}
          </p>
        </Match>
        <Match when={files.error}>
          <Failed error={files.error} retry={() => void refetch()} />
        </Match>
        <Match when={files()?.length === 0}>
          <Empty icon="folder" title={t("archive.empty.title")} body={t("archive.empty.body")} />
        </Match>
        <Match when={files()}>
          <Show when={problem()}>
            {(message) => (
              <p data-slot="problem" class="mk-form-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <div class="mk-table-scroll">
            <table data-slot="table" class="mk-table">
              <thead>
                <tr>
                  <th scope="col">{t("archive.column.name")}</th>
                  <th scope="col">{t("archive.column.from")}</th>
                  <th scope="col">{t("archive.column.to")}</th>
                  <th scope="col">{t("archive.column.size")}</th>
                  <th scope="col">{t("archive.column.added")}</th>
                  <th scope="col">
                    <span class="mk-visually-hidden">{t("keyring.column.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={files()}>
                  {(file) => (
                    <tr>
                      <th scope="row">
                        <span class="mk-who">
                          <Icon name={file.kind === "image" ? "image" : "file"} />
                          {file.name}
                        </span>
                      </th>
                      <td>{who(file.from)}</td>
                      <td>
                        <span class="mk-who-list">
                          <For each={file.sentTo}>{(id) => who(id)}</For>
                        </span>
                      </td>
                      <td>{fileSize(file.size)}</td>
                      <td>{when(file.addedAt)}</td>
                      <td class="mk-table__actions">
                        <button
                          type="button"
                          class="mk-icon-button"
                          aria-label={t("archive.open", { name: file.name })}
                          onClick={() => void act(file, "open")}
                        >
                          <Icon name="external" />
                        </button>
                        <button
                          type="button"
                          class="mk-icon-button"
                          aria-label={t("archive.reveal", { name: file.name })}
                          onClick={() => void act(file, "reveal")}
                        >
                          <Icon name="folder" />
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="mk-quiet">
            {t("archive.count", { count: files()?.length ?? 0 })} · {t("archive.note")}
          </p>
        </Match>
      </Switch>
    </AreaPage>
  );
}

/** The append-only record of what was done. */
export function LogbookPage() {
  const [entries, { refetch }] = createResource(() =>
    callHost<LogbookEntry[]>("logbook.list", { limit: 300 }),
  );
  return (
    <AreaPage name="LogbookPage" title={t("logbook.title")} subtitle={t("logbook.subtitle")}>
      <Switch>
        <Match when={entries.loading}>
          <p class="mk-quiet" role="status">
            {t("common.loading")}
          </p>
        </Match>
        <Match when={entries.error}>
          <Failed error={entries.error} retry={() => void refetch()} />
        </Match>
        <Match when={entries()?.length === 0}>
          <Empty icon="activity" title={t("logbook.empty.title")} body={t("logbook.empty.body")} />
        </Match>
        <Match when={entries()}>
          <div class="mk-table-scroll">
            <table data-slot="table" class="mk-table">
              <thead>
                <tr>
                  <th scope="col">{t("logbook.column.time")}</th>
                  <th scope="col">{t("logbook.column.who")}</th>
                  <th scope="col">{t("logbook.column.action")}</th>
                  <th scope="col">{t("logbook.column.target")}</th>
                  <th scope="col">{t("logbook.column.outcome")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={entries()}>
                  {(entry) => (
                    <tr>
                      <td class="mk-mono">{when(entry.time)}</td>
                      <td>
                        {t(
                          entry.actor === "bot"
                            ? "common.bot"
                            : entry.actor === "round"
                              ? "logbook.who.round"
                              : "common.you",
                        )}
                      </td>
                      <td>{t(`logbook.action.${entry.action}` as MessageKey)}</td>
                      <td class="mk-mono">{entry.target}</td>
                      <td>
                        <span
                          classList={{
                            "mk-chip": true,
                            "mk-chip--accent": entry.outcome === "done",
                            "mk-chip--danger": entry.outcome === "failed",
                          }}
                        >
                          {t(`logbook.outcome.${entry.outcome}`)}
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="mk-quiet">
            <Icon name="lock" size={12} /> {t("logbook.note")}
          </p>
        </Match>
      </Switch>
    </AreaPage>
  );
}
