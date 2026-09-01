import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PolicyError } from "./errors.js";
import { stableJson } from "./stable-json.js";
import type { RecoverySnapshot } from "./types.js";

export async function writeSnapshot(path: string, snapshot: RecoverySnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableJson(snapshot), { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function readSnapshot(path: string): Promise<RecoverySnapshot> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new PolicyError("recovery snapshot is missing", "SNAPSHOT_MISSING", { cause: error });
  }
  try {
    return JSON.parse(raw) as RecoverySnapshot;
  } catch (error) {
    throw new PolicyError("recovery snapshot is not valid JSON", "SNAPSHOT_INVALID", {
      cause: error
    });
  }
}
