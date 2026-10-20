import {
  MeetingJoinOutcome,
  MeetingJoinRequest,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  MeetingJoinOutcomeValue,
  MeetingJoinRequestValue,
} from "@calendar/core/desktop-bridge";
import { Effect, Option, Schema } from "effect";

import { conferenceLink } from "../../layout/conferencing.js";
import type { MeetingPortService } from "./port.js";

declare global {
  interface Window {
    readonly potionDesktop?: DesktopBridge;
  }
}

const failed = () =>
  MeetingJoinOutcome.cases.Failed.make({
    message: "The meeting link could not be opened. Try again.",
  });

const sameKey = (
  left: MeetingJoinRequestValue["key"],
  right: MeetingJoinRequestValue["key"]
): boolean =>
  left.accountId === right.accountId &&
  left.calendarId === right.calendarId &&
  left.eventId === right.eventId;

export const browserMeetings = (): MeetingPortService => ({
  open: Effect.fn("MeetingPort.open")(function* open(
    request: MeetingJoinRequestValue
  ): Effect.fn.Return<MeetingJoinOutcomeValue> {
    if (typeof window === "undefined") {
      return failed();
    }

    const conferenceUrl = conferenceLink(request.conferenceUrl);

    if (conferenceUrl === undefined) {
      return failed();
    }

    const native = window.potionDesktop;

    if (native !== undefined) {
      const valid = Schema.decodeOption(MeetingJoinRequest)(request);

      if (Option.isNone(valid)) {
        return MeetingJoinOutcome.cases.Failed.make({
          message:
            "The desktop app requires an HTTPS meeting link without credentials.",
        });
      }

      const outcome = yield* Effect.tryPromise({
        catch: failed,
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => native.joinMeeting(valid.value),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MeetingJoinOutcome)),
        Effect.orElseSucceed(failed)
      );

      return MeetingJoinOutcome.guards.Requested(outcome) &&
        !sameKey(outcome.key, request.key)
        ? failed()
        : outcome;
    }

    return yield* Effect.try({
      catch: failed,
      try: () => {
        window.open(conferenceUrl, "_blank", "noopener,noreferrer");

        return MeetingJoinOutcome.cases.Requested.make({ key: request.key });
      },
    }).pipe(Effect.catch((error) => Effect.succeed(error)));
  }),
});
