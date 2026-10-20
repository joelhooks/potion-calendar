import { Schema } from "effect";

export class UnsupportedRecurrenceSplit extends Schema.TaggedError<UnsupportedRecurrenceSplit>()(
  "UnsupportedRecurrenceSplit",
  {
    reason: Schema.Literals([
      "multipleRules",
      "rdate",
      "countWithExdate",
      "invalidCount",
    ]),
  }
) {}
