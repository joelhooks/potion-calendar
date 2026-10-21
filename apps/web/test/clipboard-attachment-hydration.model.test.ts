import { Provider } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import { Crypto, Deferred, Effect, Ref, Schema } from "effect";

import { clipboardMachine } from "../src/client/clipboard/machine.js";
import { NativeClipboardNotice } from "../src/client/clipboard/model.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { clipboardSource } from "./clipboard-fixture.js";
import {
  clipboardClient,
  copiedFact,
  waitClipboard,
} from "./clipboard-runtime-fixture.js";

it.effect.prop(
  "unknown Copy/Cut reads Google before capture or deletion; failed reads and detached sessions never produce a Cut receipt",
  {
    attached: Schema.Boolean,
    detach: Schema.Boolean,
    fails: Schema.Boolean,
    mode: Schema.Literals(["copy", "cut"]),
    supersede: Schema.Boolean,
  },
  ({ mode, fails, detach, attached, supersede }) =>
    Effect.scoped(
      Effect.gen(function* hydratedNativeCopy() {
        const gate = yield* Deferred.make<boolean>();
        const reads = yield* Ref.make(0);
        const base = clipboardClient(0);

        const attachments = attached
          ? [
              {
                mimeType: "application/pdf",
                title: "Fresh file",
                url: "https://example.test/fresh",
              },
            ]
          : [];

        const client = CalendarEditingClient.of({
          ...base.client,
          getEvent: () =>
            Effect.gen(function* freshClipboardEvent() {
              yield* Ref.update(reads, (count) => count + 1);
              yield* Deferred.await(gate);

              if (fails) {
                return yield* new Provider({
                  message: "Synthetic read failure",
                  operation: "getEvent",
                  status: 503,
                });
              }

              return {
                ...clipboardSource,
                attachments,
                title: "Fresh Google title",
              };
            }),
        });

        const deletion = yield* DeletionSession.make().pipe(
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("No direct clipboard deletion"),
            })
          )
        );

        const crypto = yield* Crypto.Crypto;

        const actor = yield* createEffectActor(clipboardMachine, {
          input: { personId: "person-A" },
        }).pipe(
          Effect.provideService(CalendarEditingClient, client),
          Effect.provideService(DeletionSession, deletion),
          Effect.provideService(Crypto.Crypto, crypto)
        );

        yield* watchActor("clipboard.attachments.hydrate", actor);
        yield* send(actor, {
          sessionId: "native-fixture",
          type: "ATTACH_NATIVE",
        });
        const known = copiedFact(1, mode);

        const unknown = NativeClipboardNotice.cases.Copied.make({
          ...known,
          envelope: {
            ...known.envelope,
            items: [
              {
                ...known.envelope.items[0],
                creationFields: {
                  ...known.envelope.items[0].creationFields,
                  attachments: undefined,
                },
              },
            ],
          },
          selfEmails: ["owner@example.test"],
        });

        yield* send(actor, { notice: unknown, type: "NATIVE" });

        const reading = yield* waitClipboard(
          actor,
          (snapshot) =>
            snapshot.matches("hydrating") ||
            snapshot.context.receipt !== undefined ||
            snapshot.context.envelope !== undefined
        );

        expect(reading.matches("hydrating")).toBe(true);
        expect(reading.context.receipt).toBeUndefined();
        expect(reading.context.envelope).toBeUndefined();

        if (supersede) {
          yield* send(actor, {
            notice: {
              ...unknown,
              envelope: { ...unknown.envelope, id: "newer-copy" },
              mode: "copy",
              sequence: 2,
            },
            type: "NATIVE",
          });
          yield* waitClipboard(
            actor,
            (snapshot) => snapshot.context.pendingCopy?.sequence === 2
          );
        }

        if (detach) {
          yield* send(actor, {
            sessionId: "native-fixture",
            type: "DETACH_NATIVE",
          });
        }

        yield* Deferred.succeed(gate, true);

        const done = yield* waitClipboard(
          actor,
          (snapshot) =>
            !snapshot.matches("hydrating") &&
            !snapshot.matches("hydratingAgain")
        );

        if (detach || fails) {
          expect(done.context.receipt).toBeUndefined();
          expect(done.context.envelope).toBeUndefined();

          if (!detach) {
            expect(done.context.toast?.message).toContain(
              "Could not read this event from Google (Provider)"
            );
          }
        } else {
          expect(
            done.context.envelope?.items[0]?.creationFields.attachments
          ).toEqual(attachments);
          expect(done.context.envelope?.items[0]?.content.title).toBe(
            "Fresh Google title"
          );
          expect(
            done.context.envelope?.items[0]?.guests.some(
              (guest) => guest.email === "owner@example.test"
            )
          ).toBe(false);
          expect(done.context.receipt?._tag).toBe(
            mode === "cut" && !supersede ? "Cut" : undefined
          );
          expect(done.context.envelope?.id).toBe(
            supersede ? "newer-copy" : known.envelope.id
          );
        }

        expect(yield* Ref.get(reads)).toBeLessThanOrEqual(supersede ? 2 : 1);
        expect(base.calls).toHaveLength(0);
      })
    ).pipe(Effect.provide(NodeServices.layer))
);
