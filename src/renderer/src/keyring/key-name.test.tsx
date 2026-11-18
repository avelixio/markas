import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { KeyDialog } from "./KeyDialog";
import { keyNameFor, uniqueKeyName } from "./key-name";

describe("keyNameFor", () => {
  it("names a key after its site's own host", () => {
    expect(keyNameFor("https://app.example.com")).toBe("app.example.com");
    expect(keyNameFor("https://app.example.com/login?next=1")).toBe("app.example.com");
    expect(keyNameFor("https://example.com")).toBe("example.com");
    expect(keyNameFor("https://www.example.com")).toBe("example.com");
    expect(keyNameFor("https://Login.Example.COM")).toBe("login.example.com");
    expect(keyNameFor("http://127.0.0.1:47330")).toBe("127.0.0.1");
    expect(keyNameFor("not a url")).toBe("not-a-url");
    expect(keyNameFor("https://-.example")).toBe("example");
    expect(keyNameFor("")).toBe("login");
  });

  it("always makes a name the Keyring takes", () => {
    const rule = /^(?=.{1,253}$)[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    for (const site of [
      "https://a.example.com",
      `https://${"x".repeat(60)}.${"y".repeat(60)}.${"z".repeat(60)}.${"w".repeat(60)}.example`,
      "https://xn--bcher-kva.example",
      "app_.example.com",
    ]) {
      expect(keyNameFor(site)).toMatch(rule);
    }
  });
});

describe("uniqueKeyName", () => {
  it("adds a number for a second key on the same site", () => {
    expect(uniqueKeyName("app.example.com", [])).toBe("app.example.com");
    expect(uniqueKeyName("app.example.com", ["app.example.com"])).toBe("app.example.com-2");
    expect(uniqueKeyName("app.example.com", ["app.example.com", "app.example.com-2"])).toBe(
      "app.example.com-3",
    );
  });
});

describe("the key name in the key form", () => {
  const open = (takenNames: string[] = []) =>
    render(() => (
      <KeyDialog
        existing={null}
        takenNames={takenNames}
        bots={[]}
        onSave={async () => undefined}
        onClose={() => {}}
      />
    ));
  const nameField = () =>
    screen.getByLabelText(new RegExp(`^${t("keyring.form.name")}`)) as HTMLInputElement;
  const siteField = () =>
    screen.getByLabelText(new RegExp(`^${t("keyring.form.origin")}`)) as HTMLInputElement;

  it("follows the website until the person writes a name", () => {
    open(["app.example.com"]);
    fireEvent.input(siteField(), { target: { value: "https://app.example.com" } });
    expect(nameField().value).toBe("app.example.com-2");

    fireEvent.input(nameField(), { target: { value: "app-admin" } });
    fireEvent.input(siteField(), { target: { value: "https://other.example.com" } });
    expect(nameField().value).toBe("app-admin");

    // Emptied, the name follows the website again.
    fireEvent.input(nameField(), { target: { value: "" } });
    fireEvent.input(siteField(), { target: { value: "https://metrics.example.com" } });
    expect(nameField().value).toBe("metrics.example.com");
  });
});
