import { Schema } from "effect";

export const VisibilityChoices = Schema.Record(Schema.String, Schema.Boolean);

export const VisibilityMigration = Schema.TaggedUnion({
  Accounts: { ids: Schema.Array(Schema.String) },
  Current: {},
  Legacy: {},
});

export type VisibilityChoicesValue = typeof VisibilityChoices.Type;

export type VisibilityMigrationValue = typeof VisibilityMigration.Type;
