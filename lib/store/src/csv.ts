/**
 * RFC 4180 CSV codec.
 *
 * These files are the system of record for draft state *and* are meant to be
 * opened, edited and re-saved in Excel. That rules out naive `split(",")`
 * handling: a player note containing a comma, a quote or a line break has to
 * survive a round trip through both this codec and a spreadsheet app.
 */

/** A parsed row, keyed by the header names in row 0. */
export type CsvRow = Record<string, string>;

const QUOTE = '"';

/**
 * Values that need quoting: anything containing the delimiter, a quote, a line
 * break, or leading/trailing whitespace (which spreadsheets otherwise eat).
 */
function needsQuoting(value: string): boolean {
  return (
    value.includes(",") ||
    value.includes(QUOTE) ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim()
  );
}

function encodeField(value: string): string {
  if (value === "") return "";
  if (!needsQuoting(value)) return value;
  return QUOTE + value.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE;
}

/**
 * Serialize rows to CSV text.
 *
 * Columns are written in the order given, so the on-disk layout stays stable
 * across writes and diffs stay readable. A trailing newline is always emitted.
 * Excel needs CRLF to reliably keep embedded newlines inside a cell.
 */
export function stringifyCsv(columns: readonly string[], rows: readonly CsvRow[]): string {
  const lines: string[] = [columns.map(encodeField).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => encodeField(row[column] ?? "")).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse CSV text into rows keyed by header name.
 *
 * Tolerates LF, CRLF and lone-CR line endings, a UTF-8 BOM (Excel writes one),
 * and ragged rows — a short row yields empty strings for the missing columns
 * rather than throwing, so a hand-edited file still loads.
 */
export function parseCsv(text: string): CsvRow[] {
  const records = parseRecords(text);
  if (records.length === 0) return [];

  const [header, ...body] = records;
  const columns = header.map((name) => name.trim());

  return body
    // A trailing newline produces a final [""] record; drop those.
    .filter((fields) => !(fields.length === 1 && fields[0] === ""))
    .map((fields) => {
      const row: CsvRow = {};
      columns.forEach((column, index) => {
        row[column] = fields[index] ?? "";
      });
      return row;
    });
}

/** Split CSV text into raw records of raw fields. */
function parseRecords(text: string): string[][] {
  if (text.startsWith("﻿")) text = text.slice(1);

  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    fields.push(field);
    field = "";
  };

  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === QUOTE) {
        // A doubled quote is a literal quote; a lone quote closes the field.
        if (text[index + 1] === QUOTE) {
          field += QUOTE;
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === QUOTE && field === "") {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      endField();
      index += 1;
      continue;
    }

    if (char === "\r") {
      endRecord();
      // Swallow the LF of a CRLF pair.
      index += text[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    if (char === "\n") {
      endRecord();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Flush a final record that had no trailing newline.
  if (field !== "" || fields.length > 0) endRecord();

  return records;
}
