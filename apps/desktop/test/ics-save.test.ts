import { ActorWatch } from "@calendar/capability/actor-watch";
import type { WatchableActor } from "@calendar/capability/actor-watch";
import {
  IcsSaveOutcome,
  desktopWire,
  icsSaveByteLimit,
  icsSaveParseOptions,
  icsSaveWireLimit,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";

import { IcsSaveChoice, IcsSaveError } from "../src/ics-save.js";
import {
  calendarText,
  decodeIcsOutcome,
  encodeIcsRequest,
  icsSaveFixture,
  icsSaveHandlerFixture,
} from "./ics-save-fixture.js";

it.effect(
  "writes only the dialog's exact chosen path and exact calendar bytes, then reports Saved",
  () =>
    Effect.gen(function* chosenPath() {
      const fixture = icsSaveFixture();
      const handle = yield* icsSaveHandlerFixture(fixture.port);
      const message = yield* encodeIcsRequest();

      const outcome = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(outcome._tag).toBe("Saved");
      expect(fixture.suggestions).toEqual(["events.ics"]);
      expect(fixture.writes).toHaveLength(1);
      expect(fixture.writes[0]?.path).toBe("/chosen/export.ics");
      expect(new TextDecoder().decode(fixture.writes[0]?.bytes)).toBe(
        calendarText()
      );
      expect(JSON.stringify(outcome)).not.toContain("/chosen/");
    })
);

it.effect(
  "cancel, non-ICS paths and a lost trusted frame perform no file write",
  () =>
    Effect.gen(function* noWrite() {
      const message = yield* encodeIcsRequest();

      for (const row of [
        {
          choice: IcsSaveChoice.cases.Cancelled.make({}),
          expected: "Cancelled",
          trusted: true,
        },
        {
          choice: IcsSaveChoice.cases.Chosen.make({
            path: "/chosen/export.txt",
          }),
          expected: "Failed",
          trusted: true,
        },
        {
          choice: IcsSaveChoice.cases.Chosen.make({ path: "relative.ics" }),
          expected: "Failed",
          trusted: true,
        },
        {
          choice: IcsSaveChoice.cases.Chosen.make({
            path: "/chosen/export.ics",
          }),
          expected: "Failed",
          trusted: false,
        },
      ]) {
        const fixture = icsSaveFixture(Effect.succeed(row.choice));
        const handle = yield* icsSaveHandlerFixture(fixture.port);

        const outcome = yield* handle(
          message,
          Effect.succeed(row.trusted)
        ).pipe(Effect.flatMap(decodeIcsOutcome));

        expect(outcome._tag).toBe(row.expected);
        expect(fixture.writes).toEqual([]);
        expect(fixture.suggestions).toHaveLength(row.trusted ? 1 : 0);
      }
    })
);

it.effect(
  "a real pending dialog cannot advance to writing after its frame loses trust",
  () =>
    Effect.gen(function* frameLifetime() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const state = { trusted: true };

      const fixture = icsSaveFixture(
        Deferred.succeed(entered, true).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(
            IcsSaveChoice.cases.Chosen.make({ path: "/chosen/export.ics" })
          )
        )
      );

      const handle = yield* icsSaveHandlerFixture(fixture.port);
      const message = yield* encodeIcsRequest();
      const scope = yield* Effect.scope;

      const running = yield* handle(
        message,
        Effect.sync(() => state.trusted)
      ).pipe(Effect.forkIn(scope));

      yield* Deferred.await(entered);
      state.trusted = false;
      yield* Deferred.succeed(release, true);

      const outcome = yield* Fiber.join(running).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(outcome).toEqual(
        IcsSaveOutcome.cases.Failed.make({ reason: "untrusted" })
      );
      expect(fixture.suggestions).toEqual(["events.ics"]);
      expect(fixture.writes).toEqual([]);
    })
);

it.effect(
  "interruption during a real pending dialog cannot perform a late write",
  () =>
    Effect.gen(function* interruptedDialog() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const settled = yield* Deferred.make<boolean>();
      const watched = yield* Deferred.make<boolean>();
      const actors: WatchableActor[] = [];

      const fixture = icsSaveFixture(
        Deferred.succeed(entered, true).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(
            IcsSaveChoice.cases.Chosen.make({ path: "/chosen/export.ics" })
          ),
          Effect.onExit(() => Deferred.succeed(settled, true))
        )
      );

      const handle = yield* icsSaveHandlerFixture(fixture.port);
      const message = yield* encodeIcsRequest();
      const scope = yield* Effect.scope;

      const running = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.provideService(ActorWatch, {
          watch: (_machine, actor) =>
            Effect.sync(() => {
              actors.push(actor);
            }).pipe(
              Effect.andThen(Deferred.succeed(watched, true)),
              Effect.asVoid
            ),
        }),
        Effect.forkIn(scope)
      );

      yield* Deferred.await(entered);
      yield* Deferred.await(watched);
      yield* Fiber.interrupt(running);
      expect(actors[0]?.getSnapshot().status).toBe("stopped");
      yield* Deferred.succeed(release, true);
      yield* Deferred.await(settled);
      expect(actors[0]?.getSnapshot().status).toBe("stopped");
      expect(fixture.writes).toEqual([]);
    })
);

it.effect(
  "rejects a concurrent save without opening another dialog or queuing a later write",
  () =>
    Effect.gen(function* singleDialog() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const secondDialog = yield* Deferred.make<boolean>();
      const secondFinished = yield* Deferred.make<boolean>();
      const choices = yield* Ref.make(0);

      const fixture = icsSaveFixture(
        Ref.updateAndGet(choices, (count) => count + 1).pipe(
          Effect.tap((count) =>
            count === 2 ? Deferred.succeed(secondDialog, true) : Effect.void
          ),
          Effect.andThen(Deferred.succeed(entered, true)),
          Effect.andThen(Deferred.await(release)),
          Effect.as(
            IcsSaveChoice.cases.Chosen.make({ path: "/chosen/export.ics" })
          )
        )
      );

      const handle = yield* icsSaveHandlerFixture(fixture.port);
      const message = yield* encodeIcsRequest();
      const scope = yield* Effect.scope;

      const first = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.forkIn(scope)
      );

      yield* Deferred.await(entered);

      const concurrent = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.onExit(() => Deferred.succeed(secondFinished, true)),
        Effect.forkIn(scope)
      );

      const observed = yield* Effect.raceFirst(
        Deferred.await(secondFinished).pipe(Effect.as("finished")),
        Deferred.await(secondDialog).pipe(Effect.as("dialog"))
      );

      expect(observed).toBe("finished");

      const second = yield* Fiber.join(concurrent).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(second).toEqual(
        IcsSaveOutcome.cases.Failed.make({ reason: "busy" })
      );
      expect(fixture.suggestions).toHaveLength(1);
      yield* Deferred.succeed(release, true);

      const completed = yield* Fiber.join(first).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(completed._tag).toBe("Saved");
      expect(fixture.writes).toHaveLength(1);
    })
);

it.effect(
  "dialog and filesystem failures remain Failed, and an unfinished write cannot report Saved",
  () =>
    Effect.gen(function* saveReceipt() {
      const message = yield* encodeIcsRequest();

      const dialogFixture = icsSaveFixture(
        Effect.fail(new IcsSaveError({ reason: "dialog" }))
      );

      const failedDialog = yield* icsSaveHandlerFixture(dialogFixture.port);
      expect(
        yield* failedDialog(message, Effect.succeed(true)).pipe(
          Effect.flatMap(decodeIcsOutcome)
        )
      ).toEqual(IcsSaveOutcome.cases.Failed.make({ reason: "dialog" }));
      expect(dialogFixture.writes).toEqual([]);

      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const fixture = icsSaveFixture();

      const handle = yield* icsSaveHandlerFixture({
        ...fixture.port,
        write: () =>
          Deferred.succeed(entered, true).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.fail(new IcsSaveError({ reason: "write" })))
          ),
      });

      const scope = yield* Effect.scope;

      const pending = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.forkIn(scope)
      );

      yield* Deferred.await(entered);
      expect(pending.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, true);

      const outcome = yield* Fiber.join(pending).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(outcome).toEqual(
        IcsSaveOutcome.cases.Failed.make({ reason: "write" })
      );
    })
);

it.effect(
  "accepts exactly the decoded and wire limits, while invalid and oversized requests open no dialog",
  () =>
    Effect.gen(function* nativeBounds() {
      const fixture = icsSaveFixture();
      const handle = yield* icsSaveHandlerFixture(fixture.port);
      const exact = yield* encodeIcsRequest(icsSaveByteLimit);
      expect(
        yield* handle(exact, Effect.succeed(true)).pipe(
          Effect.flatMap(decodeIcsOutcome)
        )
      ).toEqual(IcsSaveOutcome.cases.Saved.make({}));
      expect(fixture.writes[0]?.bytes.byteLength).toBe(icsSaveByteLimit);

      const small = yield* encodeIcsRequest();

      const padded =
        small +
        " ".repeat(
          icsSaveWireLimit - new TextEncoder().encode(small).byteLength
        );

      expect(
        yield* handle(padded, Effect.succeed(true)).pipe(
          Effect.flatMap(decodeIcsOutcome)
        )
      ).toEqual(IcsSaveOutcome.cases.Saved.make({}));
      const before = fixture.suggestions.length;

      const over = Base64.encode(
        new TextEncoder().encode(calendarText(icsSaveByteLimit + 1))
      );

      for (const payload of [
        `${padded} `,
        JSON.stringify({ bytes: over, suggestedName: "events.ics" }),
        small.replace(
          '"suggestedName":',
          '"path":"/private/renderer.ics","suggestedName":'
        ),
        small.replace("events.ics", "../renderer.ics"),
        "{",
        "null",
        "[]",
      ]) {
        const outcome = yield* handle(payload, Effect.succeed(true)).pipe(
          Effect.flatMap(decodeIcsOutcome)
        );

        expect(outcome._tag).toBe("Failed");
        expect(fixture.suggestions).toHaveLength(before);
        expect(fixture.writes).toHaveLength(before);
      }

      const restored = yield* Schema.decodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(small);

      expect(restored.suggestedName).toBe("events.ics");
    })
);
