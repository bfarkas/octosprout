/**
 * A small JSON file in the state directory, written atomically with mode 0600.
 * State here (sessions, credentials) is replaceable and never lives in Git (spec §2.8).
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class StateFile<T> {
  constructor(
    private readonly path: string,
    private readonly empty: () => T,
  ) {}

  load(): T {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.empty();
      throw error;
    }
  }

  save(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }
}
