import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const GooglePushChannels = sqliteTable(
  "google_push_channel",
  {
    accountId: text("account_id").notNull(),
    calendarId: text("calendar_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["events", "calendarList"] }).notNull(),
    personId: text("person_id").notNull(),
    predecessorId: text("predecessor_id"),
    resourceId: text("resource_id"),
    state: text("state", {
      enum: ["pending", "active", "stopping", "stopped", "orphaned"],
    }).notNull(),
    tokenHash: text("token_hash").notNull(),
  },
  (table) => [
    index("google_push_person_page")
      .on(table.personId, table.id)
      .where(sql`${table.state} IN ('pending', 'active', 'stopping')`),
    index("google_push_expiration").on(table.expiresAt, table.id),
    uniqueIndex("google_push_active_resource")
      .on(
        table.personId,
        table.accountId,
        table.kind,
        sql`coalesce(${table.calendarId}, '')`
      )
      .where(sql`${table.state} = 'active'`),
    check(
      "google_push_calendar_kind",
      sql`(${table.kind} = 'events' AND ${table.calendarId} IS NOT NULL) OR (${table.kind} = 'calendarList' AND ${table.calendarId} IS NULL)`
    ),
  ]
);
