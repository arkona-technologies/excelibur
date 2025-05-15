import { enforce } from "vscript";
import z from "zod";

export function parse_csv<T extends z.ZodRawShape>(
  csv: string,
  schema: z.ZodObject<T>,
  row_sep?: string,
): z.infer<typeof schema>[] {
  const is_schema = (row: string[], schema: z.ZodObject<T>) => {
    const keys = Object.keys(schema.shape);
    const matches = keys.filter((k)=> row.includes(k)).length;
    return matches > 3; // ehhh
  };
  row_sep ??= "\n";
  const parameter_mapping: Record<string, number> = {};
  const csv_header = csv
    .split(row_sep)
    .map((row) => row.split(",").flatMap((entry) => entry.trim()))
    .find((row_split) => is_schema(row_split, schema));
  enforce(!!csv_header, "Need a csv header to determine parameter mapping!");
  csv_header.forEach((key, idx) => {
    parameter_mapping[key] = idx;
  });

  const rows = csv
    .split(row_sep)
    .map((row) => row.split(",").flatMap((entry) => entry.trim()))
    .filter((row_split) => !is_schema(row_split, schema))
    .filter((row_split) => row_split.length === Object.keys(parameter_mapping).length)
    .map((r) => r.map((c) => (c == "" ? null : c)));
  const parsed = rows
    .map((row) => {
      try {
        let obj: any = {};
        Object.keys(schema.shape).forEach((k) => {
          const idx = parameter_mapping[k];
          obj[k] = row[idx];
        });
        return schema.parse(obj);
      } catch (_e) {
        return null;
      }
    })
    .filter((nullable) => !!nullable); 
  return parsed;
}
