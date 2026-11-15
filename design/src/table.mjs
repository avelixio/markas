// A simple data table: fixed or filling columns, a header row, and body rows of text or nodes.
import { col, row } from "../tools/dsl.mjs";
import { edge, outline, t } from "./parts.mjs";
import { c, RADIUS } from "./tokens.mjs";

const cell = (content, column, header) => {
  const sizing = column.width ? { width: column.width } : { sizingH: "fill" };
  const child =
    typeof content === "string"
      ? t(
          content,
          header ? "label" : (column.style ?? "body"),
          header ? c.text3 : (column.color ?? c.text),
        )
      : content;
  return row({ name: `cell/${column.label}`, gap: 8, ...sizing }, [child]);
};

/**
 * @param columns [{ label, width? (px; omitted = fill), style?, color? }]
 * @param rows arrays of cells (string or node), one per column; a row may carry `selected`
 */
export function table(columns, rows, { selected = -1 } = {}) {
  return col(
    {
      name: "Table",
      sizingH: "fill",
      cornerRadius: RADIUS.card,
      fill: c.surface,
      clip: true,
      ...outline(),
    },
    [
      row(
        {
          name: "table/header",
          sizingH: "fill",
          height: 34,
          padding: [0, 16, 0, 16],
          gap: 16,
          fill: c.sidebar,
          ...edge("bottom"),
        },
        columns.map((column) => cell(column.label, column, true)),
      ),
      ...rows.map((cells, index) =>
        row(
          {
            name: `table/row-${index}`,
            sizingH: "fill",
            padding: [11, 16, 11, 16],
            gap: 16,
            fill: index === selected ? c.raised : "none",
            ...(index < rows.length - 1 ? edge("bottom") : {}),
          },
          cells.map((content, columnIndex) => cell(content, columns[columnIndex], false)),
        ),
      ),
    ],
  );
}
