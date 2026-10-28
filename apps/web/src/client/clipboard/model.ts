import {
  Calendar,
  EventFields,
  EventRef,
  Reminder,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import { NavigationState } from "../../layout/navigation.js";
import { EditorConferencingContext } from "../editing/conferencing-draft.js";

export const ClipboardCreationFields = Schema.Struct({
  attachments: EventFields.fields.attachments,
  guestsCanInviteOthers: EventFields.fields.guestsCanInviteOthers,
  guestsCanModify: EventFields.fields.guestsCanModify,
  guestsCanSeeOtherGuests: EventFields.fields.guestsCanSeeOtherGuests,
  transparency: EventFields.fields.transparency,
  visibility: EventFields.fields.visibility,
});

export const ClipboardGuest = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  email: Schema.String,
  optional: Schema.Boolean,
  resource: Schema.Boolean,
});

export const ClipboardContent = Schema.Struct({
  colorId: Schema.NullOr(Schema.String),
  description: Schema.String,
  location: Schema.String,
  reminders: Schema.Struct({
    overrides: Schema.Array(Reminder),
    useDefault: Schema.Boolean,
  }),
  title: Schema.String,
});

export const ClipboardRange = Schema.TaggedUnion({
  AllDay: { end: Schema.String, start: Schema.String },
  Timed: { end: Schema.Finite, start: Schema.Finite },
});

export const ClipboardItem = Schema.Struct({
  content: ClipboardContent,
  creationFields: ClipboardCreationFields,
  guests: Schema.Array(ClipboardGuest),
  guestsComplete: Schema.Boolean,
  nativeConference: Schema.Boolean,
  range: ClipboardRange,
  recurring: Schema.Boolean,
  source: EventRef,
});

export const ClipboardEnvelope = Schema.Struct({
  id: Schema.NonEmptyString,
  items: Schema.NonEmptyArray(ClipboardItem),
  personId: Schema.NonEmptyString,
  selectionKeys: Schema.optional(Schema.NonEmptyArray(Schema.NonEmptyString)),
  version: Schema.Literal(1),
});

export const ClipboardAnchor = Schema.TaggedUnion({
  AllDay: {
    date: Schema.String,
    origin: Schema.optional(Schema.Literal("month")),
  },
  Timed: { date: Schema.String, instant: Schema.Finite },
});

export const ClipboardGuestChoice = Schema.Literals([
  "exclude",
  "includeAndEmail",
]);

export const ClipboardTemplate = Schema.Struct({
  content: ClipboardContent,
  creationFields: ClipboardCreationFields,
  guestChoice: ClipboardGuestChoice,
  guests: Schema.Array(ClipboardGuest),
  intentId: Schema.NonEmptyString,
});

export const ClipboardPasteMetadata = Schema.Struct({
  creationFields: ClipboardCreationFields,
  intentId: Schema.NonEmptyString,
  sendUpdates: Schema.Literals(["all", "none"]),
});

export const ClipboardRefusalPresentation = Schema.Struct({
  locale: Schema.NonEmptyString,
  timeFormat: Schema.Literals(["12", "24"]),
});

export const deskDefaultClipboardRefusalPresentation: typeof ClipboardRefusalPresentation.Type =
  {
    locale: "en-US",
    timeFormat: "12",
  };

export const ClipboardPasteTarget = Schema.Struct({
  calendar: Calendar,
  conferencingContext: Schema.optional(EditorConferencingContext),
  navigation: NavigationState,
  primaryZone: Schema.String,
  refusalPresentation: Schema.optionalKey(ClipboardRefusalPresentation),
  selection: Schema.Option(Schema.String),
});

export const ClipboardIdentity = Schema.Struct({
  id: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
});

export const ClipboardMemberIssue = Schema.Struct({
  key: Schema.NonEmptyString,
  reason: Schema.String,
  sentence: Schema.optional(Schema.String),
  title: Schema.String,
});

export const ClipboardToast = Schema.Struct({
  id: Schema.NonEmptyString,
  message: Schema.String,
});

const viewFields = {
  copied: Schema.Option(ClipboardIdentity),
  toast: Schema.Option(ClipboardToast),
};

export const ClipboardView = Schema.TaggedUnion({
  Creating: {
    ...viewFields,
    intentId: Schema.String,
    itemCount: Schema.optional(Schema.Int),
  },
  Failure: {
    ...viewFields,
    intentId: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  },
  Guests: {
    ...viewFields,
    calendarTitle: Schema.String,
    complete: Schema.Boolean,
    count: Schema.Int,
    intentId: Schema.String,
    itemCount: Schema.optional(Schema.Int),
    title: Schema.String,
  },
  Idle: viewFields,
  Preparing: {
    ...viewFields,
    intentId: Schema.String,
    itemCount: Schema.optional(Schema.Int),
  },
  Results: {
    ...viewFields,
    id: Schema.String,
    issues: Schema.Array(ClipboardMemberIssue),
    succeeded: Schema.Int,
  },
});

export const initialClipboardView = ClipboardView.cases.Idle.make({
  copied: Option.none(),
  toast: Option.none(),
});

export const ClipboardUi = Schema.Struct({
  epoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  receiptRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sessionId: Schema.Option(Schema.String),
  view: ClipboardView,
});

export const initialClipboard = ClipboardUi.make({
  epoch: 0,
  receiptRevision: 0,
  sessionId: Option.none(),
  view: initialClipboardView,
});

export const resetClipboardScope = (previous: typeof ClipboardUi.Type) =>
  ClipboardUi.make({ ...initialClipboard, epoch: previous.epoch + 1 });

export class ClipboardInputFailure extends Schema.TaggedError<ClipboardInputFailure>()(
  "ClipboardInputFailure",
  {
    message: Schema.String,
    reason: Schema.Literals([
      "invalidRange",
      "unsupportedEvent",
      "incompleteGuests",
      "missingTime",
      "ambiguousTime",
      "invalidTemplate",
      "nativeUnavailable",
      "personMismatch",
      "creationUnconfirmed",
      "noWritableCalendar",
      "missingSource",
      "readOnlySource",
      "incompleteSelection",
      "mixedRanges",
    ]),
    source: Schema.optionalKey(EventRef),
  }
) {}

const nativeFields = {
  personId: Schema.NonEmptyString,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sessionId: Schema.NonEmptyString,
};

export const NativeClipboardNotice = Schema.TaggedUnion({
  Copied: {
    ...nativeFields,
    envelope: ClipboardEnvelope,
    mode: Schema.Literals(["copy", "cut"]),
    selfEmails: Schema.optional(Schema.Array(Schema.String)),
  },
  Invalidated: { ...nativeFields, copyId: Schema.NonEmptyString },
  Paste: {
    ...nativeFields,
    anchor: ClipboardAnchor,
    copyId: Schema.NonEmptyString,
    target: ClipboardPasteTarget,
  },
  Refused: {
    ...nativeFields,
    failure: ClipboardInputFailure,
    operation: Schema.Literals(["copy", "cut", "paste"]),
  },
});

export const ClipboardCaptureResult = Schema.TaggedUnion({
  Captured: { item: ClipboardItem },
  Refused: { failure: ClipboardInputFailure },
});
