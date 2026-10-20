import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { createEffectActor, snapshots } from "@xstate/effect";
import {
  Context,
  Crypto,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { initialModel, Message, update } from "../../src/client/app.js";
import { clipboardCreatorMachine } from "../../src/client/clipboard/creator-machine.js";
import { ClipboardAnchor } from "../../src/client/clipboard/model.js";
import { prepareClipboardPaste } from "../../src/client/clipboard/prepare.js";
import { ReadSession } from "../../src/client/commands.js";
import { editorConferencingContext } from "../../src/client/conferencing/editor-context.js";
import { ConferencingChange } from "../../src/client/conferencing/model.js";
import { CalendarEditingClient } from "../../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../../src/client/editing/delete-actor.js";
import { DeletionSession } from "../../src/client/editing/deletion-session.js";
import { EditorRequest } from "../../src/client/editing/editor-session-model.js";
import { loadEditor } from "../../src/client/editing/load-editor.js";
import { prepareEditor } from "../../src/client/editing/prepare-editor.js";
import { EditingRuntime } from "../../src/client/editing/runtime.js";
import { mutationReceived } from "../../src/client/editing/update.js";
import { writeEditor } from "../../src/client/editing/write-editor.js";
import { MonthRuntime } from "../../src/client/month/runtime.js";
import { CalendarSearchClient } from "../../src/client/search/client.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { view } from "../../src/features/app.js";
import { dayFromIso, initialNavigation } from "../../src/layout/navigation.js";
import { AccountSettingsRoute } from "../../src/layout/route.js";
import { clipboardItem, clipboardSource } from "../clipboard-fixture.js";
import { unusedClipboardLayer } from "../clipboard-unused-fixture.js";
import { unexpectedSearchClient } from "../search-fixture.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class ConferencingRoots extends Context.Service<
  ConferencingRoots,
  Effect.Success<typeof settingsRpcFixture>
>()("test/ConferencingRoots") {}

const fixtureLayer = Layer.effect(ConferencingRoots, settingsRpcFixture).pipe(
  Layer.provide(
    DevelopmentRuntime.layer("http://127.0.0.1:5173", undefined, "failure")
  )
);

layer(fixtureLayer, { excludeTestServices: true })(
  "mounted conferencing",
  (it) => {
    it.effect(
      "authenticated defaults reach the account page, pending guest Save and clipboard child create without copying native conferencing",
      () =>
        Effect.gen(function* nativeConferencingRoots() {
          const fixture = yield* ConferencingRoots;
          const { accountId, calendarId } = fixture.target;
          vi.stubGlobal("location", new URL(fixture.origin));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => vi.unstubAllGlobals())
          );

          // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch forwards client commands to the authenticated local Worker.
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

            return await fixture.runtime.handle(
              new Request(request, { headers })
            );
          };

          yield* Effect.gen(function* authenticatedFlow() {
            const authenticated = update(
              initialModel(0, "UTC"),
              yield* ReadSession().effect
            );

            let { model } = authenticated;

            for (const command of authenticated.commands ?? []) {
              if (command.name === "ReadConferencingDefault") {
                ({ model } = update(model, yield* command.effect));
              }
            }

            expect(
              editorConferencingContext(model).accounts.find(
                (account) => account.accountId === accountId
              )?.setting
            ).toBe("unset");

            const requested = update(
              model,
              Message.ChangedConferencing({
                change: ConferencingChange.cases.Set.make({
                  accountId,
                  value: "googleMeet",
                }),
              })
            );

            ({ model } = requested);

            for (const command of requested.commands ?? []) {
              ({ model } = update(model, yield* command.effect));
            }

            expect(
              editorConferencingContext(model).accounts.find(
                (account) => account.accountId === accountId
              )?.setting
            ).toBe("googleMeet");
            model = {
              ...model,
              route: AccountSettingsRoute.make({ accountId }),
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            expect(rendered.html).toContain(
              `conferencing-default-${accountId}`
            );
            expect(rendered.html).toContain(
              "Adds Meet when you invite another person"
            );

            const client = yield* CalendarEditingClient;
            const crypto = yield* Crypto.Crypto;

            const deletion = yield* DeletionSession.make().pipe(
              Effect.provideService(
                DeletionWriter,
                DeletionWriter.of({
                  commit: () => Effect.die("Unexpected deletion"),
                })
              )
            );

            const context = editorConferencingContext(model);
            const navigation = initialNavigation(dayFromIso("2026-10-20"));

            const normal = EditorRequest.cases.New.make({
              allDay: false,
              calendars: [fixture.target],
              conferencingContext: context,
              endDate: "2026-10-20",
              endTime: "11:00",
              navigation,
              primaryZone: "UTC",
              ref: { accountId, calendarId },
              selection: Option.none(),
              startDate: "2026-10-20",
              startTime: "10:00",
            });

            const loaded = yield* loadEditor(normal);
            expect(loaded.draft.conferencing?.request).toBeUndefined();

            const plan = yield* prepareEditor({
              ...loaded,
              draft: {
                ...loaded.draft,
                participantEmail: "guest@example.test",
                title: "Pending guest Meet",
              },
            });

            expect(plan.session.draft.conferencing?.request).toEqual({
              kind: "googleMeet",
            });
            expect(plan.sendUpdates).toBe("none");

            const mutation = yield* writeEditor(plan).pipe(
              Effect.provideService(DeletionSession, deletion)
            );

            expect(mutation._tag).toBe("Saved");

            if (Predicate.isTagged(mutation, "Saved")) {
              expect(mutation.event.conferencingStatus).toBe("failed");
              ({ model } = mutationReceived(model, mutation));

              const savedView = yield* renderToString(
                { init: () => ({ model }), view },
                { isHydratable: false }
              );

              expect(savedView.html).toContain("Saved event conferencing");
              expect(savedView.html).toContain(
                "could not create its conferencing"
              );
            }

            const explicit = yield* loadEditor(normal);

            const explicitPlan = yield* prepareEditor({
              ...explicit,
              draft: {
                ...explicit.draft,
                conferencing: {
                  participantSeen: false,
                  request: { kind: "none" },
                },
                participantEmail: "guest@example.test",
              },
            });

            const withoutMeet = yield* writeEditor(explicitPlan).pipe(
              Effect.provideService(DeletionSession, deletion)
            );

            expect(withoutMeet._tag).toBe("Saved");

            if (Predicate.isTagged(withoutMeet, "Saved")) {
              expect(withoutMeet.event.conferencingStatus).toBeUndefined();
              expect(withoutMeet.event.conferenceUrl).toBeUndefined();
            }

            const item = clipboardItem(clipboardSource);

            const prepared = yield* prepareClipboardPaste({
              choice: "includeAndEmail",
              pending: {
                anchor: ClipboardAnchor.cases.Timed.make({
                  date: "2026-10-21",
                  instant: DateTime.toEpochMillis(
                    DateTime.makeUnsafe("2026-10-21T10:00:00Z")
                  ),
                }),
                copyId: "conference-copy",
                intentId: "conference-paste",
                item,
                target: {
                  calendar: fixture.target,
                  conferencingContext: context,
                  navigation,
                  primaryZone: "UTC",
                  selection: Option.none(),
                },
              },
            });

            expect(prepared._tag).toBe("Prepared");

            if (Predicate.isTagged(prepared, "Refused")) {
              return yield* Effect.die(prepared.failure);
            }

            const includedTemplate = yield* Effect.fromNullishOr(
              prepared.request.template
            ).pipe(Effect.orDie);

            const excluded = yield* loadEditor({
              ...prepared.request,
              template: {
                ...includedTemplate,
                guestChoice: "exclude",
                guests: [],
              },
            });

            expect(excluded.draft.attendees).toHaveLength(0);
            expect(excluded.draft.conferencing?.request).toBeUndefined();

            const pasted = yield* loadEditor(prepared.request);
            expect(pasted.draft.conferencing?.request).toEqual({
              kind: "googleMeet",
            });
            const pastePlan = yield* prepareEditor(pasted);
            expect(pastePlan.sendUpdates).toBe("none");
            expect(pastePlan.fields.guestsCanModify).toBe(false);

            const actor = yield* createEffectActor(clipboardCreatorMachine, {
              input: { request: prepared.request },
            }).pipe(
              Effect.provideService(CalendarEditingClient, client),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(DeletionSession, deletion)
            );

            yield* watchActor("calendar.conferencing.clipboard.joint", actor);

            const final = yield* snapshots(actor).pipe(
              Stream.filter(
                (snapshot) =>
                  snapshot.status === "done" ||
                  snapshot.status === "error" ||
                  snapshot.matches({ active: "failed" }) ||
                  snapshot.matches({ active: "refused" })
              ),
              Stream.runHead,
              Effect.flatMap(Effect.fromOption)
            );

            expect(final.status, JSON.stringify(final.context.failure)).toBe(
              "done"
            );
            const { outcome } = final.context;
            expect(outcome?._tag).toBe("Saved");

            if (outcome !== undefined && Predicate.isTagged(outcome, "Saved")) {
              expect(outcome.mutation.event.conferencingStatus).toBe("failed");
              expect(outcome.mutation.plan.sendUpdates).toBe("all");
              ({ model } = mutationReceived(model, outcome.mutation));
              expect(
                Option.getOrThrow(model.editing.conferencingResult).eventId
              ).toBe(outcome.mutation.event.eventId);
            }

            const requests = fixture.runtime.outboundRequests;

            const posts = requests.filter(
              (request) =>
                request.method === "POST" && request.path.endsWith("/events")
            );

            expect(posts).toHaveLength(3);

            return posts.length;
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                unusedClipboardLayer,
                Layer.succeed(CalendarSearchClient, unexpectedSearchClient),
                CalendarEditingClient.layer("available"),
                EditingRuntime.layer.pipe(
                  Layer.provide(CalendarEditingClient.layer("available")),
                  Layer.provide(
                    Layer.succeed(
                      DeletionWriter,
                      DeletionWriter.of({
                        commit: () => Effect.die("Unexpected deletion"),
                      })
                    )
                  )
                )
              )
            ),
            Effect.provideService(FetchHttpClient.Fetch, fetcher)
          );
        }).pipe(
          Effect.provide(Layer.merge(NodeServices.layer, MonthRuntime.layer))
        )
    );
  }
);
