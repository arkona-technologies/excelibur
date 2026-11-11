import z from "zod";

/** Parse cell arrays without losing commas, quotes or newlines inside XLSX cells. */
export function parse_rows<T extends z.ZodRawShape>(
  rows: unknown[][],
  schema: z.ZodObject<T>,
  source = "CSV",
): z.infer<typeof schema>[] {
  const cells = rows.map(row => Array.from(row, value =>
    value == null ? null : String(value).trim() || null));
  const keys = Object.keys(schema.shape);
  const header_index = cells.findIndex(row => keys.filter(key => row.includes(key)).length > 3);
  if (header_index < 0) throw new Error(`${source}: missing configuration header`);
  const header = cells[header_index];
  const parsed: z.infer<typeof schema>[] = [];
  const errors: string[] = [];
  for (let index = header_index + 1; index < cells.length; index++) {
    const row = cells[index];
    if (row.every(cell => cell === null)) continue;
    if (row.length === header.length && row.every((cell, i) => cell === header[i])) continue;
    const obj = Object.fromEntries(keys.map(key => {
      const column = header.indexOf(key);
      return [key, column < 0 ? undefined : row[column] ?? null];
    }));
    const result = schema.safeParse(obj);
    if (result.success) parsed.push(result.data);
    else errors.push(...result.error.issues.map(issue =>
      `${source} row ${index + 1}, ${issue.path.join(".")}: ${issue.message}`));
  }
  if (errors.length) throw new Error(`Invalid configuration:\n${errors.join("\n")}`);
  return parsed;
}

export function parse_csv<T extends z.ZodRawShape>(
  csv: string,
  schema: z.ZodObject<T>,
  row_sep = "\n",
): z.infer<typeof schema>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell.length === 0) quoted = !quoted;
      else cell += char;
    } else if (!quoted && char === ",") {
      row.push(cell); cell = "";
    } else if (!quoted && csv.startsWith(row_sep, i)) {
      row.push(cell); rows.push(row); row = []; cell = "";
      i += row_sep.length - 1;
    } else cell += char;
  }
  if (quoted) throw new Error("CSV: unterminated quoted field");
  row.push(cell); rows.push(row);
  return parse_rows(rows, schema);
}
