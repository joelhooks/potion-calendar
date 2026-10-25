import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Stream } from "effect";
import { AsyncData } from "foldkit";

import { LiveNotice } from "../src/client/live/protocol.js";
import { clearEndedSessionStorage } from "../src/client/live/session.js";
import { deleteAccountFixture } from "./delete-account-fixture.js";
import { profileSnapshot } from "./profile-fixture.js";
import {
  mountProfileRuntime,
  profileDomReady,
  profileRuntimeRoot,
} from "./profile-runtime-fixture.js";

it.effect.each([true, false])(
  "the actual root clears an ended person's calendar and identity, with deletion notice only for deleted=%s",
  (deleted) =>
    Effect.gen(function* endedRoot() {
      const initial = deleteAccountFixture();
      const personId = Option.getOrThrow(initial.person);
      const snapshot = profileSnapshot(initial);

      const runtime = yield* mountProfileRuntime(initial, {
        read: Effect.succeed(snapshot),
        save: () => Effect.die("Session ending must not write profile"),
      });

      localStorage.setItem(`calendar.visibility.${personId}`, "a");
      localStorage.setItem(`calendar.reminder-snoozes.v1.${personId}`, "a");
      localStorage.setItem("calendar.visibility.b", "b");
      localStorage.setItem("calendar.reminder-snoozes.v1.b", "b");
      localStorage.setItem("unrelated", "preserve");
      yield* clearEndedSessionStorage(personId);
      yield* runtime.receiveLive(
        personId,
        LiveNotice.cases.SessionEnded.make({ deleted })
      );
      yield* profileDomReady(
        () => profileRuntimeRoot()?.textContent?.includes("Sign in") === true
      );
      expect(Option.isNone(runtime.current().person)).toBe(true);
      expect(
        Option.getOrUndefined(AsyncData.getData(runtime.current().session))
      ).toBeNull();
      expect(runtime.current().calendar.calendars).toEqual([]);
      expect(runtime.current().calendar.reads).toEqual([]);
      expect(profileRuntimeRoot()?.textContent).not.toContain(
        snapshot.user.email
      );
      expect(
        profileRuntimeRoot()?.textContent?.includes("Your account was deleted.")
      ).toBe(deleted);
      expect(
        localStorage.getItem(`calendar.visibility.${personId}`)
      ).toBeNull();
      expect(
        localStorage.getItem(`calendar.reminder-snoozes.v1.${personId}`)
      ).toBeNull();
      expect(localStorage.getItem("calendar.visibility.b")).toBe("b");
      expect(localStorage.getItem("calendar.reminder-snoozes.v1.b")).toBe("b");
      expect(localStorage.getItem("unrelated")).toBe("preserve");
    })
);

it.effect(
  "a stale foreign-person ended notice cannot clear a currently signed-in person's root",
  () =>
    Effect.gen(function* staleEndedRoot() {
      const initial = deleteAccountFixture();
      const snapshot = profileSnapshot(initial);

      const runtime = yield* mountProfileRuntime(initial, {
        read: Effect.succeed(snapshot),
        save: () => Effect.die("No save"),
      });

      yield* runtime.receiveLive(
        "foreign-person",
        LiveNotice.cases.SessionEnded.make({ deleted: true })
      );
      yield* Stream.fromQueue(runtime.messages).pipe(
        Stream.filter((message) => Predicate.isTagged(message, "ReceivedLive")),
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      );
      expect(runtime.current().person).toEqual(initial.person);
      expect(runtime.current().session).toEqual(initial.session);
      expect(runtime.current().calendar).toEqual(initial.calendar);
      expect(profileRuntimeRoot()?.textContent).not.toContain(
        "Your account was deleted."
      );
    })
);
