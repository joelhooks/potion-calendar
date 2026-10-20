import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  MeetingJoinRequestValue,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { browserMeetings } from "../src/client/meetings/browser.js";

const key = { accountId: "work", calendarId: "primary", eventId: "meeting" };

const request = { conferenceUrl: "https://meet.google.com/abc-defg-hij", key };

const expectFailure = Effect.fnUntraced(function* expectFailure(
  input: MeetingJoinRequestValue
) {
  const outcome = yield* browserMeetings().open(input);

  expect(MeetingJoinOutcome.guards.Failed(outcome)).toBe(true);
});

it.effect(
  "the ordinary browser requests an isolated tab even when noopener makes open return null",
  () =>
    Effect.gen(function* browserHandoff() {
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open.mockRestore();
        })
      );
      expect(yield* browserMeetings().open(request)).toEqual(
        MeetingJoinOutcome.cases.Requested.make({ key })
      );
      expect(open).toHaveBeenCalledExactlyOnceWith(
        request.conferenceUrl,
        "_blank",
        "noopener,noreferrer"
      );
      expect(
        yield* browserMeetings().open({
          ...request,
          conferenceUrl: "http://zoom.us/j/123",
        })
      ).toEqual(MeetingJoinOutcome.cases.Requested.make({ key }));
      expect(open).toHaveBeenLastCalledWith(
        "http://zoom.us/j/123",
        "_blank",
        "noopener,noreferrer"
      );
    })
);

it.effect(
  "a thrown browser opener is a failure, not a claim that the user joined",
  () =>
    Effect.gen(function* browserFailure() {
      const open = vi.spyOn(window, "open").mockImplementation(() => {
        throw new Error("blocked");
      });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open.mockRestore();
        })
      );
      yield* expectFailure(request);
    })
);

it.effect(
  "the native path uses the shared request and outcome without also opening a browser tab",
  () =>
    Effect.gen(function* nativeHandoff() {
      const joinMeeting = vi
        .fn<DesktopBridge["joinMeeting"]>()
        .mockResolvedValue(MeetingJoinOutcome.cases.Requested.make({ key }));

      const open = vi.spyOn(window, "open").mockReturnValue(null);

      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: { joinMeeting },
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Reflect.deleteProperty(window, "potionDesktop");
          open.mockRestore();
        })
      );

      expect(yield* browserMeetings().open(request)).toEqual(
        MeetingJoinOutcome.cases.Requested.make({ key })
      );
      expect(joinMeeting).toHaveBeenCalledExactlyOnceWith(request);
      expect(open).not.toHaveBeenCalled();
    })
);

it.effect(
  "native HTTP and credential URLs fail closed without a different browser or meeting fallback",
  () =>
    Effect.gen(function* nativeValidation() {
      const joinMeeting = vi
        .fn<DesktopBridge["joinMeeting"]>()
        .mockResolvedValue(MeetingJoinOutcome.cases.Requested.make({ key }));

      const open = vi.spyOn(window, "open").mockReturnValue(null);

      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: { joinMeeting },
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Reflect.deleteProperty(window, "potionDesktop");
          open.mockRestore();
        })
      );
      yield* expectFailure({
        ...request,
        conferenceUrl: "http://zoom.us/j/123",
      });
      yield* expectFailure({
        ...request,
        conferenceUrl: "https://person:password@zoom.us/j/123",
      });
      expect(joinMeeting).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    })
);

it.effect(
  "malformed, mismatched and rejected native replies become honest failures",
  () =>
    Effect.gen(function* nativeReplies() {
      const joinMeeting = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          MeetingJoinOutcome.cases.Requested.make({
            key: { ...key, eventId: "different" },
          })
        )
        .mockRejectedValueOnce(new Error("native unavailable"));

      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: { joinMeeting },
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Reflect.deleteProperty(window, "potionDesktop");
        })
      );
      yield* expectFailure(request);
      yield* expectFailure(request);
      yield* expectFailure(request);
    })
);
