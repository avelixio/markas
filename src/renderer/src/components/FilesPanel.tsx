import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import type { BotFileEntry, BotFileListing, BotFileRoot } from "../../../shared/files";
import type { AttachmentSummary } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { language, t, tCount } from "../i18n";
import { Icon } from "../ui/Icon";
import "./files-panel.css";

interface ArchivedFile extends AttachmentSummary {
  from: string | null;
  sentTo: string[];
  addedAt: string;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(language(), { day: "numeric", month: "short" });

interface FolderProps {
  botId: string;
  root: BotFileRoot;
  path: string;
  depth: number;
  /** Lower-case words the person is looking for. Empty shows everything. */
  find: string;
  onProblem: (message: string) => void;
}

/** One folder's rows. A folder inside it is read only when the person opens it. */
function Folder(props: FolderProps) {
  const [listing, { refetch }] = createResource(
    () => ({ botId: props.botId, root: props.root, path: props.path }),
    (input) => callHost<BotFileListing>("files.list", input),
  );
  const [open, setOpen] = createSignal<Record<string, boolean>>({});
  const shown = createMemo(() =>
    // A folder that could not be read has no entries; reading its value would throw instead.
    (listing.error ? [] : (listing()?.entries ?? [])).filter(
      (entry) =>
        // A folder stays while searching, because the file looked for may be inside it.
        !props.find || entry.kind === "folder" || entry.name.toLowerCase().includes(props.find),
    ),
  );

  const act = (entry: BotFileEntry) => {
    if (entry.kind === "folder") {
      setOpen((current) => ({ ...current, [entry.path]: !current[entry.path] }));
      return;
    }
    void callHost("files.open", {
      botId: props.botId,
      root: props.root,
      path: entry.path,
      action: "open",
    }).catch((error) => props.onProblem(describe(error)));
  };

  return (
    <Switch>
      <Match when={listing.error}>
        <li class="mk-files__note" style={{ "padding-left": `${12 + props.depth * 14}px` }}>
          <span role="alert">{describe(listing.error)}</span>
          <button type="button" class="mk-button mk-button--small" onClick={() => void refetch()}>
            {t("common.retry")}
          </button>
        </li>
      </Match>
      <Match when={listing.loading}>
        <li class="mk-files__note" style={{ "padding-left": `${12 + props.depth * 14}px` }}>
          {t("common.loading")}
        </li>
      </Match>
      <Match when={listing()}>
        {(current) => (
          <>
            <Show when={current().entries.length === 0}>
              <li class="mk-files__note" style={{ "padding-left": `${12 + props.depth * 14}px` }}>
                {t("files.empty")}
              </li>
            </Show>
            <For each={shown()}>
              {(entry) => (
                <>
                  <li>
                    <button
                      type="button"
                      class="mk-files__row"
                      style={{ "padding-left": `${12 + props.depth * 14}px` }}
                      aria-expanded={
                        entry.kind === "folder" ? Boolean(open()[entry.path]) : undefined
                      }
                      aria-label={
                        entry.kind === "folder"
                          ? t("files.folder", { name: entry.name })
                          : t("files.open", { name: entry.name })
                      }
                      onClick={() => act(entry)}
                    >
                      <Icon
                        name={
                          entry.kind === "file"
                            ? "file"
                            : open()[entry.path]
                              ? "chevronDown"
                              : "chevronRight"
                        }
                        size={12}
                      />
                      <span>{entry.name}</span>
                      <small>{entry.size === null ? "" : fileSize(entry.size)}</small>
                    </button>
                  </li>
                  <Show when={entry.kind === "folder" && open()[entry.path]}>
                    <Folder {...props} path={entry.path} depth={props.depth + 1} />
                  </Show>
                </>
              )}
            </For>
            <Show when={current().more > 0}>
              <li class="mk-files__note" style={{ "padding-left": `${12 + props.depth * 14}px` }}>
                {tCount("files.more", current().more)}
              </li>
            </Show>
          </>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The Files panel of a chat: the bot's own folder, the files that went through this chat,
 * and the folder all bots share. The keyring and other bots' folders are never listed.
 */
export function FilesPanel(props: { botId: string; botName: string }) {
  const [find, setFind] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  const [archive] = createResource(
    () => props.botId,
    () => callHost<ArchivedFile[]>("archive.list").catch(() => [] as ArchivedFile[]),
  );
  const words = () => find().trim().toLowerCase();
  const chatFiles = createMemo(() =>
    (archive() ?? []).filter(
      (file) =>
        (file.from === props.botId || file.sentTo.includes(props.botId)) &&
        (!words() || file.name.toLowerCase().includes(words())),
    ),
  );

  return (
    <div data-component="FilesPanel" class="mk-files">
      <label data-slot="search" class="mk-files__search">
        <Icon name="search" size={12} />
        <span class="mk-visually-hidden">{t("files.find")}</span>
        <input
          type="search"
          placeholder={t("files.find")}
          value={find()}
          onInput={(event) => setFind(event.currentTarget.value)}
        />
      </label>
      <Show when={problem()}>
        {(message) => (
          <p data-slot="problem" class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {message()}
          </p>
        )}
      </Show>

      <div data-slot="body" class="mk-files__body">
        <section aria-label={t("files.own", { name: props.botName })}>
          <h3>{t("files.own", { name: props.botName })}</h3>
          <ul>
            <Folder
              botId={props.botId}
              root="own"
              path=""
              depth={0}
              find={words()}
              onProblem={setProblem}
            />
          </ul>
        </section>

        <section aria-label={t("files.chat")}>
          <h3>{t("files.chat")}</h3>
          <ul>
            <Show
              when={chatFiles().length > 0}
              fallback={<li class="mk-files__note">{t("files.chat.empty")}</li>}
            >
              <For each={chatFiles()}>
                {(file) => (
                  <li>
                    <button
                      type="button"
                      class="mk-files__row"
                      aria-label={t("files.open", { name: file.name })}
                      onClick={() =>
                        void window.markas.agent
                          .openAttachment({ attachmentId: file.id, action: "open" })
                          .catch((error) => setProblem(describe(error)))
                      }
                    >
                      <Icon name={file.kind === "image" ? "image" : "file"} size={12} />
                      <span>{file.name}</span>
                      <small>{day(file.addedAt)}</small>
                    </button>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </section>

        <section aria-label={t("files.shared")}>
          <h3>{t("files.shared")}</h3>
          <ul>
            <Folder
              botId={props.botId}
              root="shared"
              path=""
              depth={0}
              find={words()}
              onProblem={setProblem}
            />
          </ul>
        </section>
      </div>

      <p data-slot="note" class="mk-files__foot">
        <Icon name="lock" size={12} />
        {t("files.note")}
      </p>
    </div>
  );
}
