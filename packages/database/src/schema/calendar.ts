import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const CalendarSnapshots = sqliteTable(
  "calendar_snapshot",
  {
    accountId: text("account_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    cursor: text("cursor"),
    personId: text("person_id").notNull(),
    revision: integer("revision").notNull().default(0),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.personId, table.accountId, table.calendarId],
    }),
  ]
);

export const CalendarRanges = sqliteTable(
  "calendar_range",
  {
    accountId: text("account_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    end: text("range_end").notNull(),
    events: text("events").notNull(),
    expiresAt: integer("expires_at").notNull(),
    personId: text("person_id").notNull(),
    start: text("range_start").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.personId,
        table.accountId,
        table.calendarId,
        table.version,
        table.start,
        table.end,
      ],
    }),
  ]
);
