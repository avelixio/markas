import { createResource, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import type { BotSummary } from "../../../shared/ipc";
import { ROOM_LIMITS, type Room, type RoomAskResult, type RoomInput } from "../../../shared/rooms";
import { AreaPage, Empty, Failed } from "../areas/AreaPages";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { requestOpenBot } from "../ui/crew-signal";
import { Icon } from "../ui/Icon";
import "./rooms.css";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface RoomsData {
  rooms: Room[];
  bots: BotSummary[];
}

type DialogState = { type: "add" } | { type: "edit"; room: Room } | null;

/** The form to make or change a room: its name, what it is for, who leads and who else is in it. */
function RoomDialog(props: {
  existing: Room | null;
  bots: BotSummary[];
  onSave: (input: RoomInput) => Promise<void>;
  onClose: () => void;
}) {
  const existing = props.existing;
  const [name, setName] = createSignal(existing?.name ?? "");
  const [purpose, setPurpose] = createSignal(existing?.purpose ?? "");
  const [lead, setLead] = createSignal(existing?.leadBotId ?? props.bots[0]?.id ?? "");
  const [members, setMembers] = createSignal<string[]>(existing?.memberBotIds ?? []);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let firstField: HTMLInputElement | undefined;
  onMount(() => firstField?.focus());

  const toggle = (id: string) =>
    setMembers((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await props.onSave({
        name: name().trim(),
        purpose: purpose().trim(),
        leadBotId: lead(),
        memberBotIds: members().filter((id) => id !== lead()),
      });
    } catch (failure) {
      setError(describe(failure));
      setSaving(false);
    }
  };

  return (
    <div data-component="RoomDialog" class="mk-scrim">
      <form
        class="mk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-dialog-title"
        onSubmit={submit}
      >
        <header data-slot="header" class="mk-dialog__header">
          <span class="mk-dialog__mark">
            <Icon name="team" />
          </span>
          <div>
            <h2 id="room-dialog-title">
              {existing
                ? t("rooms.form.editTitle", { name: existing.name })
                : t("rooms.form.addTitle")}
            </h2>
            <p>{t("rooms.form.lead")}</p>
          </div>
          <button
            type="button"
            class="mk-icon-button"
            aria-label={t("common.close")}
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div data-slot="fields" class="mk-form-grid">
          <label class="mk-field">
            <span>{t("rooms.form.name")}</span>
            <input
              ref={firstField}
              class="mk-input"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              maxlength={ROOM_LIMITS.name}
              autocomplete="off"
              required
            />
          </label>
          <label class="mk-field">
            <span>{t("rooms.form.leadBot")}</span>
            <select
              class="mk-input"
              value={lead()}
              onChange={(event) => setLead(event.currentTarget.value)}
              required
            >
              <For each={props.bots}>{(bot) => <option value={bot.id}>{bot.name}</option>}</For>
            </select>
            <small>{t("rooms.form.leadBot.hint")}</small>
          </label>
          <label class="mk-field mk-field--wide">
            <span>{t("rooms.form.purpose")}</span>
            <input
              class="mk-input"
              value={purpose()}
              onInput={(event) => setPurpose(event.currentTarget.value)}
              maxlength={ROOM_LIMITS.purpose}
              autocomplete="off"
            />
          </label>
        </div>

        <fieldset data-slot="members" class="mk-field">
          <legend>{t("rooms.form.members")}</legend>
          <div class="mk-share-list">
            <For each={props.bots.filter((bot) => bot.id !== lead())}>
              {(bot) => (
                <label classList={{ "mk-share": true, "is-active": members().includes(bot.id) }}>
                  <input
                    type="checkbox"
                    checked={members().includes(bot.id)}
                    onChange={() => toggle(bot.id)}
                  />
                  {bot.name}
                </label>
              )}
            </For>
          </div>
          <small>{t("rooms.form.members.hint", { count: ROOM_LIMITS.members })}</small>
        </fieldset>

        <Show when={error()}>
          <p data-slot="error" class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {error()}
          </p>
        </Show>

        <footer data-slot="actions" class="mk-dialog__actions">
          <button type="button" class="mk-button mk-button--ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="mk-button mk-button--primary" disabled={saving()}>
            <Icon name="check" />
            {saving() ? t("keyring.form.saving") : t("rooms.form.save")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function RoomCard(props: {
  room: Room;
  bots: BotSummary[];
  onEdit: () => void;
  onRemoved: () => void;
  onAsked: (leadBotId: string) => void;
}) {
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const bot = (id: string) => props.bots.find((candidate) => candidate.id === id);

  async function ask(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const body = text().trim();
    if (!body || busy()) return;
    setBusy(true);
    setProblem(null);
    try {
      const sent = await callHost<RoomAskResult>("rooms.ask", {
        roomId: props.room.id,
        text: body,
      });
      setText("");
      props.onAsked(sent.leadBotId);
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setProblem(null);
    try {
      await callHost("rooms.remove", props.room.id);
      props.onRemoved();
    } catch (error) {
      setProblem(describe(error));
    }
  }

  return (
    <article data-component="RoomCard" class="mk-room" aria-label={props.room.name}>
      <header data-slot="header">
        <span class="mk-room__mark">
          <Icon name="team" size={16} />
        </span>
        <div>
          <h2>{props.room.name}</h2>
          <Show when={props.room.purpose}>
            <p>{props.room.purpose}</p>
          </Show>
        </div>
        <button
          type="button"
          class="mk-icon-button"
          aria-label={t("rooms.edit", { name: props.room.name })}
          onClick={props.onEdit}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          class="mk-icon-button"
          aria-label={t("rooms.remove", { name: props.room.name })}
          onClick={() => setConfirming(true)}
        >
          <Icon name="trash" />
        </button>
      </header>

      <ul data-slot="members" class="mk-room__members">
        <li>
          <strong>{bot(props.room.leadBotId)?.name ?? t("rooms.gone")}</strong>
          <span class="mk-chip mk-chip--accent">{t("rooms.leadChip")}</span>
          <small>{t("rooms.leadRole")}</small>
        </li>
        <For each={props.room.memberBotIds}>
          {(id) => (
            <li>
              <strong>{bot(id)?.name ?? t("rooms.gone")}</strong>
              <small>{bot(id)?.role ?? ""}</small>
            </li>
          )}
        </For>
      </ul>

      <Show when={confirming()}>
        <div data-slot="confirm" class="mk-notice mk-notice--warn" role="alertdialog">
          <Icon name="warning" />
          <div>
            <strong>{t("rooms.remove.confirm", { name: props.room.name })}</strong>
            <span>{t("rooms.remove.note")}</span>
          </div>
          <button type="button" class="mk-button mk-button--small" onClick={() => void remove()}>
            {t("rooms.remove.yes")}
          </button>
          <button
            type="button"
            class="mk-button mk-button--ghost mk-button--small"
            onClick={() => setConfirming(false)}
          >
            {t("common.cancel")}
          </button>
        </div>
      </Show>

      <form data-slot="ask" class="mk-room__ask" onSubmit={ask}>
        <label class="mk-visually-hidden" for={`room-ask-${props.room.id}`}>
          {t("rooms.ask.label", { name: props.room.name })}
        </label>
        <textarea
          id={`room-ask-${props.room.id}`}
          class="mk-input mk-input--area"
          rows={2}
          maxlength={ROOM_LIMITS.question}
          placeholder={t("rooms.ask.placeholder")}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <button
          type="submit"
          class="mk-button mk-button--primary"
          disabled={!text().trim() || busy()}
        >
          <Icon name="send" size={14} />
          {t("rooms.ask.send")}
        </button>
      </form>
      <Show when={problem()}>
        {(message) => (
          <p data-slot="problem" class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {message()}
          </p>
        )}
      </Show>
    </article>
  );
}

/**
 * Rooms: a few bots that work on one thing together. The person asks the room, the lead
 * decides who helps, and the work shows in the lead's chat.
 */
export function RoomsPage(props: { onOpenChats?: () => void }) {
  const [data, { refetch }] = createResource<RoomsData>(async () => {
    const [rooms, bots] = await Promise.all([
      callHost<Room[]>("rooms.list"),
      callHost<BotSummary[]>("agent.listBots"),
    ]);
    return { rooms, bots };
  });
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const enoughBots = () => (data()?.bots.length ?? 0) >= 2;

  async function save(input: RoomInput): Promise<void> {
    const current = dialog();
    if (current?.type === "edit") await callHost("rooms.update", { id: current.room.id, ...input });
    else await callHost("rooms.create", input);
    setDialog(null);
    await refetch();
  }

  return (
    <AreaPage
      name="RoomsPage"
      title={t("rooms.title")}
      subtitle={t("rooms.subtitle")}
      actions={
        <>
          <span class="mk-chip">{t("common.preview")}</span>
          <button
            type="button"
            class="mk-button mk-button--primary"
            disabled={!enoughBots()}
            onClick={() => setDialog({ type: "add" })}
          >
            <Icon name="plus" size={14} />
            {t("rooms.new")}
          </button>
        </>
      }
    >
      <Switch>
        <Match when={data.error}>
          <Failed error={data.error} retry={() => void refetch()} />
        </Match>
        <Match when={data()}>
          {(current) => (
            <Switch>
              <Match when={!enoughBots()}>
                <Empty
                  icon="team"
                  title={t("rooms.needBots.title")}
                  body={t("rooms.needBots.body")}
                />
              </Match>
              <Match when={current().rooms.length === 0}>
                <Empty icon="team" title={t("rooms.empty.title")} body={t("rooms.empty.body")} />
              </Match>
              <Match when={true}>
                <div data-slot="rooms" class="mk-rooms">
                  <For each={current().rooms}>
                    {(room) => (
                      <RoomCard
                        room={room}
                        bots={current().bots}
                        onEdit={() => setDialog({ type: "edit", room })}
                        onRemoved={() => void refetch()}
                        onAsked={(leadBotId) => {
                          requestOpenBot(leadBotId);
                          props.onOpenChats?.();
                        }}
                      />
                    )}
                  </For>
                </div>
                <p class="mk-quiet">
                  <Icon name="info" size={12} /> {t("rooms.note")}
                </p>
              </Match>
            </Switch>
          )}
        </Match>
        <Match when={data.loading}>
          <p class="mk-quiet" role="status">
            {t("common.loading")}
          </p>
        </Match>
      </Switch>
      <Show when={dialog()}>
        {(current) => {
          const state = current();
          return (
            <RoomDialog
              existing={state.type === "edit" ? state.room : null}
              bots={data()?.bots ?? []}
              onSave={save}
              onClose={() => setDialog(null)}
            />
          );
        }}
      </Show>
    </AreaPage>
  );
}
