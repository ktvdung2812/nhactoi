import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { serialQueue } from "./serial";
const serialize = serialQueue();
let database: Promise<SQLite.SQLiteDatabase> | undefined;
function db() {
  return (database ??= (async () => {
    let key = await SecureStore.getItemAsync("nhactoi.cache.key");
    if (!key) {
      key = Array.from(await Crypto.getRandomBytesAsync(32))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      await SecureStore.setItemAsync("nhactoi.cache.key", key);
    }
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Khóa dữ liệu trên thiết bị không hợp lệ.");
    const connection = await SQLite.openDatabaseAsync("nhactoi-cache.db");
    await connection.execAsync(
      `PRAGMA key = "x'${key}'"; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS cache(scope TEXT NOT NULL,path TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,path));`,
    );
    return connection;
  })());
}
export async function cacheRead<T>(
  scope: string,
  path: string,
): Promise<{ value: T; updatedAt: number } | null> {
  return serialize(async () => {
    const row = await (
      await db()
    ).getFirstAsync<{ payload: string; updated_at: number }>(
      "SELECT payload,updated_at FROM cache WHERE scope=? AND path=?",
      scope,
      path,
    );
    return row
      ? { value: JSON.parse(row.payload), updatedAt: row.updated_at }
      : null;
  });
}
export async function cacheWrite(scope: string, path: string, value: unknown) {
  return serialize(async () => {
    await (
      await db()
    ).runAsync(
      "INSERT OR REPLACE INTO cache VALUES (?,?,?,?)",
      scope,
      path,
      JSON.stringify(value),
      Date.now(),
    );
  });
}
export async function cacheClear(scope?: string) {
  return serialize(async () => {
    const connection = await db();
    if (scope)
      await connection.runAsync("DELETE FROM cache WHERE scope=?", scope);
    else
      await connection.execAsync(
        "DELETE FROM cache; PRAGMA wal_checkpoint(TRUNCATE);",
      );
  });
}
