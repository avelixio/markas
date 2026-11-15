import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { CONNECTION_EVENT } from "../host-client";
import { t } from "../i18n";
import { Icon } from "./Icon";
import "./connection-banner.css";

/** How long a drop must last before it is worth telling the person. */
const GRACE_MS = 1500;

/**
 * Says so when this window loses the host, and that bots may still be running.
 * The browser keeps retrying the event stream, so the banner clears by itself.
 */
export function ConnectionBanner() {
  const [lost, setLost] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onChange = (event: Event) => {
    const connected = (event as CustomEvent<{ connected: boolean }>).detail.connected;
    clearTimeout(timer);
    if (connected) {
      setLost(false);
      return;
    }
    timer = setTimeout(() => setLost(true), GRACE_MS);
  };

  onMount(() => window.addEventListener(CONNECTION_EVENT, onChange));
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener(CONNECTION_EVENT, onChange);
  });

  return (
    <Show when={lost()}>
      <div data-component="ConnectionBanner" class="connection-banner" role="alert">
        <Icon name="refresh" />
        <div data-slot="text" class="connection-banner__text">
          <strong>{t("connection.title")}</strong>
          <span>{t("connection.body")}</span>
        </div>
        <button
          data-slot="action"
          type="button"
          class="connection-banner__action"
          onClick={() => window.location.reload()}
        >
          {t("connection.action")}
        </button>
      </div>
    </Show>
  );
}
