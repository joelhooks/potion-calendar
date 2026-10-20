import { Schema } from "effect";

export class NotConnected extends Schema.TaggedError<NotConnected>()(
  "NotConnected",
  {
    accountId: Schema.String,
  }
) {}
