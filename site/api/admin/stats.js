// GET /api/admin/stats?days=30: the numbers page's data, for the owner's session only.
// Visits come from Vercel Web Analytics (VERCEL_TOKEN), downloads from GitHub's public counts,
// and downloads per day from the snapshots the download-stats workflow keeps on the stats branch.
import { configuredPassword, json, readCookie, sessionIsValid } from "../_lib/session.js";
import {
  clicksFromPaths,
  downloadsPerDay,
  fillDays,
  parseSnapshots,
  rangeStart,
  summarizeReleases,
} from "../_lib/stats.js";

const REPO = "avelixio/markas";
const SNAPSHOTS = `https://raw.githubusercontent.com/${REPO}/stats/downloads.jsonl`;
// Not secret: they name the project, and only a token can read it.
const PROJECT_ID = "prj_e6qlnMZQgn4Tv88t6mzYNvJf3Ver";
const TEAM_ID = "team_wrWlrvJvALZko1QMgEQaO22y";

async function github(fetcher, env) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "markas-site" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetcher(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers,
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return summarizeReleases(await response.json());
}

async function snapshots(fetcher) {
  const response = await fetcher(SNAPSHOTS, { headers: { "user-agent": "markas-site" } });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`The snapshots answered ${response.status}.`);
  return downloadsPerDay(parseSnapshots(await response.text()));
}

async function web(fetcher, env, since, until, days) {
  if (!env.VERCEL_TOKEN) {
    return { error: "VERCEL_TOKEN is not set, so the visits cannot be read." };
  }
  const query = async (params) => {
    const url = new URL("https://api.vercel.com/v1/query/web-analytics/visits/aggregate");
    for (const [key, value] of Object.entries({
      projectId: env.VERCEL_PROJECT_ID_FOR_STATS || PROJECT_ID,
      teamId: env.VERCEL_TEAM_ID_FOR_STATS || TEAM_ID,
      since,
      until,
      ...params,
    })) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${env.VERCEL_TOKEN}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body?.error?.message ?? `Vercel answered ${response.status}.`);
    return body.data ?? [];
  };
  // The home page is the site; the download pages are counted as clicks, not as visits.
  const home = "requestPath eq '/'";
  const [daily, referrers, countries, paths] = await Promise.all([
    query({ by: "day", filter: home }),
    query({ by: "referrerHostname", limit: 6, filter: home }),
    query({ by: "country", limit: 6, filter: home }),
    query({ by: "requestPath", limit: 50 }),
  ]);
  const filled = fillDays(daily, since, days);
  return {
    daily: filled,
    visitors: filled.reduce((sum, day) => sum + day.visitors, 0),
    pageviews: filled.reduce((sum, day) => sum + day.pageviews, 0),
    referrers: referrers.map((row) => ({
      name: row.referrerHostname || "Direct",
      visitors: row.visitors ?? 0,
    })),
    countries: countries.map((row) => ({
      name: row.country || "Unknown",
      visitors: row.visitors ?? 0,
    })),
    clicks: clicksFromPaths(paths),
  };
}

const settle = (promise) =>
  promise.then(
    (value) => value,
    (error) => ({ error: error instanceof Error ? error.message : String(error) }),
  );

export async function GET(request, { env = process.env, fetcher = fetch, now = new Date() } = {}) {
  const password = configuredPassword(env);
  if (!sessionIsValid(readCookie(request), password)) return json({ error: "Sign in first." }, 401);

  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = [7, 30].includes(asked) ? asked : 30;
  const since = rangeStart(days, now);
  const until = now.toISOString().slice(0, 10);

  const [downloads, history, visits] = await Promise.all([
    settle(github(fetcher, env)),
    settle(snapshots(fetcher)),
    settle(web(fetcher, env, since, until, days)),
  ]);
  return json({
    updatedAt: now.toISOString(),
    range: { days, since, until },
    downloads,
    downloadsPerDay: Array.isArray(history) ? history.filter((row) => row.day >= since) : history,
    visits,
  });
}
