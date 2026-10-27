import { sameDesktopEventKey } from "@calendar/core/desktop-bridge";
import type { TrayRsvpNote } from "@calendar/core/desktop-bridge";
import { Clock, Effect } from "effect";

import { trayAgenda } from "./agenda.js";
import { DesktopError } from "./config.js";
import type { NativeView } from "./native-host.js";

export interface TrayRsvpNotePort {
  readonly trusted: Effect.Effect<boolean>;
  readonly focus: Effect.Effect<void>;
  readonly prepare: (
    intent: typeof TrayRsvpNote.Type
  ) => Effect.Effect<void, DesktopError>;
}

export const prepareTrayRsvpNote = Effect.fn("Desktop.prepareTrayRsvpNote")(
  function* prepareTrayRsvpNote(
    intent: typeof TrayRsvpNote.Type,
    view: NativeView,
    port: TrayRsvpNotePort
  ) {
    const now = yield* Clock.currentTimeMillis;
    const { current } = trayAgenda(view.agenda, view.preferences, now);
    const owner = view.agenda.notificationAgenda;
    const trusted = yield* port.trusted;

    if (
      !trusted ||
      owner === undefined ||
      owner.personId !== intent.personId ||
      owner.lease !== intent.lease ||
      current === undefined ||
      !sameDesktopEventKey(current.key, intent.key) ||
      current.start !== intent.start ||
      current.rsvp?.enabled !== true
    ) {
      return yield* new DesktopError({
        message:
          "The meeting changed. Open the tray and choose its response again.",
      });
    }

    yield* port.focus;

    return yield* port.prepare(intent);
  }
);
