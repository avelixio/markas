import { createSignal, For, Show } from "solid-js";
import type { AgentPromptQuestion } from "../../../shared/ipc";
import { PermissionCard } from "../access/AccessControl";
import { t } from "../i18n";
import { KeyRequestCard } from "../keyring/KeyRequestCard";

export function ChoiceCard(props: {
  title: string;
  hint?: string;
  choices: string[];
  customChoice?: string;
  pending?: boolean;
  onSubmit: (answer: string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = createSignal("");
  const [customSelected, setCustomSelected] = createSignal(false);
  let customInput: HTMLInputElement | undefined;
  const submit = async () => {
    const value = answer().trim();
    if (value && !props.pending) await props.onSubmit(value);
  };
  return (
    <div data-component="ChoiceCard" class="choice-card">
      <div data-slot="header" class="choice-card-heading">
        <div>
          <strong>{props.title}</strong>
          <span>{props.hint ?? t("prompt.choice.hint")}</span>
        </div>
      </div>
      <div data-slot="options" class="choice-options" role="listbox" aria-label={props.title}>
        <For each={props.choices}>
          {(choice, index) => (
            <button
              type="button"
              role="option"
              aria-selected={choice === props.customChoice ? customSelected() : answer() === choice}
              class="choice-option"
              classList={{
                "choice-option-selected":
                  choice === props.customChoice ? customSelected() : answer() === choice,
              }}
              disabled={props.pending}
              onClick={() => {
                if (choice === props.customChoice) {
                  setAnswer("");
                  setCustomSelected(true);
                  customInput?.focus();
                  return;
                }
                setCustomSelected(false);
                setAnswer(choice);
                void props.onSubmit(choice);
              }}
            >
              <span class="choice-key">{String.fromCharCode(65 + index())}</span>
              <span>{choice}</span>
            </button>
          )}
        </For>
      </div>
      <input
        ref={(element) => (customInput = element)}
        class="choice-input"
        value={answer()}
        placeholder={t("prompt.choice.placeholder")}
        aria-label={t("prompt.choice.custom")}
        disabled={props.pending}
        onInput={(event) => {
          setCustomSelected(true);
          setAnswer(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />
    </div>
  );
}

export function PromptCard(props: {
  questions: AgentPromptQuestion[];
  botName?: string;
  onSubmit: (answers: Record<string, string[]>) => Promise<boolean>;
}) {
  // A bot asking for a key gets a card that saves it, so the secret never enters the chat.
  const keyRequest = props.questions.find((question) => question.keyRequest);
  if (keyRequest?.keyRequest) {
    const options = keyRequest.options ?? [];
    return (
      <KeyRequestCard
        request={keyRequest.keyRequest}
        botName={props.botName ?? t("prompt.bot")}
        onAnswer={(saved) =>
          props.onSubmit({
            [keyRequest.id]: [(saved ? options[0] : options.at(-1))?.label ?? ""],
          })
        }
      />
    );
  }
  // A bot asking permission gets its own card: what it wants, and a clear yes or no.
  const permission = props.questions.find((question) => question.permission);
  if (permission) {
    return (
      <PermissionCard
        botName={props.botName ?? t("prompt.bot")}
        question={permission}
        onAnswer={(label) => props.onSubmit({ [permission.id]: [label] })}
      />
    );
  }
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const submit = async () => {
    if (submitting()) return;
    const result = Object.fromEntries(
      props.questions.map((question) => [question.id, [answers()[question.id]?.trim() ?? ""]]),
    );
    if (Object.values(result).some((value) => !value[0])) return;
    setSubmitting(true);
    await props.onSubmit(result);
    setSubmitting(false);
  };
  return (
    <section data-component="PromptCard" class="prompt-card" aria-label={t("prompt.label")}>
      <For each={props.questions}>
        {(question) => (
          <div data-slot="question" class="prompt-question">
            <strong>{question.question}</strong>
            <Show when={question.options?.length}>
              <div class="choice-options">
                <For each={question.options ?? []}>
                  {(option) => (
                    <button
                      type="button"
                      class="choice-option"
                      classList={{
                        "choice-option-selected": answers()[question.id] === option.label,
                      }}
                      onClick={() =>
                        setAnswers((current) => ({ ...current, [question.id]: option.label }))
                      }
                    >
                      <span>{option.label}</span>
                      <small>{option.description}</small>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <input
              class="choice-input"
              type={question.isSecret ? "password" : "text"}
              value={answers()[question.id] ?? ""}
              placeholder={t("prompt.placeholder")}
              aria-label={question.header}
              onInput={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.currentTarget.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </div>
        )}
      </For>
      <button
        type="button"
        data-slot="actions"
        class="prompt-submit"
        disabled={submitting()}
        onClick={() => void submit()}
      >
        {submitting() ? t("prompt.sending") : t("prompt.send")}
      </button>
    </section>
  );
}
