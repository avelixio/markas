// Builds design/markas.figcraft from the sources in design/src and exports a PNG per screen.
//
//   node design/build.mjs                 build everything, save the file, export every screen
//   node design/build.mjs --only main     build only screens whose module name contains "main"
//                                         (nothing is saved; exports go to design/exports/_draft)
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COLOR_COLLECTION, COLORS, MODES, SCREEN } from "./src/tokens.mjs";
import { build } from "./tools/dsl.mjs";
import { Figcraft } from "./tools/figcraft.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null;
const scale = Number(process.env.EXPORT_SCALE ?? (only ? 1 : 2));
const GAP = 160;
const COLUMNS = 4;

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function loadModules(folder) {
  const files = (await readdir(join(here, "src", folder)))
    .filter((file) => file.endsWith(".mjs"))
    .sort();
  const modules = [];
  for (const file of files) {
    if (only && !file.includes(only)) continue;
    const loaded = await import(pathToFileURL(join(here, "src", folder, file)).href);
    const entries = Array.isArray(loaded.default) ? loaded.default : [loaded.default];
    modules.push(...entries.filter(Boolean));
  }
  return modules.sort((left, right) => left.name.localeCompare(right.name));
}

const client = await Figcraft.start();
try {
  await client.run("variable.createCollection", { name: COLOR_COLLECTION, modes: MODES });
  for (const [name, [dark, light, description]] of Object.entries(COLORS)) {
    await client.run("variable.create", {
      collection: COLOR_COLLECTION,
      name,
      type: "color",
      values: { Dark: dark, Light: light },
      description,
    });
  }

  const exportsRoot = join(here, "exports", only ? "_draft" : "");
  if (!only) await rm(join(here, "exports"), { recursive: true, force: true });
  await mkdir(exportsRoot, { recursive: true });

  const pages = [
    ["Foundations", await loadModules("foundations")],
    ["Screens", await loadModules("screens")],
  ];
  let first = true;
  for (const [pageName, modules] of pages) {
    if (modules.length === 0) continue;
    if (first) await client.run("page.rename", { name: pageName });
    else await client.run("page.add", { name: pageName });
    first = false;
    await client.run("page.setBackground", { color: "#0A0A09" });
    let column = 0;
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const module of modules) {
      const started = Date.now();
      const id = await build(client, { ...module.spec, props: { ...module.spec.props, x, y } });
      if (module.mode) {
        await client.run("variable.setMode", {
          ids: [id],
          collection: COLOR_COLLECTION,
          mode: module.mode,
        });
      }
      const node = await client.tool("get_node", { id, depth: 0, fields: ["width", "height"] });
      const file = join(exportsRoot, `${slug(module.name)}.png`);
      await client.tool("export", { ids: [id], path: file, scale });
      console.log(`${module.name}  ${node.width}x${node.height}  ${Date.now() - started} ms`);
      rowHeight = Math.max(rowHeight, node.height ?? SCREEN.height);
      column += 1;
      if (column === COLUMNS) {
        column = 0;
        x = 0;
        y += rowHeight + GAP;
        rowHeight = 0;
      } else {
        x += (node.width ?? SCREEN.width) + GAP;
      }
    }
  }
  if (!only) {
    await client.run("page.select", { index: 0 });
    const file = join(here, "markas.figcraft");
    await client.tool("save_file", { path: file });
    console.log(`saved ${file}`);
  }
} finally {
  await client.close();
}
