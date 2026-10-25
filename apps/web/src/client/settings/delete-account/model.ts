import { Option, Schema } from "effect";

export const AccountDeletionUi = Schema.Struct({
  error: Schema.Option(Schema.String),
  mode: Schema.Literals([
    "closed",
    "confirming",
    "deleting",
    "failed",
    "deleted",
  ]),
  personId: Schema.Option(Schema.String),
  proof: Schema.Option(Schema.String),
  sequence: Schema.Int,
});

export const AccountDeletionChange = Schema.TaggedUnion({
  Cancel: {},
  Confirm: {},
  Open: {},
});

export const AccountDeletionReply = Schema.TaggedUnion({
  Deleted: {},
  Failed: {},
});

export const initialAccountDeletion = (
  sequence = 0
): typeof AccountDeletionUi.Type => ({
  error: Option.none(),
  mode: "closed",
  personId: Option.none(),
  proof: Option.none(),
  sequence,
});
