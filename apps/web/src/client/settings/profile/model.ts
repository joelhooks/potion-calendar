import { normalizeProfileName, ProfileName } from "@calendar/auth/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { Option, Predicate, Schema } from "effect";
import { UrlRequest } from "foldkit/navigation";

import { Route } from "../../../layout/route.js";

export const profileSaveFailureMessage =
  "Your update could not be confirmed. Your changes are still here.";

export const ProfileExit = Schema.TaggedUnion({
  Back: {},
  Route: { replace: Schema.Boolean, route: Route },
  Url: { request: UrlRequest },
});

export const ProfileUi = Schema.Struct({
  draft: Schema.String,
  error: Schema.Option(Schema.String),
  exit: Schema.Option(ProfileExit),
  mode: Schema.Literals([
    "idle",
    "loading",
    "load-failed",
    "pristine",
    "editing",
    "saving",
    "confirming",
  ]),
  personId: Schema.Option(Schema.String),
  savedName: Schema.String,
  sequence: Schema.Int,
  validation: Schema.Option(Schema.String),
});

export const ProfileChange = Schema.TaggedUnion({
  Continue: {},
  Discard: {},
  Name: { value: Schema.String },
  Retry: {},
  Save: {},
});

export const ProfileWork = Schema.TaggedUnion({
  Read: {},
  Save: { name: ProfileName },
});

export const ProfileReply = Schema.TaggedUnion({
  Failed: { message: Schema.String },
  Loaded: { snapshot: SessionSnapshot },
  Saved: { name: ProfileName },
});

export const initialProfile = (sequence = 0): typeof ProfileUi.Type => ({
  draft: "",
  error: Option.none(),
  exit: Option.none(),
  mode: "idle",
  personId: Option.none(),
  savedName: "",
  sequence,
  validation: Option.none(),
});

export const profileRoute = (route: typeof Route.Type): boolean =>
  Predicate.isTagged(route, "Settings") && route.page === "profile";

export const profileDirty = (state: typeof ProfileUi.Type): boolean =>
  (state.mode === "editing" || state.mode === "confirming") &&
  state.draft !== state.savedName;

export const profileNameError = (draft: string): Option.Option<string> =>
  Option.isSome(normalizeProfileName(draft))
    ? Option.none()
    : Option.some(
        draft.trim() === ""
          ? "Full name is required."
          : "Use 100 characters or fewer."
      );

const HttpsImage = Schema.URLFromString.check(
  Schema.makeFilter((url) => url.protocol === "https:")
);

export const profileImage = (
  image: string | undefined
): Option.Option<string> =>
  Schema.decodeUnknownOption(HttpsImage)(image).pipe(
    Option.map((url) => url.href)
  );

const initialsSegments = new Intl.Segmenter("und", { granularity: "grapheme" });

export const profileInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(
      (part) =>
        [...initialsSegments.segment(part)][0]?.segment.toLocaleUpperCase() ??
        ""
    )
    .join("") || "?";
