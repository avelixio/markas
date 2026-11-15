import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { id } from "./id";
import { setLanguage, t, tCount } from "./index";

const TABLES: Record<string, Record<string, string>> = { en, id };

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

afterEach(() => setLanguage("en"));

describe("translation tables", () => {
  it("have exactly the same keys in English and Bahasa Indonesia", () => {
    const english = Object.keys(en).sort();
    const indonesian = Object.keys(id).sort();
    expect(indonesian.filter((key) => !english.includes(key))).toEqual([]);
    expect(english.filter((key) => !indonesian.includes(key))).toEqual([]);
  });

  it("have text for every key", () => {
    for (const [language, table] of Object.entries(TABLES)) {
      const empty = Object.entries(table)
        .filter(([, text]) => text.trim() === "")
        .map(([key]) => key);
      expect(empty, language).toEqual([]);
    }
  });

  it("use the same placeholders in both languages", () => {
    const indonesian: Record<string, string> = id;
    const different = Object.entries(en)
      .filter(
        ([key, text]) =>
          placeholders(text).sort().join() !==
          placeholders(indonesian[key] ?? "")
            .sort()
            .join(),
      )
      .map(([key]) => key);
    expect(different).toEqual([]);
  });

  it("say bot and never agent, and never use the long dash", () => {
    for (const [language, table] of Object.entries(TABLES)) {
      const wrong = Object.entries(table)
        .filter(
          ([, text]) => /\bagents?\b/i.test(text) || text.includes(String.fromCharCode(0x2014)),
        )
        .map(([key]) => key);
      expect(wrong, language).toEqual([]);
    }
  });

  it("have both forms for every counted text", () => {
    const keys = Object.keys(en);
    const counted = keys.filter((key) => key.endsWith(".one"));
    expect(counted.length).toBeGreaterThan(0);
    for (const key of counted) {
      expect(keys).toContain(`${key.slice(0, -".one".length)}.other`);
    }
  });
});

describe("tCount", () => {
  it("picks the form for one or for many, in the current language", () => {
    expect(tCount("sidebar.state.unread", 1)).toBe("1 new reply");
    expect(tCount("sidebar.state.unread", 4)).toBe("4 new replies");
    setLanguage("id");
    expect(tCount("sidebar.state.unread", 1)).toBe("1 balasan baru");
    expect(tCount("sidebar.state.unread", 4)).toBe("4 balasan baru");
    expect(t("chat.status.queued", { position: 2 })).toBe("Antrean #2");
  });
});
