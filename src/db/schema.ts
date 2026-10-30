import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const artists = sqliteTable("watch_artists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalized: text("normalized").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const settings = sqliteTable("bot_settings", {
  id: integer("id").primaryKey(),
  email: text("email").notNull().default(""),
  notifications: integer("notifications").notNull().default(0),
  countries: text("countries").notNull().default('["BR"]'),
  schedule: text("schedule").notNull().default("pending"),
});
export const events = sqliteTable("show_events", {
  id: text("id").primaryKey(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  country: text("country").notNull(),
  city: text("city").notNull().default(""),
  startsAt: text("starts_at").notNull().default(""),
  url: text("url").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("unverified"),
  notified: integer("notified").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const imports = sqliteTable("music_imports", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  phase: text("phase").notNull().default("pending"),
  expires: integer("expires").notNull(),
  candidates: text("candidates").notNull().default("[]"),
});
export const scans = sqliteTable("scan_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  newEvents: integer("new_events").notNull().default(0),
  warnings: text("warnings").notNull().default("[]"),
});

export const preferenceConfirmations = sqliteTable("preference_confirmations", {
  id: text("id").primaryKey(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  email: text("email").notNull(),
  snapshot: text("snapshot").notNull(),
  status: text("status").notNull().default("pending"),
  messageId: text("message_id").notNull().default(""),
  lastError: text("last_error").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sentAt: text("sent_at"),
});
