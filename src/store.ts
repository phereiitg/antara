import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaseRecord } from "./contracts";

// File-backed case store for the prototype: data/cases/<id>/case.json plus the case's media.
// Swap for Postgres (blueprint section 11) when there is more than one worker.
export class FileCaseStore {
  constructor(readonly dataDir: string) {}

  caseDir(id: string): string {
    return join(this.dataDir, "cases", id);
  }

  async save(record: CaseRecord): Promise<void> {
    const dir = this.caseDir(record.id);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, "case.json.tmp");
    await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await rename(tmp, join(dir, "case.json"));
  }

  // Accepts a full id or a unique prefix (the CLI prints 8-character ids).
  async load(idOrPrefix: string): Promise<CaseRecord> {
    const matches = (await this.list()).filter((id) => id.startsWith(idOrPrefix));
    if (matches.length > 1) throw new Error(`Case id "${idOrPrefix}" is ambiguous`);
    try {
      return JSON.parse(await readFile(join(this.caseDir(matches[0] ?? idOrPrefix), "case.json"), "utf8"));
    } catch {
      throw new Error(`Case ${idOrPrefix} not found in ${this.dataDir}`);
    }
  }

  async list(): Promise<string[]> {
    try {
      return await readdir(join(this.dataDir, "cases"));
    } catch {
      return [];
    }
  }
}
