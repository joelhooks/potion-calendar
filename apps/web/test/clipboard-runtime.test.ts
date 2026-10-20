import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Ref, Stream } from "effect";

import {
  ClipboardInputFailure,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import {
  ClipboardAction,
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import type { ClipboardConnection } from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { clipboardClient, copiedFact } from "./clipboard-runtime-fixture.js";

const observe = (connection: ClipboardConnection) =>
  Effect.gen(function* observeClipboard() {
    const inbox = yield* Queue.unbounded<typeof ClipboardNotice.Type>();

    const receipts = yield* Ref.make<
      readonly (typeof ClipboardNotice.cases.Receipt.Type)[]
    >([]);

    yield* connection.notices.pipe(
      Stream.runForEach((notice) =>
        Effect.gen(function* receiveClipboard() {
          if (ClipboardNotice.guards.Receipt(notice)) {
            yield* Ref.update(receipts, (all) => [...all, notice]);
          }

          yield* Queue.offer(inbox, notice);
        })
      ),
      Effect.forkScoped
    );

    return { inbox, receipts };
  });

const takeNotice = (
  inbox: Queue.Queue<typeof ClipboardNotice.Type>,
  predicate: (notice: typeof ClipboardNotice.Type) => boolean
) =>
  Stream.fromQueue(inbox).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption)
  );

it.effect(
  "Cut publishes one exact-reference deletion handoff after arming the owned copy; stale deliveries cannot revive it",
  () => {
    const memory = clipboardClient(0);

    return Effect.gen(function* cutHandoff() {
      const runtime = yield* ClipboardRuntime;
      const connection = yield* runtime.connect("person-A");
      const observed = yield* observe(connection);
      yield* takeNotice(observed.inbox, ClipboardNotice.guards.State);
      const cut = copiedFact(1, "cut", "person-A", connection.sessionId);
      yield* connection.native(cut);

      const received = yield* takeNotice(
        observed.inbox,
        ClipboardNotice.guards.Receipt
      );

      expect(received).toMatchObject({
        receipt: {
          copyId: cut.envelope.id,
          source: cut.envelope.items[0].source,
        },
      });
      expect(connection.copied()).toEqual({
        id: cut.envelope.id,
        personId: "person-A",
      });
      yield* connection.native(cut);
      yield* connection.native(
        NativeClipboardNotice.cases.Invalidated.make({
          copyId: cut.envelope.id,
          personId: "person-A",
          sequence: 2,
          sessionId: connection.sessionId,
        })
      );
      yield* connection.native(cut);
      yield* connection.native(
        NativeClipboardNotice.cases.Refused.make({
          failure: new ClipboardInputFailure({
            message: "Clipboard data unavailable.",
            reason: "nativeUnavailable",
          }),
          operation: "paste",
          personId: "person-A",
          sequence: 3,
          sessionId: connection.sessionId,
        })
      );
      yield* takeNotice(
        observed.inbox,
        (notice) =>
          ClipboardNotice.guards.State(notice) &&
          Option.exists(
            notice.view.toast,
            (toast) => toast.id === `${connection.sessionId}.3`
          )
      );
      expect(connection.copied()).toBeUndefined();
      expect(yield* Ref.get(observed.receipts)).toHaveLength(1);
      expect(memory.calls).toHaveLength(0);
    }).pipe(
      Effect.provide(ClipboardRuntime.layer),
      Effect.provideService(CalendarEditingClient, memory.client),
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({
          commit: () =>
            Effect.die("Cut must use the normal root deletion flow"),
        })
      ),
      Effect.provide(NodeServices.layer)
    );
  }
);

it.effect(
  "person replacement retires the prior owned envelope and refuses old-person commands and native deliveries",
  () => {
    const memory = clipboardClient(0);

    return Effect.gen(function* replacePerson() {
      const runtime = yield* ClipboardRuntime;
      const first = yield* runtime.connect("person-A");
      const a = yield* observe(first);
      yield* takeNotice(a.inbox, ClipboardNotice.guards.State);
      const copy = copiedFact(1, "copy", "person-A", first.sessionId);
      yield* first.native(copy);
      yield* takeNotice(
        a.inbox,
        (notice) =>
          ClipboardNotice.guards.State(notice) &&
          Option.isSome(notice.view.copied)
      );
      const second = yield* runtime.connect("person-B");
      const b = yield* observe(second);
      yield* takeNotice(b.inbox, ClipboardNotice.guards.State);
      expect(first.canReceive()).toBe(false);
      expect(first.copied()).toBeUndefined();
      expect(second.copied()).toBeUndefined();

      const refused = yield* runtime
        .dispatch(
          "person-A",
          first.sessionId,
          ClipboardAction.cases.Cancel.make({ intentId: "old-intent" })
        )
        .pipe(Effect.flip);

      expect(refused.reason).toBe("personMismatch");
      yield* first.native(copy);
      const nextCopy = copiedFact(1, "copy", "person-B", second.sessionId);
      yield* second.native(nextCopy);
      yield* takeNotice(
        b.inbox,
        (notice) =>
          ClipboardNotice.guards.State(notice) &&
          Option.exists(
            notice.view.copied,
            (identity) => identity.id === nextCopy.envelope.id
          )
      );
      expect(second.copied()?.personId).toBe("person-B");
      const replacement = yield* runtime.connect("person-B");

      const oldLease = yield* runtime
        .validateSession("person-B", second.sessionId)
        .pipe(Effect.flip);

      expect(oldLease.reason).toBe("personMismatch");
      yield* runtime.validateSession("person-B", replacement.sessionId);
      expect(second.canReceive()).toBe(false);
      expect(memory.calls).toHaveLength(0);
    }).pipe(
      Effect.provide(ClipboardRuntime.layer),
      Effect.provideService(CalendarEditingClient, memory.client),
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({ commit: () => Effect.die("Unexpected delete") })
      ),
      Effect.provide(NodeServices.layer)
    );
  }
);
