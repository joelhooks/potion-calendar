import { Effect, Option, Predicate, Schema } from "effect";
import type { SchemaAST } from "effect";

export const trayLocationByteLimit = 512;

export const trayAttachmentTitleByteLimit = 256;

export const trayAttachmentUrlByteLimit = 8192;

export const trayDetailsByteLimit = 256 * 1024;

const trayEncoder = new TextEncoder();

// oxlint-disable-next-line eslint/no-control-regex -- Native menu labels must not carry controls or bidi direction overrides.
const menuControls = /[\u0000-\u001F\u007F-\u009F\p{Bidi_Control}]/gu;

export const trayPlainText = (value: string): string =>
  value.replaceAll(menuControls, " ").replaceAll(/\s+/gu, " ").trim();

export const trayDisplayText = (value: string, maximum: number): string => {
  let label = "";
  let size = 0;

  for (const character of trayPlainText(value)) {
    const next = trayEncoder.encode(character).byteLength;

    if (size + next > maximum) {
      break;
    }

    label += character;
    size += next;
  }

  return label;
};

export const TrayAttachmentUrl = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const parsed = URL.parse(value);

    return (
      trayEncoder.encode(value).byteLength <= trayAttachmentUrlByteLimit &&
      // oxlint-disable-next-line eslint/no-control-regex -- Reject control bytes before URL parsing can discard them in an external attachment handoff.
      !/[\s\u0000-\u001F\u007F-\u009F\\]/u.test(value) &&
      parsed !== null &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  })
);

const TrayLabel = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      value === trayPlainText(value) &&
      trayEncoder.encode(value).byteLength <= trayAttachmentTitleByteLimit
  )
);

export const TrayDetails = Schema.Struct({
  attachments: Schema.Array(
    Schema.Struct({
      index: Schema.Int.check(Schema.isBetween({ maximum: 19, minimum: 0 })),
      title: TrayLabel,
      url: TrayAttachmentUrl,
    })
  ).check(Schema.isMaxLength(20)),
  email: Schema.NullOr(
    Schema.Struct({
      href: Schema.String.check(
        Schema.isMaxLength(2000),
        Schema.makeFilter((value: string) => {
          const parsed = URL.parse(value);

          return (
            parsed !== null &&
            parsed.protocol === "mailto:" &&
            parsed.username === "" &&
            parsed.password === "" &&
            parsed.pathname.includes("@") &&
            !/%0[ad]/iu.test(value)
          );
        })
      ),
      recipientCount: Schema.Int.check(
        Schema.isBetween({ maximum: 2000, minimum: 1 })
      ),
    })
  ),
  location: Schema.NullOr(
    Schema.String.check(
      Schema.makeFilter(
        (value: string) =>
          value === trayPlainText(value) &&
          trayEncoder.encode(value).byteLength <= trayLocationByteLimit
      )
    )
  ),
  version: Schema.Literal(1),
}).check(
  Schema.makeFilter(
    (value) =>
      trayEncoder.encode(JSON.stringify(value)).byteLength <=
      trayDetailsByteLimit
  )
);

export type TrayDetailsValue = typeof TrayDetails.Type;

type TrayEmailSource =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "ready";
      readonly href: string;
      readonly recipients: readonly string[];
    };

export const projectTrayDetails = (
  location: string | undefined,
  attachments: readonly { readonly title: string; readonly url: string }[],
  email: TrayEmailSource
): TrayDetailsValue => {
  const label = trayDisplayText(location ?? "", trayLocationByteLimit);

  let result: TrayDetailsValue = {
    attachments: [],
    email:
      email.kind === "ready"
        ? { href: email.href, recipientCount: email.recipients.length }
        : null,
    location: label.length > 0 ? label : null,
    version: 1,
  };

  for (const [index, attachment] of attachments.slice(0, 20).entries()) {
    if (!Schema.is(TrayAttachmentUrl)(attachment.url)) {
      continue;
    }

    const next = {
      ...result,
      attachments: [
        ...result.attachments,
        {
          index,
          title:
            trayDisplayText(attachment.title, trayAttachmentTitleByteLimit) ||
            "Attachment",
          url: attachment.url,
        },
      ],
    };

    if (Schema.is(TrayDetails)(next)) {
      result = next;
    }
  }

  return result;
};

export const icsSaveByteLimit = 4 * 1024 * 1024;

export const icsSaveWireLimit = 8 * 1024 * 1024;

export const icsSaveNameLimit = 128;

export const icsSaveParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const encoder = new TextEncoder();

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const IcsSuggestedName = Schema.String.check(
  Schema.isMaxLength(icsSaveNameLimit),
  Schema.isPattern(/^[\p{L}\p{N}][\p{L}\p{N}-]*\.ics$/u),
  Schema.makeFilter(
    (name) =>
      encoder.encode(name).byteLength <= icsSaveNameLimit &&
      !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\.ics$/iu.test(name)
  )
);

export const desktopIcsFilename = (filename: string): string => {
  let stem = "";
  let size = 4;

  for (const character of filename.endsWith(".ics")
    ? filename.slice(0, -4)
    : "") {
    const next = encoder.encode(character).byteLength;

    if (size + next > icsSaveNameLimit) {
      break;
    }

    stem += character;
    size += next;
  }

  const suggested = `${stem.replace(/-+$/u, "")}.ics`;

  return Schema.is(IcsSuggestedName)(suggested) ? suggested : "events.ics";
};

export const IcsCalendarBytes = Schema.Uint8Array.check(
  Schema.isMaxLength(icsSaveByteLimit),
  Schema.makeFilter((bytes) => {
    try {
      const text = decoder.decode(bytes);

      return (
        text.startsWith("BEGIN:VCALENDAR\r\n") &&
        text.endsWith("END:VCALENDAR\r\n") &&
        text.includes("\r\nVERSION:2.0\r\n") &&
        !text.includes("\u0000")
      );
    } catch {
      return false;
    }
  })
);

export const IcsSaveRequest = Schema.Struct({
  bytes: IcsCalendarBytes,
  suggestedName: IcsSuggestedName,
});

export const IcsSaveFailureReason = Schema.Literals([
  "busy",
  "dialog",
  "invalid",
  "transport",
  "tooLarge",
  "unavailable",
  "untrusted",
  "write",
]);

export const IcsSaveOutcome = Schema.TaggedUnion({
  Cancelled: {},
  Failed: { reason: IcsSaveFailureReason },
  Saved: {},
});

const transport = Schema.Struct({
  ...IcsSaveRequest.fields,
  bytes: Schema.Uint8ArrayFromBase64.pipe(Schema.decodeTo(IcsCalendarBytes)),
});

const icsSaveWire = Schema.String.check(
  Schema.isMaxLength(icsSaveWireLimit),
  Schema.makeFilter(
    (message) => encoder.encode(message).byteLength <= icsSaveWireLimit
  )
).pipe(Schema.decodeTo(Schema.fromJsonString(transport)));

export type Navigation = "window" | "browser" | "deny";

export const navigation = (target: string, origin: string): Navigation => {
  const url = URL.parse(target);

  if (url === null || url.username !== "" || url.password !== "") {
    return "deny";
  }

  if (
    url.origin === origin &&
    (url.protocol === "https:" || url.protocol === "http:")
  ) {
    return "window";
  }

  return url.protocol === "https:" || url.protocol === "mailto:"
    ? "browser"
    : "deny";
};

export const AgendaKey = Schema.Struct({
  accountId: Schema.NonEmptyString,
  calendarId: Schema.NonEmptyString,
  eventId: Schema.NonEmptyString,
});

export const sameDesktopEventKey = (
  left: typeof AgendaKey.Type,
  right: typeof AgendaKey.Type
): boolean =>
  left.accountId === right.accountId &&
  left.calendarId === right.calendarId &&
  left.eventId === right.eventId;

export const ConferenceUrl = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const url = URL.parse(value);

    return (
      url !== null &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    );
  })
);

export const PromptAttachment = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
});

export const eligiblePromptAttachments = (
  attachments: readonly (typeof PromptAttachment.Type)[],
  origin?: string
): readonly (typeof PromptAttachment.Type)[] =>
  origin === undefined || !Predicate.isFunction(URL.parse?.bind(URL))
    ? []
    : attachments
        .filter(
          (attachment) =>
            URL.parse(attachment.url)?.protocol === "https:" &&
            navigation(attachment.url, origin) === "browser"
        )
        .slice(0, 20);

export const AgendaEvent = Schema.Struct({
  allDay: Schema.Boolean,
  attachments: Schema.optional(
    Schema.Array(PromptAttachment).check(Schema.isMaxLength(20))
  ),
  calendarColor: Schema.String,
  conferenceUrl: Schema.NullOr(ConferenceUrl),
  end: Schema.Finite,
  hasLocation: Schema.Boolean,
  hasParticipants: Schema.Boolean,
  key: AgendaKey,
  participantEmails: Schema.optional(Schema.Array(Schema.String)),
  responseStatus: Schema.Literals([
    "accepted",
    "declined",
    "tentative",
    "needsAction",
  ]),
  rsvp: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      response: Schema.NullOr(
        Schema.Literals(["accepted", "declined", "tentative", "needsAction"])
      ),
    })
  ),
  start: Schema.Finite,
  title: Schema.String,
  trayDetails: Schema.optional(TrayDetails),
}).check(Schema.makeFilter((event) => event.end > event.start));

const modifiers = new Set([
  "alt",
  "cmd",
  "cmdorctrl",
  "command",
  "commandorcontrol",
  "control",
  "ctrl",
  "meta",
  "option",
  "shift",
  "super",
]);

export const GlobalShortcut = Schema.NullOr(
  Schema.String.check(
    Schema.makeFilter((value: string) => {
      const parts = value.toLowerCase().split("+");
      const key = parts.at(-1);

      return (
        value.trim() === value &&
        parts.length > 1 &&
        key !== undefined &&
        key !== "" &&
        !modifiers.has(key) &&
        parts.slice(0, -1).some((part) => modifiers.has(part))
      );
    })
  )
);

export const PromptPlacement = Schema.Struct({
  anchor: Schema.Literal("topCenter"),
  display: Schema.Literals(["cursor", "primary"]),
});

export const PromptPreferences = Schema.Struct({
  joinShortcut: GlobalShortcut,
  placement: Schema.optional(PromptPlacement).pipe(
    Schema.catchDecoding(() => Effect.succeedNone)
  ),
  theme: Schema.Literals(["light", "dark"]),
  timeFormat: Schema.Literals(["12", "24"]),
  version: Schema.Literal(1),
});

const optionalPromptPreferences = Schema.optional(PromptPreferences).pipe(
  Schema.catchDecoding(() => Effect.succeedNone)
);

const nativeNotificationInstant = Schema.Finite.check(
  Schema.makeFilter((value) => !Object.is(value, -0))
);

const nativeNotificationSequence = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.makeFilter((value) => !Object.is(value, -0))
);

export const NativeNotificationEventRef = Schema.Struct({
  body: Schema.String,
  conferenceUrl: Schema.NullOr(ConferenceUrl),
  end: nativeNotificationInstant,
  key: AgendaKey,
  participantEmails: Schema.Array(Schema.String),
  rsvp: Schema.Boolean,
  start: nativeNotificationInstant,
  title: Schema.String,
});

export const NativeNotificationAgenda = Schema.Struct({
  deliveries: Schema.Array(
    Schema.Struct({
      beforeStart: Schema.optional(Schema.Boolean),
      id: Schema.String,
      key: AgendaKey,
      kind: Schema.Literals(["reminder", "invite"]),
      snoozedUntil: Schema.optional(nativeNotificationInstant),
      start: nativeNotificationInstant,
    })
  ),
  events: Schema.Array(NativeNotificationEventRef),
  lease: Schema.String.check(Schema.isMinLength(1)),
  personId: Schema.NullOr(Schema.String),
  revision: nativeNotificationSequence,
  version: Schema.Literal(1),
});

export const AgendaSnapshot = Schema.Struct({
  events: Schema.Array(AgendaEvent),
  notificationAgenda: Schema.optional(NativeNotificationAgenda).pipe(
    Schema.catchDecoding(() => Effect.succeedNone)
  ),
  promptPreferences: optionalPromptPreferences,
});

export const NativeNotificationAction = Schema.Literals([
  "join",
  "email",
  "show",
  "accepted",
  "declined",
  "tentative",
]);

export const NativeNotificationRef = Schema.Struct({
  generation: nativeNotificationSequence,
  id: Schema.String,
  key: AgendaKey,
  kind: Schema.Literals(["reminder", "invite"]),
  lease: Schema.String,
  personId: Schema.String,
  revision: nativeNotificationSequence,
  start: nativeNotificationInstant,
});

export const nativeReminderSnoozeMinutes = [1, 5, 15, 30, 60, 1440] as const;

export const NativeReminderSnoozeChoice = Schema.Literals([
  ...nativeReminderSnoozeMinutes,
  "start",
]);

export const NativeReminderSnoozeOutcome = Schema.Literals([
  "accepted",
  "refused",
  "failed",
]);

export const NativeNotificationRequest = Schema.TaggedUnion({
  Close: {
    refs: Schema.Array(NativeNotificationRef),
    version: Schema.Literal(1),
  },
  Prepare: {
    id: Schema.optional(Schema.String),
    snapshot: AgendaSnapshot,
    version: Schema.Literal(1),
  },
  Replace: { ref: NativeNotificationRef, version: Schema.Literal(1) },
  Show: { ref: NativeNotificationRef, version: Schema.Literal(1) },
  SnoozeResult: {
    outcome: NativeReminderSnoozeOutcome,
    ref: NativeNotificationRef,
    version: Schema.Literal(1),
  },
});

export const NativeNotificationReply = Schema.Struct({
  authority: Schema.optional(
    Schema.Struct({
      lease: Schema.String,
      personId: Schema.NullOr(Schema.String),
      revision: nativeNotificationSequence,
    })
  ),
  claims: Schema.Array(
    Schema.Struct({ key: AgendaKey, start: nativeNotificationInstant })
  ),
  ref: Schema.optional(NativeNotificationRef),
  status: Schema.Literals([
    "ready",
    "refused",
    "failed",
    "stale",
    "superseded",
  ]),
  version: Schema.Literal(1),
});

export const NativeNotificationNotice = Schema.TaggedUnion({
  ActionSelected: {
    action: NativeNotificationAction,
    ref: NativeNotificationRef,
  },
  Clicked: { ref: NativeNotificationRef },
  Closed: { ref: NativeNotificationRef },
  Failed: { ref: NativeNotificationRef },
  Ready: { ref: NativeNotificationRef },
  Reply: { ref: NativeNotificationRef, supported: Schema.Literal(false) },
  Shown: { ref: NativeNotificationRef },
  SnoozeSelected: {
    choice: NativeReminderSnoozeChoice,
    ref: NativeNotificationRef,
  },
});

export const nativeNotificationWire = {
  notice: Schema.fromJsonString(
    Schema.Struct({
      notice: NativeNotificationNotice,
      version: Schema.Literal(1),
    })
  ),
  reply: Schema.fromJsonString(NativeNotificationReply),
  request: Schema.fromJsonString(NativeNotificationRequest),
};

export const nativeNotificationChannels = {
  notice: "potion:desktop:notification-notice:1",
  request: "potion:desktop:notification-request:1",
};

export const PromptSound = Schema.Literals(["none", "blip", "bell", "tap"]);

export const PlayablePromptSound = Schema.Literals(["blip", "bell", "tap"]);

export const DesktopPreferences = Schema.Struct({
  includeAllDay: Schema.Boolean,
  includeDays: Schema.Literals([1, 2, 3, 4, 5, 6, 7, 14, 30]),
  includeWithoutConferencingOrLocation: Schema.Boolean,
  includeWithoutParticipants: Schema.Boolean,
  joinShortcut: GlobalShortcut,
  menuBar: Schema.Boolean,
  menuShortcut: GlobalShortcut,
  previewMinutes: Schema.Literals([0, 15, 30, 60, 240, 480, 720, 1440, 10_080]),
  promptMinutes: Schema.NullOr(Schema.Literals([0, 1, 2, 3, 5])),
  promptSound: PromptSound.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("blip"))
  ),
  showTime: Schema.Boolean,
  showTitle: Schema.Boolean,
});

export const MacStartupTarget = Schema.Literals(["calendar", "menuBar"]);

export const MacStartupIntent = Schema.Struct({
  calendar: Schema.Boolean,
  menuBar: Schema.Boolean,
});

export const MacStartupProjection = MacStartupIntent;

export const DesktopSettings = Schema.Struct({
  issues: Schema.Array(Schema.String),
  macStartup: Schema.optional(MacStartupProjection),
  openAtLogin: Schema.Boolean,
  preferences: DesktopPreferences,
  revision: Schema.Int,
  runtime: Schema.optional(
    Schema.Struct({
      navigationStartedAt: Schema.optional(Schema.Finite),
      notificationLease: Schema.optional(Schema.String),
      prompt: Schema.Boolean,
      tray: Schema.Boolean,
    })
  ),
});

export const DesktopSettingsReply = Schema.Struct({
  error: Schema.NullOr(Schema.String),
  settings: DesktopSettings,
});

export const StartupRequest = Schema.Struct({
  enabled: Schema.Boolean,
  target: Schema.optional(MacStartupTarget),
});

export const MeetingJoinRequest = Schema.Struct({
  conferenceUrl: ConferenceUrl,
  key: AgendaKey,
});

export const MeetingJoinOutcome = Schema.TaggedUnion({
  Failed: { message: Schema.String },
  NoMeeting: { reason: Schema.Literals(["noUpcoming", "noConferencing"]) },
  Requested: { key: AgendaKey },
});

export const TrayRsvpNote = Schema.Struct({
  key: AgendaKey,
  lease: Schema.String.check(Schema.isMinLength(1)),
  personId: Schema.String.check(Schema.isMinLength(1)),
  response: Schema.Literals(["accepted", "declined", "tentative"]),
  start: nativeNotificationInstant,
});

export const trayRsvpNoteToken = (
  intent: typeof TrayRsvpNote.Type,
  id: number
): string =>
  JSON.stringify([
    intent.personId,
    intent.lease,
    intent.key.accountId,
    intent.key.calendarId,
    intent.key.eventId,
    intent.start,
    intent.response,
    id,
  ]);

export const trayRsvpNotePresentation = "main-window-details";

export const trayRsvpNoteConfirmation = "existing-response-button";

export const trayRsvpNoteCue = "draft-not-saved-response";

export const trayRsvpNoteFocus = "after-commit-exact-target";

export const trayRsvpNoteDraftPolicy = "preserve-and-refuse-other-target";

export const trayRsvpNoteMissingScope = "disable-note-choices";

export const DesktopAction = Schema.TaggedUnion({
  OpenSettings: {
    page: Schema.Literals(["general", "menu-bar", "notifications"]),
  },
  PrepareRsvpNote: TrayRsvpNote.fields,
  RequestedJoinMeeting: {},
  RespondToEvent: {
    key: AgendaKey,
    response: Schema.Literals(["accepted", "declined", "tentative"]),
  },
  ShowEvent: { key: AgendaKey },
});

export const PromptAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literals(["join", "show", "dismiss", "email", "snooze"]),
    key: AgendaKey,
  }),
  Schema.Struct({
    action: Schema.Literal("attachment"),
    index: Schema.Int.check(Schema.isBetween({ maximum: 19, minimum: 0 })),
    key: AgendaKey,
    url: Schema.String,
  }),
]);

export const promptActionMenuPaddingPx = 160;

export const PromptSize = Schema.Struct({
  height: Schema.Finite,
  menuPadding: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({ maximum: promptActionMenuPaddingPx, minimum: 0 })
    )
  ),
  revision: Schema.Int,
});

export const PromptView = Schema.Struct({
  events: Schema.Array(AgendaEvent),
  preferences: optionalPromptPreferences,
  revision: Schema.Int,
});

export const PromptSoundRequest = Schema.TaggedUnion({
  Cancel: { request: Schema.Int },
  Load: { request: Schema.Int, sound: PlayablePromptSound },
  Play: { request: Schema.Int, sound: PlayablePromptSound },
});

export const PromptSoundReply = Schema.Struct({
  phase: Schema.Literals(["load", "play"]),
  ready: Schema.Boolean,
  request: Schema.Int,
});

export interface PromptBridge {
  readonly reportSize?: (size: typeof PromptSize.Type) => void;
  readonly act: (action: typeof PromptAction.Type) => void;
  readonly getView: () => Promise<typeof PromptView.Type>;
  readonly onSound?: (
    receive: (request: typeof PromptSoundRequest.Type) => void
  ) => () => void;
  readonly soundReply?: (reply: typeof PromptSoundReply.Type) => void;
  readonly onView: (
    receive: (view: typeof PromptView.Type) => void
  ) => () => void;
}

export const promptChannels = {
  action: "potion:prompt:action:1",
  read: "potion:prompt:read:1",
  size: "potion:prompt:size:1",
  sound: "potion:prompt:sound:1",
  soundReply: "potion:prompt:sound-reply:1",
  view: "potion:prompt:view:1",
};

export const promptWire = {
  action: Schema.fromJsonString(PromptAction),
  size: Schema.fromJsonString(PromptSize),
  sound: Schema.fromJsonString(PromptSoundRequest),
  soundReply: Schema.fromJsonString(PromptSoundReply),
  view: Schema.fromJsonString(PromptView),
};

export const desktopWire = {
  action: Schema.fromJsonString(DesktopAction),
  agenda: Schema.fromJsonString(AgendaSnapshot),
  join: Schema.fromJsonString(MeetingJoinRequest),
  joinReply: Schema.fromJsonString(MeetingJoinOutcome),
  preferences: Schema.fromJsonString(DesktopPreferences),
  previewSound: Schema.fromJsonString(Schema.Struct({ sound: PromptSound })),
  previewSoundReply: Schema.fromJsonString(Schema.Boolean),
  reply: Schema.fromJsonString(DesktopSettingsReply),
  saveIcs: icsSaveWire,
  saveIcsReply: Schema.fromJsonString(IcsSaveOutcome),
  settings: Schema.fromJsonString(DesktopSettings),
  startup: Schema.fromJsonString(StartupRequest),
};

export const desktopChannels = {
  action: "potion:desktop:action:1",
  agenda: "potion:desktop:agenda:1",
  join: "potion:desktop:join:1",
  preferences: "potion:desktop:preferences:1",
  previewSound: "potion:desktop:preview-sound:1",
  saveIcs: "potion:desktop:save-ics:1",
  settings: "potion:desktop:settings:1",
  settingsChanged: "potion:desktop:settings-changed:1",
  startup: "potion:desktop:startup:1",
};

export type MeetingJoinRequestValue = typeof MeetingJoinRequest.Type;

export type MeetingJoinOutcomeValue = typeof MeetingJoinOutcome.Type;

export type AgendaEventValue = typeof AgendaEvent.Type;

export type AgendaKeyValue = typeof AgendaKey.Type;

export type AgendaSnapshotValue = typeof AgendaSnapshot.Type;

export type DesktopPreferencesValue = typeof DesktopPreferences.Type;

export type DesktopSettingsValue = typeof DesktopSettings.Type;

export type DesktopActionValue = typeof DesktopAction.Type;

export const DesktopStartupTiming = Schema.Struct({
  bridgeAvailableAt: Schema.Finite,
  coldLoadMilliseconds: Schema.Finite,
  preloadMilliseconds: Schema.Finite,
  preloadStartedAt: Schema.Finite,
  windowCreatedAt: Schema.Finite,
});

export interface DesktopBridge {
  readonly showAbout?: (
    request: typeof AboutRequest.Type
  ) => Promise<typeof AboutReply.Type>;
  readonly notificationSettings?: (
    request: typeof NotificationSettingsRequest.Type
  ) => Promise<typeof NotificationSettingsReply.Type>;
  readonly nativeNotifications?: (
    request: typeof NativeNotificationRequest.Type
  ) => Promise<typeof NativeNotificationReply.Type>;
  readonly onNativeNotification?: (
    receive: (notice: typeof NativeNotificationNotice.Type) => void
  ) => () => void;
  readonly getStartupTiming?: () => typeof DesktopStartupTiming.Type;
  readonly getSettings: () => Promise<DesktopSettingsValue>;
  readonly joinMeeting: (
    request: MeetingJoinRequestValue
  ) => Promise<MeetingJoinOutcomeValue>;
  readonly onAction: (
    listener: (action: DesktopActionValue) => void
  ) => () => void;
  readonly onSettings: (
    listener: (settings: DesktopSettingsValue) => void
  ) => () => void;
  readonly previewSound?: (sound: typeof PromptSound.Type) => Promise<boolean>;
  readonly publishAgenda: (snapshot: AgendaSnapshotValue) => void;
  readonly saveIcs?: (
    request: typeof IcsSaveRequest.Type
  ) => Promise<typeof IcsSaveOutcome.Type>;
  readonly savePreferences: (
    preferences: DesktopPreferencesValue
  ) => Promise<typeof DesktopSettingsReply.Type>;
  readonly setStartup: (
    request: typeof StartupRequest.Type
  ) => Promise<typeof DesktopSettingsReply.Type>;
}

export const defaultDesktopPreferences = (): DesktopPreferencesValue => ({
  includeAllDay: false,
  includeDays: 3,
  includeWithoutConferencingOrLocation: true,
  includeWithoutParticipants: true,
  joinShortcut: "Control+Command+J",
  menuBar: true,
  menuShortcut: "Control+Command+K",
  previewMinutes: 720,
  promptMinutes: 1,
  promptSound: "blip",
  showTime: true,
  showTitle: true,
});

export const deskDefaultMacNotificationPermission = Object.freeze({
  authorization: Schema.Literal("unknown").make("unknown"),
  explanation: "This build cannot read macOS notification authorization.",
  label: "desk default (spec silent)",
  sources: [
    "https://www.electronjs.org/docs/latest/api/notification",
    "https://www.electronjs.org/docs/latest/api/system-preferences",
  ],
  text: "Permission status: Check System Settings",
});

export const deskDefaultMacNotificationSettingsUrl = Object.freeze({
  fallback:
    "Open the Apple menu, choose System Settings, then Notifications and Potion Calendar.",
  label: "desk default (spec silent)",
  sources: [
    "https://www.electronjs.org/docs/latest/api/shell",
    "https://support.apple.com/guide/mac-help/change-notifications-settings-mh40583/mac",
  ],
  url: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
});

export const deskDefaultMacNotificationGuidance = Object.freeze({
  alerts:
    "Choose Alerts for notifications that stay visible until you dismiss them.",
  focus: "Do Not Disturb or Focus can hide alerts.",
  label: "desk default (spec silent)",
  sources: [
    "https://support.apple.com/guide/mac-help/change-notifications-settings-mh40583/mac",
  ],
});

export const deskDefaultMenuBarOffNotificationGuidance = Object.freeze({
  label: "desk default (spec silent)",
  sources: [
    "https://www.electronjs.org/docs/latest/api/notification",
    "https://support.apple.com/guide/mac-help/change-notifications-settings-mh40583/mac",
  ],
  text: "The menu bar calendar is off. Desktop reminders and upcoming-meeting notifications will not appear.",
});

export const MacNotificationPermission = Schema.Struct({
  authorization: Schema.Literal("unknown"),
  supported: Schema.Boolean,
});

export const NotificationSettingsRequest = Schema.TaggedUnion({
  Open: { version: Schema.Literal(1) },
  Read: { version: Schema.Literal(1) },
});

export const NotificationSettingsReply = Schema.TaggedUnion({
  Failed: { message: Schema.String, version: Schema.Literal(1) },
  Read: { permission: MacNotificationPermission, version: Schema.Literal(1) },
  Requested: { version: Schema.Literal(1) },
  Unavailable: { version: Schema.Literal(1) },
});

export const notificationSettingsWire = {
  reply: Schema.fromJsonString(NotificationSettingsReply),
  request: Schema.fromJsonString(NotificationSettingsRequest),
};

export const notificationSettingsChannel =
  "potion:desktop:notification-settings:1";

export const deskDefaultAboutPlatform = "darwin";

export const deskDefaultAboutUnsupported = "hidden";

export const deskDefaultAboutShortcut = Option.none<string>();

export const deskDefaultAboutMetadata = "electron-default";

export const deskDefaultAboutRetry = "none";

export const AboutRequest = Schema.Struct({ version: Schema.Literal(1) });

export const AboutReply = Schema.TaggedUnion({
  Failed: { message: Schema.String, version: Schema.Literal(1) },
  Refused: {
    reason: Schema.Literals(["untrusted", "unsupported", "invalid-request"]),
    version: Schema.Literal(1),
  },
  Requested: { version: Schema.Literal(1) },
});

export const aboutWire = {
  reply: Schema.fromJsonString(AboutReply),
  request: Schema.fromJsonString(AboutRequest),
};

export const aboutChannel = "potion:desktop:about:1";

export const notificationSettingsReplyMatches = (
  request: typeof NotificationSettingsRequest.Type,
  reply: typeof NotificationSettingsReply.Type
): boolean =>
  Predicate.isTagged(reply, "Failed") ||
  Predicate.isTagged(reply, "Unavailable") ||
  (Predicate.isTagged(request, "Read") && Predicate.isTagged(reply, "Read")) ||
  (Predicate.isTagged(request, "Open") &&
    Predicate.isTagged(reply, "Requested"));
