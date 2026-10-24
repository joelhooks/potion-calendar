import { Effect, Predicate, Schema } from "effect";

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
}).check(Schema.makeFilter((event) => event.end > event.start));

export const AgendaSnapshot = Schema.Struct({
  events: Schema.Array(AgendaEvent),
});

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

export const DesktopSettings = Schema.Struct({
  issues: Schema.Array(Schema.String),
  openAtLogin: Schema.Boolean,
  preferences: DesktopPreferences,
  revision: Schema.Int,
  runtime: Schema.optional(
    Schema.Struct({
      navigationStartedAt: Schema.optional(Schema.Finite),
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

export const DesktopAction = Schema.TaggedUnion({
  OpenSettings: {
    page: Schema.Literals(["general", "menu-bar", "notifications"]),
  },
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

export const PromptSize = Schema.Struct({
  height: Schema.Finite,
  revision: Schema.Int,
});

export const PromptView = Schema.Struct({
  events: Schema.Array(AgendaEvent),
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
  settings: Schema.fromJsonString(DesktopSettings),
  startup: Schema.fromJsonString(StartupRequest),
};

export const desktopChannels = {
  action: "potion:desktop:action:1",
  agenda: "potion:desktop:agenda:1",
  join: "potion:desktop:join:1",
  preferences: "potion:desktop:preferences:1",
  previewSound: "potion:desktop:preview-sound:1",
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
