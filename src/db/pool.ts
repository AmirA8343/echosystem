import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is not set. DB-backed endpoints will fail until configured.");
}

export const pool = new Pool(
  connectionString
    ? {
        connectionString,
      }
    : undefined
);
