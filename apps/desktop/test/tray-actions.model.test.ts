import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Deferred, Effect, Predicate, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";

import { NativeIntent, startNativeHost } from "../src/native-host.js";
import type { NativeIntentValue } from "../src/native-host.js";
import { performTrayAction } from "../src/tray-actions.js";
import { trayMenuRows } from "../src/tray-menu.js";
import { trayEvent, trayNow, trayView } from "./tray-current-fixture.js";

it.effect.each([false, true])(
  "real menu callbacks keep distinct attachments in the native-host queue and respect person clearing=%s",
  (cleared) =>
    Effect.gen(function* queuedTrayCallbacks() {
      yield* TestClock.setTime(trayNow);
      const event = trayEvent("current");
      const view = trayView([event]);
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const opened = yield* Ref.make<string[]>([]);

      const host = yield* startNativeHost(
        {
          intents: Stream.never,
          perform: (intent, current) => {
            if (Predicate.isTagged(intent, "OpenWindow")) {
              return Deferred.succeed(entered, true).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.asVoid
              );
            }

            return Predicate.isTagged(intent, "TrayAttachment")
              ? performTrayAction(intent, current, {
                  join: () => Effect.die("Attachment callback must not join"),
                  open: (href) => Ref.update(opened, (rows) => [...rows, href]),
                  origin: "https://calendar.test",
                  show: () => Effect.die("Attachment callback must not show"),
                  trusted: Effect.succeed(true),
                })
              : Effect.die("Unexpected native intent");
          },
          render: () => Effect.void,
        },
        { now: trayNow, preferences: view.preferences }
      );

      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      yield* send(host.actor, { snapshot: view.agenda, type: "Agenda" });
      yield* send(host.actor, {
        intent: NativeIntent.cases.OpenWindow.make({}),
        type: "Intent",
      });
      yield* Deferred.await(entered);
      const intents: NativeIntentValue[] = [];

      const rows = trayMenuRows(
        view,
        { day: () => "Today", time: () => "10:00" },
        (intent) => {
          intents.push(intent);
        }
      );

      const attachments =
        rows
          .find((row) => row.id === "tray-current-event")
          ?.submenu?.find((row) => row.id === "tray-current-attachments")
          ?.submenu ?? [];

      expect(attachments.map((row) => row.id)).toEqual([
        "tray-current-attachment-0",
        "tray-current-attachment-1",
      ]);
      attachments[0]?.click?.();
      attachments[1]?.click?.();
      attachments[0]?.click?.();

      for (const intent of intents) {
        yield* send(host.actor, { intent, type: "Intent" });
      }

      yield* send(host.actor, { now: trayNow + 1, type: "Tick" });

      const queued = yield* waitFor(
        host.actor,
        (snapshot) => snapshot.context.now === trayNow + 1,
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);

      expect(queued.context.queued).toHaveLength(2);

      if (cleared) {
        yield* send(host.actor, { snapshot: { events: [] }, type: "Agenda" });
        yield* waitFor(
          host.actor,
          (snapshot) => snapshot.context.agenda.events.length === 0,
          { timeout: "2 seconds" }
        ).pipe(Effect.orDie);
      }

      yield* Deferred.succeed(release, true);
      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(opened)).toEqual(
        cleared
          ? []
          : [
              "https://files.example.test/notes",
              "https://files.example.test/agenda",
            ]
      );
      yield* send(host.actor, { type: "Quit" });
      yield* host.done;
    })
);
