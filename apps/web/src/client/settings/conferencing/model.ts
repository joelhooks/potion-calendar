import { Option, Schema } from "effect";

import { UserDefaultConferencing, deskDefaultConferencing } from "./default.js";

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

export const CustomVideoDraft = Schema.Struct({
  id: Schema.Option(Schema.NonEmptyString),
  link: Schema.String,
  name: Schema.String,
});

export const CustomVideoErrors = Schema.Struct({
  link: Schema.Option(Schema.String),
  name: Schema.Option(Schema.String),
});

export const ConferencingSettings = Schema.Struct({
  defaultConferencing: UserDefaultConferencing,
  defaultError: Schema.Option(Schema.String),
  draft: CustomVideoDraft,
  entries: CustomVideoLinks,
  error: Schema.Option(Schema.String),
  errors: CustomVideoErrors,
  mode: Schema.Literals([
    "listing",
    "editing",
    "saving",
    "removing",
    "savingDefault",
  ]),
  pendingDefault: Schema.Option(UserDefaultConferencing),
  requestId: Schema.Int,
});

export const initialConferencingSettings = (
  requestId = 0
): typeof ConferencingSettings.Type => ({
  defaultConferencing: deskDefaultConferencing,
  defaultError: Option.none(),
  draft: { id: Option.none(), link: "", name: "" },
  entries: [],
  error: Option.none(),
  errors: { link: Option.none(), name: Option.none() },
  mode: "listing",
  pendingDefault: Option.none(),
  requestId,
});

export const normalizedVideoLink = (value: string): Option.Option<string> => {
  const text = value.trim();
  const parsed = Schema.decodeOption(Schema.URLFromString)(text);

  const candidate = Option.orElse(parsed, () =>
    Schema.decodeOption(Schema.URLFromString)(`https://${text}`)
  );

  return candidate.pipe(
    Option.flatMap((url) =>
      Schema.decodeOption(WebUrl)(url.href).pipe(Option.map((web) => web.href))
    )
  );
};

export const validateVideoDraft = (draft: typeof CustomVideoDraft.Type) => {
  const name = Schema.decodeOption(Schema.NonEmptyString)(draft.name.trim());

  const link =
    draft.link.trim() === ""
      ? Option.none<string>()
      : normalizedVideoLink(draft.link);

  return {
    errors: {
      link: Option.isSome(link)
        ? Option.none<string>()
        : Option.some(
            draft.link.trim() === ""
              ? "Conferencing link is required"
              : "Must be a valid URL"
          ),
      name: Option.isSome(name)
        ? Option.none<string>()
        : Option.some("Name is required"),
    },
    value: Option.zipWith(name, link, (displayName, href) => ({
      link: href,
      name: displayName,
    })),
  };
};

export const ConferencingSettingsChange = Schema.TaggedUnion({
  Add: {},
  Cancel: {},
  Default: { value: UserDefaultConferencing },
  DefaultFailed: { message: Schema.String, requestId: Schema.Int },
  DefaultSaved: { requestId: Schema.Int, value: UserDefaultConferencing },
  Edit: { id: Schema.NonEmptyString },
  Failed: { message: Schema.String, requestId: Schema.Int },
  Link: { value: Schema.String },
  Name: { value: Schema.String },
  Remove: { id: Schema.NonEmptyString },
  Save: {},
  Saved: { entries: CustomVideoLinks, requestId: Schema.Int },
});

export const CustomVideoWrite = Schema.TaggedUnion({
  Remove: { id: Schema.NonEmptyString },
  Save: {
    id: Schema.Option(Schema.NonEmptyString),
    link: CustomVideoLink.fields.link,
    name: CustomVideoLink.fields.name,
  },
});
