import {
  ConferenceUrl,
  navigation,
  TrayAttachmentUrl,
  TrayDetails,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  AgendaKeyValue,
  MeetingJoinRequestValue,
} from "@calendar/core/desktop-bridge";
import { composeParticipantEmail } from "@calendar/core/participant-email";
import { Clock, Effect, Match, Schema } from "effect";

import { sameAgendaKey, trayAgenda } from "./agenda.js";
import type { DesktopError } from "./config.js";
import type { NativeIntentValue, NativeView } from "./native-host.js";

export type TrayIntentValue = Extract<
  NativeIntentValue,
  {
    readonly _tag:
      | "TrayAttachment"
      | "TrayEmail"
      | "TrayJoin"
      | "TrayShowEvent";
  }
>;

type TrayOperation =
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "join"; readonly request: MeetingJoinRequestValue }
  | { readonly kind: "show"; readonly key: AgendaKeyValue };

const detailsFor = (event: AgendaEventValue) => {
  const details = event.trayDetails;

  return details !== undefined && Schema.is(TrayDetails)(details)
    ? details
    : undefined;
};

const attachmentOperation = (
  action: Extract<TrayIntentValue, { readonly _tag: "TrayAttachment" }>,
  event: AgendaEventValue,
  origin: string
): TrayOperation | undefined => {
  const attachment = detailsFor(event)?.attachments.find(
    (row) => row.index === action.index
  );

  const saved = event.attachments?.[action.index];

  return attachment !== undefined &&
    saved !== undefined &&
    attachment.url === action.url &&
    saved.url === action.url &&
    Schema.is(TrayAttachmentUrl)(action.url) &&
    navigation(action.url, origin) === "browser"
    ? { href: action.url, kind: "external" }
    : undefined;
};

const emailOperation = (
  action: Extract<TrayIntentValue, { readonly _tag: "TrayEmail" }>,
  event: AgendaEventValue,
  origin: string
): TrayOperation | undefined => {
  const saved = detailsFor(event)?.email;

  if (saved === undefined || saved === null || saved.href !== action.href) {
    return undefined;
  }

  const parsed = URL.parse(action.href);
  const subject = parsed?.searchParams.get("subject");

  if (
    parsed?.protocol !== "mailto:" ||
    subject === undefined ||
    subject === null ||
    (subject.trim() || "Untitled event") !== event.title
  ) {
    return undefined;
  }

  const email = composeParticipantEmail(subject, event.participantEmails ?? []);

  return email.kind === "ready" &&
    email.href === action.href &&
    email.recipients.length === saved.recipientCount &&
    navigation(email.href, origin) === "browser"
    ? { href: email.href, kind: "external" }
    : undefined;
};

export const resolveTrayAction = (
  action: TrayIntentValue,
  view: NativeView,
  origin: string,
  now: number
): TrayOperation | undefined => {
  const agenda = trayAgenda(view.agenda, view.preferences, now);

  const current = (key: AgendaKeyValue) =>
    agenda.current !== undefined && sameAgendaKey(agenda.current.key, key)
      ? agenda.current
      : undefined;

  return Match.value(action).pipe(
    Match.tagsExhaustive({
      TrayAttachment: (value) => {
        const event = current(value.key);

        return event === undefined
          ? undefined
          : attachmentOperation(value, event, origin);
      },
      TrayEmail: (value) => {
        const event = current(value.key);

        return event === undefined
          ? undefined
          : emailOperation(value, event, origin);
      },
      TrayJoin: (value): TrayOperation | undefined => {
        const event =
          value.section === "day"
            ? agenda.remaining.find((row) => sameAgendaKey(row.key, value.key))
            : current(value.key);

        return event !== undefined &&
          value.conferenceUrl === event.conferenceUrl &&
          Schema.is(ConferenceUrl)(value.conferenceUrl) &&
          navigation(value.conferenceUrl, origin) === "browser"
          ? {
              kind: "join",
              request: { conferenceUrl: value.conferenceUrl, key: event.key },
            }
          : undefined;
      },
      TrayShowEvent: (value): TrayOperation | undefined =>
        current(value.key) !== undefined ||
        agenda.remaining.some((row) => sameAgendaKey(row.key, value.key))
          ? { key: value.key, kind: "show" }
          : undefined,
    })
  );
};

export interface TrayActionPort {
  readonly origin: string;
  readonly trusted: Effect.Effect<boolean>;
  readonly open: (href: string) => Effect.Effect<void, DesktopError>;
  readonly join: (
    request: MeetingJoinRequestValue
  ) => Effect.Effect<void, DesktopError>;
  readonly show: (key: AgendaKeyValue) => Effect.Effect<void, DesktopError>;
}

export const performTrayAction = Effect.fn("Desktop.performTrayAction")(
  function* performTrayAction(
    action: TrayIntentValue,
    view: NativeView,
    port: TrayActionPort
  ) {
    if (!(yield* port.trusted)) {
      return;
    }

    const operation = resolveTrayAction(
      action,
      view,
      port.origin,
      yield* Clock.currentTimeMillis
    );

    if (operation === undefined) {
      return;
    }

    switch (operation.kind) {
      case "external": {
        yield* port.open(operation.href);
        break;
      }

      case "join": {
        yield* port.join(operation.request);
        break;
      }

      case "show": {
        yield* port.show(operation.key);
        break;
      }

      default: {
        break;
      }
    }
  }
);
