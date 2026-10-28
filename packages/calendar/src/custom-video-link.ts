import { Option, Schema } from "effect";

const WebUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) => url.protocol === "https:" || url.protocol === "http:"
  )
);

export const CustomVideoLink = Schema.Struct({
  id: Schema.NonEmptyString,
  link: Schema.String.check(
    Schema.makeFilter((value) =>
      Option.isSome(Schema.decodeOption(WebUrl)(value))
    )
  ),
  name: Schema.NonEmptyString,
});

export const CustomVideoLinks = Schema.Array(CustomVideoLink).check(
  Schema.makeFilter(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length
  )
);

export const CustomVideoReference = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.Literal("customLink"),
});

export const customVideoReference = Schema.is(CustomVideoReference);

export const accountCustomLinkStorage = "person-scoped-d1-catalog";

export const accountCustomDefaultStorage = "side-table-with-none-shadow";

export const accountCustomLinkRemoval = "clear-to-none-atomically";

export const accountCustomLinkEdit = "follow-stable-id";

export const accountCustomLinkPlacement =
  "append-description-preserve-location";

export const customLinkImportConflict = "d1-wins-including-tombstones";

const isTextBoundary = (text: string, index: number) =>
  index < 0 || index >= text.length || /\s/u.test(text.charAt(index));

const containsBoundedText = (text: string, value: string): boolean => {
  if (value === "") {
    return false;
  }

  let index = text.indexOf(value);

  while (index !== -1) {
    if (
      isTextBoundary(text, index - 1) &&
      isTextBoundary(text, index + value.length)
    ) {
      return true;
    }

    index = text.indexOf(value, index + value.length);
  }

  return false;
};

export const appendCustomVideoLink = (
  description: string | undefined,
  link: string
): string => {
  const text = description ?? "";
  const forms = [link, `<${link}>`, `"${link}"`, `'${link}'`];

  if (forms.some((form) => containsBoundedText(text, form))) {
    return text;
  }

  return text === "" ? link : `${text}\n${link}`;
};
