import { render } from "solid-js/web";
import { App } from "./App";
import { createHostClient, establishSession } from "./host-client";
import { language, t } from "./i18n";
import { botsClient } from "./setup/bots-host";
import { FirstRun } from "./setup/FirstRun";
import { setupClient } from "./setup/setup-client";
import { ConnectionBanner } from "./ui/ConnectionBanner";
import { Shell } from "./ui/Shell";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

const mountPoint = root;
document.documentElement.lang = language();

async function start(): Promise<void> {
  try {
    await establishSession(window.location, window.history);
    window.markas = createHostClient();
    // Fails with 401 when this browser has no session yet.
    await window.markas.getAppInfo();
  } catch {
    // Pasting the signed-in link into this tab only changes the fragment; reload to use it.
    window.addEventListener("hashchange", () => window.location.reload());
    render(() => <SignInNotice />, mountPoint);
    return;
  }
  render(
    () => (
      <>
        <ConnectionBanner />
        <FirstRun setup={setupClient} bots={botsClient}>
          <Shell chats={<App />} />
        </FirstRun>
      </>
    ),
    mountPoint,
  );
}

function SignInNotice() {
  return (
    <main data-component="SignInNotice" class="sign-in-notice">
      <h1 data-slot="title">{t("signin.title")}</h1>
      <p data-slot="body">{t("signin.body")}</p>
    </main>
  );
}

void start();
