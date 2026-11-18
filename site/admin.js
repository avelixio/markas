// The private numbers page: signs the owner in, then shows what /api/admin/stats returns.
// Every value is put in with textContent, never as HTML: referrer names come from visitors.
const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en");
const dayLabel = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
const SVG = "http://www.w3.org/2000/svg";

function show(id) {
  for (const section of ["loading", "sign-in", "numbers"]) $(section).hidden = section !== id;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function fillTable(table, head, rows) {
  table.replaceChildren();
  const thead = table.createTHead().insertRow();
  for (const cell of head) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = cell;
    thead.append(th);
  }
  const body = table.createTBody();
  if (rows.length === 0) {
    const td = body.insertRow().insertCell();
    td.colSpan = head.length;
    td.textContent = "Nothing yet.";
    return;
  }
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.insertCell().textContent = cell;
  }
}

/** One series of daily bars: no legend, the card's title names it; hover shows the day. */
function drawBars(container, rows, key, unit) {
  container.replaceChildren();
  if (rows.length === 0 || rows.every((row) => row[key] === 0)) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      rows.length === 0 ? "No days to show yet." : `No ${unit} in this range yet.`;
    container.append(empty);
    return;
  }
  const width = 1000;
  const height = 200;
  const gap = rows.length > 20 ? 4 : 8;
  const barWidth = (width - gap * (rows.length - 1)) / rows.length;
  const max = Math.max(...rows.map((row) => row[key]));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${unit} per day, highest ${number.format(max)}`);
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.hidden = true;

  rows.forEach((row, index) => {
    const x = index * (barWidth + gap);
    const value = row[key];
    const barHeight = value === 0 ? 0 : Math.max(2, (value / max) * (height - 4));
    const hit = document.createElementNS(SVG, "rect");
    hit.setAttribute("class", "bar-hit");
    hit.setAttribute("x", String(x));
    hit.setAttribute("y", "0");
    hit.setAttribute("width", String(barWidth + gap));
    hit.setAttribute("height", String(height));
    const bar = document.createElementNS(SVG, "path");
    bar.setAttribute("class", "bar");
    // Rounded at the data end only, square on the baseline.
    const r = Math.min(4, barWidth / 2, barHeight);
    const top = height - barHeight;
    bar.setAttribute(
      "d",
      barHeight === 0
        ? ""
        : `M${x} ${height}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + barWidth - r}Q${x + barWidth} ${top} ${x + barWidth} ${top + r}V${height}Z`,
    );
    hit.addEventListener("pointerenter", () => {
      tooltip.textContent = `${dayLabel.format(new Date(`${row.day}T00:00:00Z`))}: ${number.format(value)} ${unit}`;
      tooltip.style.left = `${((x + barWidth / 2) / width) * 100}%`;
      tooltip.style.top = `${(top / height) * 200}px`;
      tooltip.hidden = false;
      bar.classList.add("active");
    });
    hit.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      bar.classList.remove("active");
    });
    svg.append(hit, bar);
  });
  const baseline = document.createElementNS(SVG, "line");
  baseline.setAttribute("class", "baseline");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", String(width));
  baseline.setAttribute("y1", String(height));
  baseline.setAttribute("y2", String(height));
  svg.append(baseline);

  const axis = document.createElement("div");
  axis.className = "axis";
  const first = document.createElement("span");
  first.textContent = dayLabel.format(new Date(`${rows[0].day}T00:00:00Z`));
  const last = document.createElement("span");
  last.textContent = dayLabel.format(new Date(`${rows.at(-1).day}T00:00:00Z`));
  axis.append(first, last);
  container.append(svg, tooltip, axis);
}

function render(data) {
  $("updated").textContent = `Updated ${new Date(data.updatedAt).toLocaleString("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}. Only you can see this page.`;

  const visits = data.visits ?? {};
  const visitsError = $("visits-error");
  if (visits.error) {
    visitsError.textContent = `Visits and clicks could not be read: ${visits.error}`;
    visitsError.hidden = false;
  } else {
    visitsError.hidden = true;
  }
  $("tile-visitors").textContent = visits.error ? "-" : number.format(visits.visitors);
  $("tile-pageviews").textContent = visits.error
    ? ""
    : `${number.format(visits.pageviews)} page views`;
  const clicks = visits.clicks ?? [];
  $("tile-clicks").textContent = visits.error
    ? "-"
    : number.format(clicks.reduce((sum, row) => sum + row.clicks, 0));

  const downloads = data.downloads ?? {};
  $("tile-apps").textContent = downloads.error ? "-" : number.format(downloads.appDownloads);
  $("tile-installs").textContent = downloads.error ? "-" : number.format(downloads.commandInstalls);

  const daily = visits.daily ?? [];
  drawBars($("visits-chart"), daily, "visitors", "visitors");
  fillTable(
    $("visits-table"),
    ["Day", "Visitors", "Page views"],
    daily.map((row) => [row.day, number.format(row.visitors), number.format(row.pageviews)]),
  );

  const perDay = Array.isArray(data.downloadsPerDay) ? data.downloadsPerDay : [];
  drawBars($("downloads-chart"), perDay, "downloads", "downloads");
  fillTable(
    $("downloads-table"),
    ["Day", "Downloads"],
    perDay.map((row) => [row.day, number.format(row.downloads)]),
  );

  fillTable(
    $("clicks-table"),
    ["System", "Clicks"],
    clicks.map((row) => [row.name, number.format(row.clicks)]),
  );
  fillTable(
    $("referrers-table"),
    ["Source", "Visitors"],
    (visits.referrers ?? []).map((row) => [row.name, number.format(row.visitors)]),
  );
  fillTable(
    $("releases-table"),
    ["Release", "Published", "Windows app", "macOS app", "Linux app", "Install script", "Homebrew"],
    (downloads.releases ?? []).map((row) => [
      row.release,
      row.published,
      number.format(row.windowsApp),
      number.format(row.macosApp),
      number.format(row.linuxApp),
      number.format(row.installScript),
      number.format(row.homebrew),
    ]),
  );
}

async function load() {
  const days = $("range").value;
  const { status, body } = await api(`/api/admin/stats?days=${days}`, { method: "GET" });
  if (status === 401) {
    show("sign-in");
    $("password").focus();
    return;
  }
  if (status !== 200) {
    show("sign-in");
    $("sign-in-error").textContent = body.error ?? "The numbers could not be loaded.";
    return;
  }
  render(body);
  show("numbers");
}

$("sign-in").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("sign-in-button");
  button.disabled = true;
  button.textContent = "Signing in…";
  $("sign-in-error").textContent = "";
  try {
    const { status, body } = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: $("password").value }),
    });
    if (status === 200) {
      $("password").value = "";
      await load();
    } else {
      $("sign-in-error").textContent = body.error ?? "Signing in did not work.";
      $("password").select();
    }
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

$("show-password").addEventListener("click", () => {
  const input = $("password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  $("show-password").setAttribute("aria-pressed", String(!showing));
  $("show-password").setAttribute(
    "aria-label",
    showing ? "Show the password" : "Hide the password",
  );
});

$("sign-out").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  show("sign-in");
});

$("range").addEventListener("change", () => void load());

for (const button of document.querySelectorAll("[data-table-for]")) {
  button.addEventListener("click", () => {
    const table = $(`${button.dataset.tableFor}-table`);
    table.hidden = !table.hidden;
    button.textContent = table.hidden ? "Show as table" : "Hide the table";
  });
}

load().catch(() => {
  show("sign-in");
  $("sign-in-error").textContent = "The numbers page could not be reached.";
});
