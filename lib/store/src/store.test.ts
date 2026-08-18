import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { parseCsv, stringifyCsv } from "./csv.ts";
import { writeFileAtomic } from "./atomic.ts";
import { CsvTable } from "./table.ts";
import { Store, resolveDataDir } from "./index.ts";

const scratchDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ff-store-"));
  scratchDirs.push(dir);
  return dir;
}

after(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(scratchDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("csv codec", () => {
  test("round-trips values that would break a naive split", () => {
    const columns = ["player_id", "note"];
    const rows = [
      { player_id: "chase", note: "Elite, but pricey" },
      { player_id: "hall", note: 'He said "buy low" twice' },
      { player_id: "bijan", note: "line 1\nline 2" },
      { player_id: "lamb", note: "trailing space   " },
      { player_id: "kelce", note: "" },
      { player_id: "nabers", note: "unicode: é, 中文, 🏈" },
      { player_id: "hurts", note: "quoted,\"and\"\ncombined" },
    ];

    const parsed = parseCsv(stringifyCsv(columns, rows));
    assert.deepEqual(parsed, rows);
  });

  test("preserves a comma-only and quote-only field", () => {
    const parsed = parseCsv(stringifyCsv(["a"], [{ a: "," }, { a: '"' }]));
    assert.deepEqual(parsed, [{ a: "," }, { a: '"' }]);
  });

  test("accepts LF, CRLF and a UTF-8 BOM", () => {
    const expected = [
      { id: "1", name: "Ja'Marr Chase" },
      { id: "2", name: "Bijan Robinson" },
    ];

    for (const text of [
      "id,name\n1,Ja'Marr Chase\n2,Bijan Robinson\n",
      "id,name\r\n1,Ja'Marr Chase\r\n2,Bijan Robinson\r\n",
      "﻿id,name\r\n1,Ja'Marr Chase\r\n2,Bijan Robinson",
    ]) {
      assert.deepEqual(parseCsv(text), expected);
    }
  });

  test("pads ragged rows instead of throwing", () => {
    // What a hand-edit in a text editor tends to produce.
    assert.deepEqual(parseCsv("id,name,team\n1,Chase\n"), [
      { id: "1", name: "Chase", team: "" },
    ]);
  });

  test("returns no rows for an empty or header-only file", () => {
    assert.deepEqual(parseCsv(""), []);
    assert.deepEqual(parseCsv("id,name\n"), []);
  });
});

describe("atomic writes", () => {
  test("leaves no temp files behind", async () => {
    const dir = await scratch();
    const target = path.join(dir, "picks.csv");

    await writeFileAtomic(target, "one");
    await writeFileAtomic(target, "two");

    assert.equal(await readFile(target, "utf8"), "two");
    assert.deepEqual(await readdir(dir), ["picks.csv"]);
  });

  test("creates missing parent directories", async () => {
    const dir = await scratch();
    const target = path.join(dir, "nested", "deeper", "picks.csv");

    await writeFileAtomic(target, "value");
    assert.equal(await readFile(target, "utf8"), "value");
  });

  test("concurrent writes to one path all resolve and leave valid content", async () => {
    const dir = await scratch();
    const target = path.join(dir, "picks.csv");

    await Promise.all(
      Array.from({ length: 25 }, (_, index) => writeFileAtomic(target, `value-${index}`)),
    );

    // Whichever won, the file must be one complete write — never a splice.
    assert.match(await readFile(target, "utf8"), /^value-\d+$/);
    assert.deepEqual(await readdir(dir), ["picks.csv"]);
  });
});

interface Row {
  id: string;
  value: string;
}

const rowSchema = {
  columns: ["id", "value"] as const,
  encode: (record: Row) => ({ id: record.id, value: record.value }),
  decode: (row: Record<string, string>) =>
    row["id"] ? { id: row["id"], value: row["value"] ?? "" } : null,
};

describe("CsvTable", () => {
  test("persists across a fresh instance pointed at the same file", async () => {
    const dir = await scratch();
    const file = path.join(dir, "rows.csv");

    const first = new CsvTable<Row>(file, rowSchema);
    await first.append({ id: "a", value: "one" });
    await first.append({ id: "b", value: "two" });

    const second = new CsvTable<Row>(file, rowSchema);
    assert.deepEqual(await second.all(), [
      { id: "a", value: "one" },
      { id: "b", value: "two" },
    ]);
  });

  test("serializes concurrent appends without losing any", async () => {
    const dir = await scratch();
    const file = path.join(dir, "rows.csv");
    const table = new CsvTable<Row>(file, rowSchema);

    // The failure this guards against: read-modify-write races dropping rows.
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        table.append({ id: String(index), value: `v${index}` }),
      ),
    );

    const reloaded = new CsvTable<Row>(file, rowSchema);
    const rows = await reloaded.all();
    assert.equal(rows.length, 50);
    assert.deepEqual(
      rows.map((row) => row.id).sort((a, b) => Number(a) - Number(b)),
      Array.from({ length: 50 }, (_, index) => String(index)),
    );
  });

  test("remove reports how many rows went", async () => {
    const dir = await scratch();
    const table = new CsvTable<Row>(path.join(dir, "rows.csv"), rowSchema);

    await table.append({ id: "a", value: "keep" });
    await table.append({ id: "b", value: "drop" });
    await table.append({ id: "c", value: "drop" });

    assert.equal(await table.remove((row) => row.value === "drop"), 2);
    assert.deepEqual(await table.all(), [{ id: "a", value: "keep" }]);
    assert.equal(await table.remove((row) => row.id === "missing"), 0);
  });

  test("upsert replaces in place rather than appending a duplicate", async () => {
    const dir = await scratch();
    const table = new CsvTable<Row>(path.join(dir, "rows.csv"), rowSchema);

    await table.append({ id: "a", value: "first" });
    await table.append({ id: "b", value: "other" });
    await table.upsert({ id: "a", value: "second" }, (row) => row.id === "a");

    assert.deepEqual(await table.all(), [
      { id: "a", value: "second" },
      { id: "b", value: "other" },
    ]);
  });

  test("keeps a backup before the first write of a session", async () => {
    const dir = await scratch();
    const file = path.join(dir, "rows.csv");
    const backupDir = path.join(dir, "backups");

    const first = new CsvTable<Row>(file, rowSchema, backupDir);
    await first.append({ id: "a", value: "original" });

    // A new session (new instance) mutating an existing file must snapshot it.
    const second = new CsvTable<Row>(file, rowSchema, backupDir);
    await second.append({ id: "b", value: "added" });

    const backups = await readdir(backupDir);
    assert.equal(backups.length, 1);
    const restored = parseCsv(await readFile(path.join(backupDir, backups[0]), "utf8"));
    assert.deepEqual(restored, [{ id: "a", value: "original" }]);
  });

  test("survives a hand-edit that drops a column and adds a blank line", async () => {
    const dir = await scratch();
    const file = path.join(dir, "rows.csv");
    await writeFile(file, "id,value\na,one\n\nb\n", "utf8");

    const table = new CsvTable<Row>(file, rowSchema);
    assert.deepEqual(await table.all(), [
      { id: "a", value: "one" },
      { id: "b", value: "" },
    ]);
  });

  test("a rejected mutation does not wedge later writes", async () => {
    const dir = await scratch();
    const table = new CsvTable<Row>(path.join(dir, "rows.csv"), rowSchema);

    await assert.rejects(
      table.update(() => {
        throw new Error("boom");
      }),
      /boom/,
    );

    await table.append({ id: "a", value: "still works" });
    assert.deepEqual(await table.all(), [{ id: "a", value: "still works" }]);
  });
});

describe("Store", () => {
  test("round-trips a pick and a note with awkward text", async () => {
    const dir = await scratch();
    const store = new Store(dir);

    await store.draftPicks.append({
      id: "pick-1",
      playerId: "chase",
      playerName: "Ja'Marr Chase",
      team: "CIN",
      position: "WR",
      pickNumber: 1,
      draftedAt: "2026-08-18T15:00:00.000Z",
    });
    await store.playerNotes.upsert(
      {
        playerId: "chase",
        playerName: "Ja'Marr Chase",
        note: 'Target share is elite, but "pricey" at 1.01,\nrevisit in round 2',
        updatedAt: "2026-08-18T15:00:00.000Z",
      },
      (note) => note.playerId === "chase",
    );

    const reopened = new Store(dir);
    const [pick] = await reopened.draftPicks.all();
    const [note] = await reopened.playerNotes.all();

    assert.equal(pick.playerName, "Ja'Marr Chase");
    assert.equal(pick.pickNumber, 1);
    assert.equal(note.note, 'Target share is elite, but "pricey" at 1.01,\nrevisit in round 2');
  });

  test("writes where a spreadsheet user would look", async () => {
    const dir = await scratch();
    const store = new Store(dir);

    assert.equal(store.draftPicks.filePath, path.join(dir, "user", "draft_picks.csv"));
    assert.equal(store.playerNotes.filePath, path.join(dir, "user", "player_notes.csv"));
  });

  test("resolveDataDir honours DATA_DIR and falls back to ./data", () => {
    assert.equal(resolveDataDir({ DATA_DIR: "/app/data" }), "/app/data");
    assert.equal(resolveDataDir({}), path.resolve("data"));
  });
});
