// A tiny declarative layer on top of FigCraft's node.create.
// Screens are trees of plain objects; build() walks a tree and creates the layers.

/** A colour variable reference, e.g. v("text/primary"). */
export const v = (name) => ({ $var: name });

const node = (type, props, children) => ({ type, props: props ?? {}, children: children ?? [] });

/** A frame without auto layout: children use x/y. */
export const box = (props, children) =>
  node("frame", { clip: false, fill: "none", ...props }, children);

/** A horizontal auto-layout frame. */
export const row = (props, children) =>
  node(
    "frame",
    { layout: "horizontal", crossAlign: "center", clip: false, fill: "none", ...props },
    children,
  );

/** A vertical auto-layout frame. */
export const col = (props, children) =>
  node("frame", { layout: "vertical", clip: false, fill: "none", ...props }, children);

export const rect = (props) => node("rectangle", props);
export const ellipse = (props) => node("ellipse", props);

/** Text. Pass `width` or sizingH "fill" to wrap; otherwise it hugs its content. */
export const text = (characters, props = {}) => {
  const wraps = props.width !== undefined || props.sizingH === "fill";
  return {
    type: "text",
    characters: String(characters),
    props: { textAutoResize: wraps ? "height" : "widthAndHeight", ...props },
    children: [],
  };
};

/** A stroked vector from SVG path data drawn on a square grid of `grid` units. */
export const vector = (path, props = {}) => ({ type: "vector", path, props, children: [] });

/** An element that takes the free space of its auto-layout parent. */
export const spacer = () =>
  node("frame", { fill: "none", sizingH: "fill", sizingV: "fill", height: 1, width: 1 });

const SIZE_KEYS = ["x", "y", "width", "height"];

/**
 * Creates `spec` (and its children) under `parent` and returns the new layer id.
 * Sizes default to hugging content for auto-layout frames.
 */
export async function build(client, spec, parent) {
  const { type, props, children } = spec;
  const params = { type, select: false };
  if (parent !== undefined) params.parent = parent;
  const rest = { ...props };
  for (const key of SIZE_KEYS) {
    if (rest[key] !== undefined) {
      params[key] = rest[key];
      delete rest[key];
    }
  }
  if (rest.name) {
    params.name = rest.name;
    delete rest.name;
  }
  if (type === "text") params.text = spec.characters;
  if (type === "vector") params.path = spec.path;
  if (type === "frame" && rest.layout) {
    // Auto-layout frames hug unless told otherwise.
    if (rest.sizingH === undefined) rest.sizingH = params.width === undefined ? "hug" : "fixed";
    if (rest.sizingV === undefined) rest.sizingV = params.height === undefined ? "hug" : "fixed";
  }
  // Sizing that depends on the parent or on children can only be applied once they exist.
  const late = {};
  for (const key of ["sizingH", "sizingV"]) {
    if (rest[key] !== undefined) {
      late[key] = rest[key];
      delete rest[key];
    }
  }
  params.props = rest;
  let created;
  try {
    created = await client.run("node.create", params);
  } catch (error) {
    throw new Error(
      `${error.message}\n  while creating ${type} "${params.name ?? spec.characters ?? ""}"`,
    );
  }
  const id = created.id;
  for (const child of children) {
    if (child) await build(client, child, id);
  }
  if (Object.keys(late).length > 0) {
    try {
      await client.run("node.set", { ids: [id], ...late });
    } catch (error) {
      throw new Error(
        `${error.message}\n  while sizing ${type} "${params.name ?? spec.characters ?? ""}"`,
      );
    }
  }
  return id;
}
