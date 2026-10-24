import { CalendarEvent, CalendarStore } from "@calendar/calendar";
import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../../src/client/app.js";
import type { AppModel } from "../../src/client/app.js";
import { ReadEventAttachments } from "../../src/client/attachments/commands.js";
import { eventKey, RemoteEvents } from "../../src/client/calendar-state.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { view } from "../../src/features/app.js";
import { visibleEvents } from "../../src/layout/presentation.js";
import { SearchRoute } from "../../src/layout/route.js";
import { d1CalendarStore } from "../../src/server/calendar-store.js";
import { fixtureSelection } from "../fixture.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

// oxlint-disable-next-line typescript/promise-function-async -- Fetch is a native Promise adapter; this fixed reply models transport refusal.
const refusedFetch: typeof fetch = () =>
  Promise.resolve(new Response("Unavailable", { status: 503 }));

class AttachmentCache extends Context.Service<
  AttachmentCache,
  Effect.Success<typeof settingsRpcFixture>
>()("test/AttachmentCache") {}

const fixtureLayer = Layer.effect(AttachmentCache, settingsRpcFixture).pipe(
  Layer.provide(DevelopmentRuntime.layer("http://127.0.0.1:5173"))
);

layer(fixtureLayer, { excludeTestServices: true })(
  "lazy attachment cache",
  (it) => {
    it.effect(
      "concurrent details opens read once, persist the known list under the same D1 version and never reset synchronization; a failed read leaves the event open",
      () =>
        Effect.gen(function* lazyAttachmentCache() {
          const fixture = yield* AttachmentCache;
          const { accountId, calendarId } = fixture.target;

          const attachments = [
            {
              mimeType: "text/plain",
              title: "Hydrated notes",
              url: "https://example.test/notes",
            },
          ];

          const source = yield* fixture.success(
            "createEvent",
            {
              accountId,
              calendarId,
              event: {
                attachments,
                end: { dateTime: "2026-10-20T11:00:00Z" },
                start: { dateTime: "2026-10-20T10:00:00Z" },
                title: "Cached event",
              },
              id: "a77ac1",
            },
            CalendarEvent
          );

          const unknown = { ...source, attachments: undefined };

          const range = {
            end: "2026-10-26T00:00:00Z",
            start: "2026-10-19T00:00:00Z",
          };

          const { personId } = fixture.runtime.person;

          const storeLayer = d1CalendarStore(
            fixture.runtime.database,
            personId
          );

          const before = yield* CalendarStore.use((store) =>
            store.read(source)
          ).pipe(Effect.provide(storeLayer));

          yield* CalendarStore.use((store) =>
            store.cacheRange(source, range, before.version, [unknown])
          ).pipe(Effect.provide(storeLayer));
          const base = fixtureSelection();

          const model = {
            ...base,
            calendar: {
              ...base.calendar,
              calendars: [fixture.target],
              reads: [
                {
                  accountId,
                  events: RemoteEvents.Success({
                    data: {
                      events: [unknown],
                      versions: [
                        { accountId, calendarId, version: before.version },
                      ],
                    },
                  }),
                },
              ],
              selected: [],
            },
            person: Option.some(personId),
          };

          vi.stubGlobal("location", new URL(fixture.origin));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => vi.unstubAllGlobals())
          );

          // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch forwards the actual generated read command to the authenticated local Worker.
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

          const selectedKey = Option.getOrThrow(
            Option.fromUndefinedOr(visibleEvents(model)[0])
          ).key;

          const start = fixture.runtime.outboundRequests.length;

          const opening = update(
            model,
            Message.ClickedEvent({ key: selectedKey })
          );

          expect(
            opening.commands?.filter(
              (command) => command.name === "ReadEventAttachments"
            )
          ).toHaveLength(1);

          const concurrent = update(
            opening.model,
            Message.ClickedEvent({ key: selectedKey })
          );

          expect(
            concurrent.commands?.filter(
              (command) => command.name === "ReadEventAttachments"
            ) ?? []
          ).toHaveLength(0);

          const received = yield* ReadEventAttachments({
            original: unknown,
            personId,
            requestId: opening.model.attachmentReads.nextRequestId,
          }).effect.pipe(Effect.provideService(FetchHttpClient.Fetch, fetcher));

          const foreign = update(
            concurrent.model,
            Message.ReceivedEventAttachments({
              result: { ...received.result, personId: "someone-else" },
            })
          );

          expect(foreign.model.calendar.reads).toEqual(
            concurrent.model.calendar.reads
          );

          const stale = update(
            concurrent.model,
            Message.ReceivedEventAttachments({
              result: {
                ...received.result,
                requestId: received.result.requestId + 1,
              },
            })
          );

          expect(stale.model.calendar.reads).toEqual(
            concurrent.model.calendar.reads
          );

          const hydrated = update(concurrent.model, received).model;

          const rendered = yield* renderToString(
            { init: () => ({ model: hydrated }), view },
            { isHydratable: false }
          );

          expect(rendered.html).toContain("Hydrated notes");
          const closed = update(hydrated, Message.ClosedDetail()).model;

          const reopened = update(
            closed,
            Message.ClickedEvent({ key: selectedKey })
          );

          expect(
            reopened.commands?.filter(
              (command) => command.name === "ReadEventAttachments"
            ) ?? []
          ).toHaveLength(0);
          const requests = fixture.runtime.outboundRequests.slice(start);
          expect(
            requests.filter(
              (request) =>
                request.method === "GET" &&
                request.path.endsWith(`/events/${source.eventId}`)
            )
          ).toHaveLength(1);
          expect(requests).toHaveLength(1);

          const fallbackCalendar = {
            ...model.calendar,
            mergeDuplicates: false,
            reads: [],
          };

          const fallbackRows = {
            events: [unknown],
            versions: [{ accountId, calendarId, version: before.version }],
          };

          const variants: readonly AppModel[] = [
            {
              ...model,
              calendar: fallbackCalendar,
              upcoming: {
                ...model.upcoming,
                data: RemoteEvents.Success({ data: fallbackRows }),
              },
            },
            {
              ...model,
              calendar: fallbackCalendar,
              route: SearchRoute.make({ q: "files" }),
              search: {
                ...model.search,
                phase: "Ready",
                response: Option.some({
                  accountFailures: [],
                  failures: [],
                  pageInfo: [],
                  results: [
                    {
                      calendar: fixture.target,
                      endMillis: DateTime.toEpochMillis(
                        DateTime.makeUnsafe("2026-10-20T11:00:00Z")
                      ),
                      event: unknown,
                      startMillis: DateTime.toEpochMillis(
                        DateTime.makeUnsafe("2026-10-20T10:00:00Z")
                      ),
                    },
                  ],
                  window: {
                    boundary: range.start,
                    endExclusive: range.end,
                    historyStart: "2016-10-20T00:00:00Z",
                  },
                }),
              },
            },
          ];

          for (const variant of variants) {
            const selected = update(
              variant,
              Message.ClickedEvent({ key: eventKey(source) })
            );

            expect(
              selected.commands?.filter(
                (command) => command.name === "ReadEventAttachments"
              )
            ).toHaveLength(1);

            const reply = yield* ReadEventAttachments({
              original: unknown,
              personId,
              requestId: selected.model.attachmentReads.nextRequestId,
            }).effect.pipe(
              Effect.provideService(FetchHttpClient.Fetch, fetcher)
            );

            const ready = update(selected.model, reply).model;
            expect(
              visibleEvents(ready).find((item) => item.selected)?.source
                .attachments
            ).toEqual(attachments);
            expect(
              update(
                ready,
                Message.ClickedEvent({ key: eventKey(source) })
              ).commands?.filter(
                (command) => command.name === "ReadEventAttachments"
              ) ?? []
            ).toHaveLength(0);
          }

          const after = yield* CalendarStore.use((store) =>
            store.read(source)
          ).pipe(Effect.provide(storeLayer));

          expect(after).toEqual(before);

          const cached = yield* CalendarStore.use((store) =>
            store.readRange(source, range, after.version)
          ).pipe(Effect.provide(storeLayer));

          expect(cached?.[0]?.attachments).toEqual(attachments);

          yield* CalendarStore.use((store) =>
            store.hydrateEvent === undefined
              ? Effect.die("Missing D1 hydration port")
              : store.hydrateEvent(source, before.version, {
                  ...source,
                  title: "Foreign cache write",
                })
          ).pipe(
            Effect.provide(
              d1CalendarStore(fixture.runtime.database, "another-person")
            )
          );
          expect(
            (yield* CalendarStore.use((store) =>
              store.readRange(source, range, before.version)
            ).pipe(Effect.provide(storeLayer)))?.[0]?.title
          ).toBe("Cached event");

          const changedVersion = yield* CalendarStore.use((store) =>
            store.invalidate(source)
          ).pipe(Effect.provide(storeLayer));

          yield* CalendarStore.use((store) =>
            store.cacheRange(source, range, changedVersion, [
              { ...source, title: "Newer cached title" },
            ])
          ).pipe(Effect.provide(storeLayer));

          yield* CalendarStore.use((store) =>
            store.hydrateEvent === undefined
              ? Effect.die("Missing D1 hydration port")
              : store.hydrateEvent(source, before.version, {
                  ...source,
                  title: "Stale read must not overwrite",
                })
          ).pipe(Effect.provide(storeLayer));

          const newer = yield* CalendarStore.use((store) =>
            store.readRange(source, range, changedVersion)
          ).pipe(Effect.provide(storeLayer));

          expect(newer?.[0]?.title).toBe("Newer cached title");

          const failedOpening = update(
            model,
            Message.ClickedEvent({ key: selectedKey })
          );

          const failed = yield* ReadEventAttachments({
            original: unknown,
            personId,
            requestId: failedOpening.model.attachmentReads.nextRequestId,
          }).effect.pipe(
            Effect.provideService(FetchHttpClient.Fetch, refusedFetch)
          );

          const failedModel = update(failedOpening.model, failed).model;

          const failedView = yield* renderToString(
            { init: () => ({ model: failedModel }), view },
            { isHydratable: false }
          );

          expect(failedView.html).toContain("Cached event");
          expect(failedView.html).not.toContain("Hydrated notes");
          expect(failedModel.calendar.selected).toEqual([selectedKey]);

          const noLoop = update(
            failedModel,
            Message.ClickedEvent({ key: selectedKey })
          );

          expect(
            noLoop.commands?.filter(
              (command) => command.name === "ReadEventAttachments"
            ) ?? []
          ).toHaveLength(0);

          return requests.length;
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
);
