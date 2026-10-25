ALTER TABLE "user" ADD COLUMN "primaryCalendarAccountId" TEXT REFERENCES "account" ("id") ON DELETE SET NULL;
