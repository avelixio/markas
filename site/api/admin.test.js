// @vitest-environment node
// The numbers page's server side: only the owner's password opens it, and the numbers add up.
import { describe, expect, it } from "vitest";
import {
  COOKIE,
  configuredPassword,
  createSession,
  passwordMatches,
  sessionIsValid,
} from "./_lib/session.js";
import {
  clicksFromPaths,
  downloadsPerDay,
  fillDays,
  parseSnapshots,
  summarizeRelease,
} from "./_lib/stats.js";
import { POST as login } from "./admin/login.js";
import { POST as logout } from "./admin/logout.js";
import { GET as stats } from "./admin/stats.js";

const PASSWORD = "correct-horse-battery-staple";
const env = { ADMIN_PASSWORD: PASSWORD, VERCEL_TOKEN: "test-token" };
const SITE = "https://site.example.com";

const loginRequest = (password, origin = SITE) =>
  new Request(`${SITE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ password }),
  });

describe("the owner's session", () => {
  it("refuses a missing or short password in the environment instead of letting anyone in", () => {
    expect(configuredPassword({})).toBeNull();
    expect(configuredPassword({ ADMIN_PASSWORD: "short" })).toBeNull();
    expect(configuredPassword({ ADMIN_PASSWORD: PASSWORD })).toBe(PASSWORD);
    expect(passwordMatches("", null)).toBe(false);
    expect(passwordMatches(undefined, PASSWORD)).toBe(false);
  });

  it("accepts its own cookie until it expires, and none made with another password", () => {
    const now = Date.UTC(2026, 10, 19);
    const value = createSession(PASSWORD, now);
    expect(sessionIsValid(value, PASSWORD, now)).toBe(true);
    expect(sessionIsValid(value, PASSWORD, now + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(sessionIsValid(value, "another-password-of-length", now)).toBe(false);
    const [expires] = value.split(".");
    expect(
      sessionIsValid(`${Number(expires) + 999999}.${value.split(".")[1]}`, PASSWORD, now),
    ).toBe(false);
    expect(sessionIsValid("garbage", PASSWORD, now)).toBe(false);
  });

  it("signs in with the right password, with a cookie scripts and other sites cannot use", async () => {
    const response = await login(loginRequest(PASSWORD), { env, delay: 0 });
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie");
    expect(header).toContain(`${COOKIE}=`);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).toMatch(/Path=\//);
  });

  it("refuses a wrong password, a request from another site and a page that is not set up", async () => {
    expect((await login(loginRequest("wrong-password-guess"), { env, delay: 0 })).status).toBe(401);
    expect(
      (await login(loginRequest(PASSWORD, "https://evil.example.com"), { env, delay: 0 })).status,
    ).toBe(403);
    expect((await login(loginRequest(PASSWORD, null), { env, delay: 0 })).status).toBe(403);
    expect((await login(loginRequest(PASSWORD), { env: {}, delay: 0 })).status).toBe(503);
  });

  it("signs out by clearing the cookie", async () => {
    const response = await logout(
      new Request(`${SITE}/api/admin/logout`, { method: "POST", headers: { origin: SITE } }),
    );
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("the numbers", () => {
  it("counts installs by the way they were made", () => {
    const row = summarizeRelease({
      tag_name: "v0.1.2",
      published_at: "2026-11-18T19:00:00Z",
      assets: [
        { name: "Markas-Setup-0.1.2.exe", download_count: 10 },
        { name: "Markas-0.1.2-win-x64.zip", download_count: 2 },
        { name: "Markas-0.1.2-mac-arm64.dmg", download_count: 7 },
        { name: "Markas-0.1.2-linux-x86_64.AppImage", download_count: 3 },
        { name: "markas-0.1.2-macos-arm64.zip", download_count: 9 },
        { name: "SHA256SUMS-macos-arm64.txt", download_count: 4 },
        { name: "markas-0.1.2-linux-x64.zip", download_count: 2 },
        { name: "SHA256SUMS-linux-x64.txt", download_count: 2 },
      ],
    });
    expect(row).toMatchObject({
      release: "0.1.2",
      published: "2026-11-18",
      windowsApp: 12,
      macosApp: 7,
      linuxApp: 3,
      installScript: 6,
      homebrew: 5,
    });
  });

  it("turns the download pages' views into clicks, and leaves other pages out", () => {
    const clicks = clicksFromPaths([
      { requestPath: "/download/windows", pageviews: 5 },
      { requestPath: "/download/macos-arm64/", pageviews: 2 },
      { requestPath: "/download/something-else", pageviews: 9 },
      { requestPath: "/", pageviews: 40 },
    ]);
    expect(clicks.map((row) => row.clicks)).toEqual([5, 2, 0, 0]);
  });

  it("gives every day of the range, with zero on a quiet day", () => {
    const days = fillDays(
      [{ timestamp: "2026-11-02T00:00:00.000Z", visitors: 3, pageviews: 4 }],
      "2026-11-01",
      3,
    );
    expect(days).toEqual([
      { day: "2026-11-01", visitors: 0, pageviews: 0 },
      { day: "2026-11-02", visitors: 3, pageviews: 4 },
      { day: "2026-11-03", visitors: 0, pageviews: 0 },
    ]);
  });

  it("reads downloads per day from the daily totals, never below zero", () => {
    const snapshots = parseSnapshots(
      '{"day":"2026-11-20","total":15}\nnot json\n{"day":"2026-11-19","total":10}\n{"day":"2026-11-21","total":12}\n',
    );
    expect(downloadsPerDay(snapshots)).toEqual([
      { day: "2026-11-20", downloads: 5 },
      { day: "2026-11-21", downloads: 0 },
    ]);
  });
});

describe("the stats endpoint", () => {
  const now = new Date("2026-11-19T09:00:00Z");
  const fakeFetch = async (url) => {
    const text = String(url);
    if (text.startsWith("https://api.github.com/")) {
      return Response.json([
        {
          tag_name: "v0.1.2",
          published_at: "2026-11-18",
          assets: [{ name: "Markas-Setup-0.1.2.exe", download_count: 4 }],
        },
      ]);
    }
    if (text.includes("raw.githubusercontent.com")) {
      return new Response('{"day":"2026-11-18","total":1}\n{"day":"2026-11-19","total":4}\n');
    }
    const by = new URL(text).searchParams.get("by");
    if (by === "day")
      return Response.json({
        data: [{ timestamp: "2026-11-19T00:00:00Z", visitors: 7, pageviews: 9 }],
      });
    if (by === "requestPath")
      return Response.json({ data: [{ requestPath: "/download/linux", pageviews: 2 }] });
    if (by === "referrerHostname")
      return Response.json({ data: [{ referrerHostname: "", visitors: 7 }] });
    return Response.json({ data: [] });
  };

  it("answers only with a valid session", async () => {
    const request = new Request(`${SITE}/api/admin/stats`);
    expect((await stats(request, { env, fetcher: fakeFetch, now })).status).toBe(401);
  });

  it("puts GitHub's and Vercel's numbers together for the owner", async () => {
    const cookie = `${COOKIE}=${createSession(PASSWORD, now.getTime())}`;
    const request = new Request(`${SITE}/api/admin/stats?days=7`, { headers: { cookie } });
    const response = await stats(request, { env, fetcher: fakeFetch, now });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.range).toEqual({ days: 7, since: "2026-11-13", until: "2026-11-19" });
    expect(body.downloads.appDownloads).toBe(4);
    expect(body.downloadsPerDay).toEqual([{ day: "2026-11-19", downloads: 3 }]);
    expect(body.visits.visitors).toBe(7);
    expect(body.visits.daily).toHaveLength(7);
    expect(body.visits.referrers).toEqual([{ name: "Direct", visitors: 7 }]);
    expect(body.visits.clicks.find((row) => row.target === "linux").clicks).toBe(2);
  });

  it("still shows the downloads when the visits cannot be read", async () => {
    const cookie = `${COOKIE}=${createSession(PASSWORD, now.getTime())}`;
    const request = new Request(`${SITE}/api/admin/stats`, { headers: { cookie } });
    const body = await (
      await stats(request, { env: { ADMIN_PASSWORD: PASSWORD }, fetcher: fakeFetch, now })
    ).json();
    expect(body.visits.error).toMatch(/VERCEL_TOKEN/);
    expect(body.downloads.appDownloads).toBe(4);
  });
});
