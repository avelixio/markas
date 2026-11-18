import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import { KeyDialog } from "./KeyDialog";

let calls: Array<{ method: string; input: unknown }>;
let answer: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  answer = {
    status: 200,
    body: { result: { algorithm: "SHA1", digits: 6, periodSeconds: 30 } },
  };
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: url.replace("/api/", ""),
        input: (JSON.parse(String(init.body)) as { input: unknown }).input,
      });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  render(() => (
    <KeyDialog existing={null} bots={[]} onSave={async () => undefined} onClose={() => {}} />
  ));
  // The two-step code waits under More options.
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("keyring.form.more")) }));
  // The label also holds the hint under the field, so only its start is matched.
  return screen.getByLabelText(new RegExp(`^${t("keyring.form.twoStep")}`));
}

describe("the two-step setup key in the key form", () => {
  it("is checked by the host when the person leaves the field", async () => {
    const field = open();
    fireEvent.input(field, { target: { value: " JBSWY3DPEHPK3PXP " } });
    fireEvent.blur(field);
    expect(
      await screen.findByText(t("keyring.form.twoStep.ok", { digits: 6, seconds: 30 })),
    ).toBeInTheDocument();
    expect(calls).toEqual([{ method: "keyring.checkTwoStep", input: "JBSWY3DPEHPK3PXP" }]);
  });

  it("says what is wrong with a key that cannot make codes", async () => {
    answer = { status: 400, body: { error: "The two-step code key is not valid." } };
    const field = open();
    fireEvent.input(field, { target: { value: "not a key" } });
    fireEvent.blur(field);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The two-step code key is not valid.",
    );
  });

  it("forgets the verdict as soon as the key is changed, and asks nothing for an empty field", async () => {
    const field = open();
    fireEvent.input(field, { target: { value: "JBSWY3DPEHPK3PXP" } });
    fireEvent.blur(field);
    await screen.findByText(t("keyring.form.twoStep.ok", { digits: 6, seconds: 30 }));

    fireEvent.input(field, { target: { value: "" } });
    expect(
      screen.queryByText(t("keyring.form.twoStep.ok", { digits: 6, seconds: 30 })),
    ).not.toBeInTheDocument();
    fireEvent.blur(field);
    expect(calls).toHaveLength(1);
  });
});
