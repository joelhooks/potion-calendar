import { Schema } from "effect";

export const monthDayFromText = Schema.decodeUnknownOption(
  Schema.NumberFromString.check(Schema.isInt())
);
