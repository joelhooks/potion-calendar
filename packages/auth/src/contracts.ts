import { Schema } from "effect";

export const ProfileUpdateInput = Schema.Struct({ name: Schema.String });

const profileNameSegments = new Intl.Segmenter("und", {
  granularity: "grapheme",
});

export const ProfileName = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (name) => [...profileNameSegments.segment(name)].length <= 100
  )
);

export const normalizeProfileName = (name: string) =>
  Schema.decodeOption(ProfileName)(name.trim());
