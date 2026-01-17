import { Pool } from "pg";

let pool: Pool | null = null;

export function hasDatabaseUrl(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

export function getDbPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Missing env: DATABASE_URL");
  }

  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

export async function dbQuery<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
  const p = getDbPool();
  const res = await p.query(text, params as never);
  return { rows: res.rows as T[] };
}
