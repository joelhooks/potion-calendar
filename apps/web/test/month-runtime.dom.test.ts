import {
  CalendarService,
  GoogleCalendarClient,
  listEvents,
} from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { watchActor } from "@calendar/capability/actor-watch";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { createEffectActor, snapshots } from "@xstate/effect";
import { Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { AsyncData, Runtime } from "foldkit";
import type { Mount } from "foldkit";
import { vi } from "vitest";

import {
  fakeGoogle,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import type { AppModel } from "../src/client/app.js";
import { Model, reloadRange, update } from "../src/client/app.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { monthFrame } from "../src/client/month/host.js";
import { monthPointerPoint } from "../src/client/month/pointer.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { monthViewRegistry } from "../src/client/month/view-state.js";
import { monthViewportMountFor } from "../src/client/month/viewport.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { toolbar } from "../src/features/calendar.js";
import { monthGrid } from "../src/features/month-grid.js";
import { monthWindowRange } from "../src/layout/month-window.js";
import { monthGeometry } from "../src/layout/month.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { fixtureModel } from "./fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const changed = <A>(read: () => A | undefined) =>
  Effect.callback<A>((resume) => {
    const check = () => {
      const value = read();

      if (value !== undefined) {
        resume(Effect.succeed(value));
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    check();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

it.effect(
  "the mounted Foldkit month coalesces native scroll ticks, retains the same focused button through a keyed rebase and reads coverage only after scrollend",
  () =>
    Effect.gen(function* mountedMonth() {
      const original = fixtureModel();

      const initial = {
        ...original,
        calendar: {
          ...original.calendar,
          calendars: original.calendar.calendars.filter(
            (calendar) =>
              calendar.accountId === "work" && calendar.calendarId === "primary"
          ),
          navigation: {
            ...original.calendar.navigation,
            mode: "month" as const,
          },
          viewport: 700,
          viewportWidth: 1000,
        },
      };

      const event = timedEvent("a-review", "Product review", {
        end: { dateTime: "2026-10-19T09:57:00-07:00" },
        start: { dateTime: "2026-10-19T09:07:00-07:00" },
      });

      const fake = yield* fakeGoogle(
        Array.from({ length: 8 }, (_unused, index) =>
          response(200, { items: index < 2 ? [event] : [] })
        )
      );

      const rpc = toRpc([listEvents]);

      const calendar = CalendarService.layer.pipe(
        Layer.provide(GoogleCalendarClient.layer),
        Layer.provide(Layer.merge(fake.layer, memoryCalendarStore))
      );

      const backend = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            RpcServer.layerHttp({
              group: rpc.group,
              path: "/rpc",
              protocol: "http",
            }).pipe(
              Layer.provide(rpc.layer),
              Layer.provide(calendar),
              Layer.provide(RpcSerialization.layerJson)
            ),
            { disableLogger: true }
          )
        ),
        (handler) => Effect.promise(handler.dispose.bind(handler))
      );

      let rpcCount = 0;

      // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch adapts the scoped in-memory RPC handler.
      const fetcher: typeof fetch = async (input, init) => {
        rpcCount += 1;

        return await backend.handler(new Request(input, init));
      };

      const container = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const root = document.createElement("div");
          root.id = "month-runtime-proof";
          document.body.append(root);
          vi.spyOn(
            HTMLElement.prototype,
            "clientHeight",
            "get"
          ).mockReturnValue(700);
          vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
            1000
          );
          vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
            1000
          );
          vi.stubGlobal(
            "ResizeObserver",
            class Observer {
              active = false;
              observe() {
                this.active = true;
              }
              disconnect() {
                this.active = false;
              }
            }
          );

          return root;
        }),
        (root) =>
          Effect.sync(() => {
            root.remove();
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
          })
      );

      const editingCalls = yield* Queue.unbounded<typeof EditingCommand.Type>();
      let current: AppModel = initial;

      const monthViews = monthViewRegistry();
      const prepareMonth = monthViewportMountFor(monthViews);

      const program = Runtime.makeElement({
        Model,
        container,
        devTools: false,
        init: () => reloadRange(initial),
        resources: Layer.mergeAll(
          MonthRuntime.layerFor(monthViews),
          Layer.succeed(SearchRuntime, {
            dispatchPage: () => Effect.die("Month must not page search"),
            observe: () => Stream.die("Month must not run search"),
            observePages: () => Stream.die("Month must not start search pages"),
          }),
          unusedClipboardLayer,
          Layer.succeed(CalendarSearchClient, unexpectedSearchClient),
          Layer.succeed(
            EditingRuntime,
            EditingRuntime.of({
              connect: () => Effect.die("Month must not connect editing"),
              dispatch: (_person, command) =>
                Queue.offer(editingCalls, command).pipe(Effect.asVoid),
            })
          ),
          Layer.succeed(FetchHttpClient.Fetch, fetcher)
        ),
        subscriptions: {
          keyboard: subscriptions.keyboard,
          month: subscriptions.month,
        },
        update: (model, message) => {
          const result = update(model, message);
          current = result.model;

          return result;
        },
        view: (model, h) =>
          h.div(
            [
              h.DataAttribute(
                "range-request",
                String(model.calendar.rangeRequest)
              ),
              h.DataAttribute(
                "month-ready",
                String(
                  Option.isNone(model.month.pending) &&
                    model.calendar.reads.every((read) =>
                      AsyncData.isSuccess(read.events)
                    )
                )
              ),
            ],
            [
              toolbar(model, h),
              monthGrid(model, h, monthFrame(model), prepareMonth),
            ]
          ),
      });

      const mounted = yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (handle) =>
          Effect.sync(() => {
            handle.dispose();
          })
      );

      const viewport = yield* changed(() => {
        const element = document.querySelector<HTMLElement>("#month-viewport");

        return element !== null &&
          document.querySelector('[data-month-ready="true"]') !== null &&
          Option.isSome(current.month.frame)
          ? element
          : undefined;
      });

      expect(rpcCount).toBe(1);
      const firstWeek = Number(viewport.dataset.monthFirstWeek);
      const { rowHeight } = monthGeometry(700, false);

      const focused = yield* Effect.fromNullishOr(
        viewport.querySelector<HTMLElement>(
          '.event-chip[aria-label^="Product review"]'
        )
      );

      focused.click();
      focused.focus();
      yield* changed(() =>
        focused.classList.contains("selected") ? true : undefined
      );
      expect(document.activeElement).toBe(focused);

      const gestureRoot = yield* Effect.fromNullishOr(
        document.querySelector<HTMLElement>(".month-view")
      );

      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect"
      ).mockImplementation(function bounds(this: HTMLElement) {
        if (this.classList.contains("month-cell")) {
          const row = this.closest<HTMLElement>(".month-week");
          const date = Number(this.dataset.day);
          const week = Number(row?.dataset.weekStart);

          return new DOMRect(
            100 + (date - week) * 100,
            100 +
              ((week - Number(viewport.dataset.monthFirstWeek)) / 7) *
                rowHeight -
              viewport.scrollTop,
            100,
            rowHeight
          );
        }

        return new DOMRect(100, 100, 700, 6 * rowHeight);
      });

      const cell = yield* Effect.fromNullishOr(
        focused.closest<HTMLElement>(".month-cell")
      );

      const rect = cell.getBoundingClientRect();
      const x = rect.left + 40;
      const y = rect.top + rowHeight / 2;

      const pointer = (type: string, move = false) =>
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX: x + Number(move) * 10,
          clientY: y,
          isPrimary: true,
          pointerId: 9,
        });

      const drag = yield* createEffectActor(gestureMachine);
      yield* watchActor("calendar.month.mountedDrag.test", drag);
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          bindGestureEvents({
            actor: drag,
            getTargets: () =>
              visibleEvents(current).flatMap((item) =>
                Option.toArray(gestureTarget(item, current.calendar.zone))
              ),
            root: gestureRoot,
            scale: 1,
          })
        ),
        (release) => Effect.sync(release)
      );
      focused.dispatchEvent(pointer("pointerdown"));
      yield* snapshots(drag).pipe(
        Stream.filter((snapshot) => snapshot.matches("armed")),
        Stream.runHead
      );
      window.dispatchEvent(pointer("pointermove", true));
      yield* snapshots(drag).pipe(
        Stream.filter((snapshot) => snapshot.matches("dragging")),
        Stream.runHead
      );

      for (const rows of [6.5, 7, 8]) {
        viewport.scrollTop = rows * rowHeight;
        viewport.dispatchEvent(new Event("scroll"));
      }

      viewport.dispatchEvent(new Event("scrollend"));
      yield* changed(() =>
        document.querySelector(".toolbar h2")?.textContent === "November 2026"
          ? true
          : undefined
      );
      expect(rpcCount).toBe(1);
      viewport.scrollTop = 10 * rowHeight;

      const beforeRebase = Option.getOrThrow(
        monthPointerPoint(gestureRoot, pointer("pointermove", true))
      );

      viewport.dispatchEvent(new Event("scroll"));
      yield* changed(() =>
        Number(viewport.dataset.monthFirstWeek) !== firstWeek &&
        Number(viewport.dataset.monthRebaseId) > 0
          ? true
          : undefined
      );
      expect(rpcCount).toBe(1);
      expect(document.activeElement).toBe(focused);
      expect(focused.isConnected).toBe(true);
      expect(
        viewport.querySelectorAll(".month-week").length
      ).toBeLessThanOrEqual(19);
      viewport.dispatchEvent(new Event("scrollend"));
      yield* changed(() =>
        rpcCount === 2 &&
        document.querySelector('[data-month-ready="true"]') !== null
          ? true
          : undefined
      );
      expect(rpcCount).toBe(2);
      expect(document.activeElement).toBe(focused);
      expect(Option.getOrThrow(current.month.range)).toEqual(
        monthWindowRange(Number(viewport.dataset.monthFirstWeek))
      );

      const afterRebase = Option.getOrThrow(
        monthPointerPoint(gestureRoot, pointer("pointermove", true))
      );

      expect(afterRebase.day).toBe(beforeRebase.day);
      window.dispatchEvent(pointer("pointermove", true));

      const moved = yield* snapshots(drag).pipe(
        Stream.filter(
          (snapshot) =>
            snapshot.context.preview?.range.startDate !== undefined &&
            dayFromIso(snapshot.context.preview.range.startDate) ===
              afterRebase.day
        ),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption)
      );

      expect(moved.context.preview?.range).toMatchObject({
        allDay: false,
        endTime: "09:57",
        startTime: "09:07",
      });
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        })
      );
      yield* snapshots(drag).pipe(
        Stream.filter((snapshot) => snapshot.matches("idle")),
        Stream.runHead
      );
      expect(drag.getSnapshot().context.sequence).toBe(0);

      const beforeParkLabel =
        document.querySelector(".toolbar h2")?.textContent;

      const beforePark = Number(viewport.dataset.monthFirstWeek);
      viewport.scrollTop = 12 * rowHeight;
      viewport.dispatchEvent(new Event("scroll"));
      yield* changed(() =>
        Number(viewport.dataset.monthFirstWeek) > beforePark &&
        viewport.querySelector("[data-month-parked]") !== null
          ? true
          : undefined
      );
      expect(document.activeElement).toBe(focused);
      expect(focused.closest("[data-month-parked]")).not.toBeNull();
      expect(document.querySelector(".toolbar h2")?.textContent).toBe(
        beforeParkLabel
      );
      viewport.dispatchEvent(new Event("scrollend"));
      yield* changed(() =>
        rpcCount === 3 &&
        document.querySelector('[data-month-ready="true"]') !== null
          ? true
          : undefined
      );
      expect(document.activeElement).toBe(focused);
      expect(focused.isConnected).toBe(true);
      expect(viewport.querySelectorAll(".month-week")).toHaveLength(19);
      expect(rpcCount).toBe(3);
      yield* changed(() =>
        document.querySelector(".toolbar h2")?.textContent === "December 2026"
          ? true
          : undefined
      );
      focused.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      );
      const opened = yield* Queue.take(editingCalls);
      expect(EditingCommand.guards.Open(opened)).toBe(true);

      if (EditingCommand.guards.Open(opened)) {
        expect(opened.request._tag).toBe("Existing");

        if (EditorRequest.guards.Existing(opened.request)) {
          expect(opened.request.event.eventId).toBe("a-review");
        }
      }

      const providerRequests = yield* Ref.get(fake.requests);
      expect(providerRequests).toHaveLength(3);
      expect(
        providerRequests.every((request) => request.method === "GET")
      ).toBe(true);
      const released = yield* Queue.unbounded<string>();
      const remove = viewport.removeEventListener.bind(viewport);
      vi.spyOn(viewport, "removeEventListener").mockImplementation(
        (type, listener, options) => {
          remove(type, listener, options);

          if (type === "scroll" || type === "scrollend") {
            Queue.offerUnsafe(released, type);
          }
        }
      );
      const states = yield* Queue.unbounded<Mount.ViewState>();
      const previousSession = Option.getOrThrow(current.month.frame).session.id;
      const previousOffset = viewport.scrollTop;
      yield* prepareMonth()
        .f(gestureRoot, Stream.fromQueue(states))
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Queue.offer(states, "Paused");
      expect(
        new Set([yield* Queue.take(released), yield* Queue.take(released)])
      ).toEqual(new Set(["scroll", "scrollend"]));
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(new Event("scrollend"));
      expect(rpcCount).toBe(3);
      yield* Queue.offer(states, "Live");
      yield* changed(() =>
        (Option.getOrUndefined(current.month.frame)?.session.id ?? 0) >
          previousSession &&
        Math.abs(viewport.scrollTop - previousOffset) < 0.001 &&
        document.querySelector('[data-month-ready="true"]') !== null
          ? true
          : undefined
      );
      expect(document.activeElement).toBe(focused);
      expect(document.querySelector(".toolbar h2")?.textContent).toBe(
        "December 2026"
      );
      expect(rpcCount).toBe(3);
      mounted.dispose();
      expect(
        new Set([yield* Queue.take(released), yield* Queue.take(released)])
      ).toEqual(new Set(["scroll", "scrollend"]));
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(new Event("scrollend"));
      expect(rpcCount).toBe(3);
    })
);
