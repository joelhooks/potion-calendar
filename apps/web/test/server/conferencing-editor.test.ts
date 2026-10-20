import { CalendarEvent } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Context, Crypto, Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { vi } from "vitest";

import { CalendarEditingClient } from "../../src/client/editing/calendar-client.js";
import { savedConferencingNotice } from "../../src/client/editing/conferencing-notice.js";
import { DeletionWriter } from "../../src/client/editing/delete-actor.js";
import { DeletionSession } from "../../src/client/editing/deletion-session.js";
import { EditorAction } from "../../src/client/editing/editor-action.js";
import { eventEditorMachine } from "../../src/client/editing/editor-machine.js";
import {
  EditorMutation,
  EditorRequest,
} from "../../src/client/editing/editor-session-model.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { dayFromIso, initialNavigation } from "../../src/layout/navigation.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class EditorMeetRpc extends Context.Service<
  EditorMeetRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/EditorMeetRpc") {}

const fixtureLayer = Layer.effect(EditorMeetRpc, settingsRpcFixture).pipe(
  Layer.provide(
    DevelopmentRuntime.layer("http://127.0.0.1:5173", undefined, "failure")
  )
);

type Actor = EffectActor<typeof eventEditorMachine>;

const waitFor = (
  actor: Actor,
  predicate: (snapshot: ReturnType<Actor["getSnapshot"]>) => boolean
) =>
  snapshots(actor).pipe(
    Stream.filter(
      (snapshot) =>
        snapshot.status === "error" ||
        snapshot.context.failure !== undefined ||
        predicate(snapshot)
    ),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
    Effect.filterOrElse(
      (snapshot) =>
        snapshot.status !== "error" && snapshot.context.failure === undefined,
      (snapshot) =>
        Effect.die(
          snapshot.status === "error"
            ? snapshot.error
            : snapshot.context.failure
        )
    )
  );

layer(fixtureLayer, { excludeTestServices: true })(
  "native editor conferencing",
  (it) => {
    it.effect(
      "the existing editor writer retries failed conferencing on the saved event and confirms removal through authenticated Worker RPC without creating a duplicate event",
      () =>
        Effect.gen(function* nativeEditorSave() {
          const fixture = yield* EditorMeetRpc;
          const { accountId, calendarId } = fixture.target;
          vi.stubGlobal("location", new URL(fixture.origin));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => vi.unstubAllGlobals())
          );

          const plain = yield* fixture.success(
            "createEvent",
            {
              accountId,
              calendarId,
              event: {
                end: { dateTime: "2026-10-20T11:00:00Z" },
                start: { dateTime: "2026-10-20T10:00:00Z" },
                title: "Native editor meeting",
              },
              id: "editorplain",
            },
            CalendarEvent
          );

          // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch forwards editor RPC to the authenticated local Worker.
          const fetcher: typeof fetch = async (input, init) => {
            const request = new Request(
              input instanceof Request
                ? input
                : new URL(input.toString(), fixture.origin),
              init
            );

            const headers = new Headers(request.headers);
            headers.set("cookie", fixture.runtime.person.cookie);
            headers.set("origin", fixture.origin);
            headers.set("sec-fetch-site", "same-origin");

            const forwarded = new Request(
              `${fixture.origin}${new URL(request.url).pathname}`,
              request
            );

            return await fixture.runtime.handle(
              new Request(forwarded, { headers })
            );
          };

          const client = yield* CalendarEditingClient.pipe(
            Effect.provide(CalendarEditingClient.layer("available"))
          );

          const deletion = yield* DeletionSession.make().pipe(
            Effect.provideService(
              DeletionWriter,
              DeletionWriter.of({
                commit: () => Effect.die("Unexpected delete"),
              })
            )
          );

          const crypto = yield* Crypto.Crypto;

          const actor = yield* createEffectActor(eventEditorMachine).pipe(
            Effect.provideService(CalendarEditingClient, client),
            Effect.provideService(DeletionSession, deletion),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(FetchHttpClient.Fetch, fetcher)
          );

          yield* watchActor("calendar.editor.conferencing.native", actor);

          const request = (event: typeof CalendarEvent.Type) =>
            EditorRequest.cases.Existing.make({
              calendars: fixture.calendars,
              event,
              mode: "edit",
              navigation: initialNavigation(dayFromIso("2026-10-20")),
              primaryZone: "UTC",
              selection: Option.none(),
            });

          yield* send(actor, { request: request(plain), type: "OPEN" });
          yield* waitFor(actor, (snapshot) => snapshot.matches("editing"));
          yield* send(actor, {
            action: EditorAction.cases.AddMeet.make({}),
            type: "ACTION",
          });
          yield* waitFor(
            actor,
            (snapshot) =>
              snapshot.matches("editing") &&
              snapshot.context.session?.draft.conferencing?.request?.kind ===
                "googleMeet"
          );
          yield* send(actor, {
            action: EditorAction.cases.Save.make({}),
            type: "ACTION",
          });

          const first = yield* waitFor(actor, (snapshot) =>
            snapshot.matches("closed")
          );

          const saved = yield* Schema.decodeUnknownEffect(
            EditorMutation.cases.Saved
          )(first.context.mutation).pipe(Effect.orDie);

          expect(saved.event.conferencingStatus).toBe("failed");
          expect(saved.event.conferenceUrl).toBeUndefined();
          expect(saved.plan.sendUpdates).toBe("none");
          expect(Option.getOrThrow(savedConferencingNotice(saved)).status).toBe(
            "failed"
          );

          yield* send(actor, { request: request(saved.event), type: "OPEN" });
          yield* waitFor(actor, (snapshot) => snapshot.matches("editing"));
          yield* send(actor, {
            action: EditorAction.cases.AddMeet.make({}),
            type: "ACTION",
          });
          yield* waitFor(
            actor,
            (snapshot) =>
              snapshot.matches("editing") &&
              snapshot.context.session?.draft.conferencing?.request?.kind ===
                "googleMeet"
          );
          yield* send(actor, {
            action: EditorAction.cases.Save.make({}),
            type: "ACTION",
          });

          const retried = yield* waitFor(actor, (snapshot) =>
            snapshot.matches("closed")
          );

          const retryResult = yield* Schema.decodeUnknownEffect(
            EditorMutation.cases.Saved
          )(retried.context.mutation).pipe(Effect.orDie);

          expect(retryResult.event.eventId).toBe(plain.eventId);
          expect(retryResult.event.conferencingStatus).toBe("failed");
          yield* send(actor, {
            request: request(retryResult.event),
            type: "OPEN",
          });
          yield* waitFor(actor, (snapshot) => snapshot.matches("editing"));
          yield* send(actor, {
            action: EditorAction.cases.RemoveConferencing.make({}),
            type: "ACTION",
          });
          yield* waitFor(
            actor,
            (snapshot) =>
              snapshot.matches("editing") &&
              snapshot.context.session?.draft.conferencing?.request?.kind ===
                "none"
          );
          yield* send(actor, {
            action: EditorAction.cases.Save.make({}),
            type: "ACTION",
          });

          const last = yield* waitFor(actor, (snapshot) =>
            snapshot.matches("closed")
          );

          const removed = yield* Schema.decodeUnknownEffect(
            EditorMutation.cases.Saved
          )(last.context.mutation).pipe(Effect.orDie);

          expect(removed.event.eventId).toBe(plain.eventId);
          expect(removed.event.conferencingStatus).toBeUndefined();
          expect(removed.event.conferenceUrl).toBeUndefined();
          expect(
            Option.getOrThrow(savedConferencingNotice(removed)).status
          ).toBe("removed");
          expect(
            fixture.runtime.outboundRequests.filter(
              (outbound) =>
                outbound.method === "POST" && outbound.path.endsWith("/events")
            )
          ).toHaveLength(1);
          expect(
            fixture.runtime.outboundRequests.filter(
              (outbound) =>
                outbound.method === "PATCH" &&
                outbound.path.endsWith(`/events/${plain.eventId}`)
            )
          ).toHaveLength(3);
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
);
