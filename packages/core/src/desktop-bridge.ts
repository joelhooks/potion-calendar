import { Schema } from "effect";

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

export const AgendaEvent = Schema.Struct({
  allDay: Schema.Boolean,
  calendarColor: Schema.String,
  conferenceUrl: Schema.NullOr(ConferenceUrl),
  end: Schema.Finite,
  hasLocation: Schema.Boolean,
  hasParticipants: Schema.Boolean,
  key: AgendaKey,
  responseStatus: Schema.Literals([
    "accepted",
    "declined",
    "tentative",
    "needsAction",
  ]),
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
  showTime: Schema.Boolean,
  showTitle: Schema.Boolean,
});

export const DesktopSettings = Schema.Struct({
  issues: Schema.Array(Schema.String),
  openAtLogin: Schema.Boolean,
  preferences: DesktopPreferences,
  revision: Schema.Int,
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
  ShowEvent: { key: AgendaKey },
});

export const PromptAction = Schema.Struct({
  action: Schema.Literals(["join", "show", "dismiss"]),
  key: AgendaKey,
});

export const desktopWire = {
  action: Schema.fromJsonString(DesktopAction),
  agenda: Schema.fromJsonString(AgendaSnapshot),
  join: Schema.fromJsonString(MeetingJoinRequest),
  joinReply: Schema.fromJsonString(MeetingJoinOutcome),
  preferences: Schema.fromJsonString(DesktopPreferences),
  reply: Schema.fromJsonString(DesktopSettingsReply),
  settings: Schema.fromJsonString(DesktopSettings),
  startup: Schema.fromJsonString(StartupRequest),
};

export const desktopChannels = {
  action: "potion:desktop:action:1",
  agenda: "potion:desktop:agenda:1",
  join: "potion:desktop:join:1",
  preferences: "potion:desktop:preferences:1",
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

export interface DesktopBridge {
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
  showTime: true,
  showTitle: true,
});
