import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Predicate, Queue, Stream } from "effect";
import { AsyncData, Runtime } from "foldkit";
import { vi } from "vitest";

import { Model, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import { gestureSubscriptions } from "../src/client/editing/gesture-subscription.js";
import { gestureTargetRegistry } from "../src/client/editing/gesture-targets.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { gestureRefusalNotice } from "../src/features/gesture-refusal.js";
import { monthGrid } from "../src/features/month-grid.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { fixtureModel } from "./fixture.js";
import { saveMonthGestureThroughRpc } from "./month-gesture-write-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const untilDom = <A>(read: () => A | undefined) =>
  Effect.callback<A>((resume) => {
    const check = () => {
      const result = read();

      if (result !== undefined) {
        resume(Effect.succeed(result));
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

const pointer = (
  type: string,
  y: number,
  receiver: EventTarget = window,
  alt = false
) =>
  receiver.dispatchEvent(
    new PointerEvent(type, {
      altKey: alt,
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 150,
      clientY: y,
      isPrimary: true,
      pointerId: 17,
    })
  );

it.effect.each([false, true])(
  "production month mount respects multi-selection and read-only refusal (read-only: %s)",
  (readOnly) =>
    Effect.gen(function* productionMonthGesture() {
      const original = fixtureModel();

      const base = {
        ...original,
        calendar: {
          ...original.calendar,
          reads: original.calendar.reads.map((read) => {
            const data = Option.getOrThrow(AsyncData.getData(read.events));

            return {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  ...data,
                  events: data.events.map((event) =>
                    event.eventId === "a-review"
                      ? { ...event, iCalUID: "a-review@fake.test" }
                      : event
                  ),
                },
              }),
            };
          }),
        },
      };

      const navigation = {
        ...base.calendar.navigation,
        mode: "month" as const,
      };

      const events = visibleEvents(base).filter(
        (event) => event.startDay === dayFromIso("2026-10-19")
      );

      const target = events.find((event) => event.title === "Product review");

      if (target === undefined) {
        throw new Error("Missing production gesture target");
      }

      const selected = visibleEvents(base)
        .slice(0, 3)
        .map((event) => event.key);

      if (!selected.includes(target.key)) {
        selected[0] = target.key;
      }

      let current: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) =>
            readOnly &&
            calendar.accountId === target.calendar.accountId &&
            calendar.calendarId === target.calendar.calendarId
              ? { ...calendar, accessRole: "reader" }
              : calendar
          ),
          navigation,
          reads: base.calendar.reads.map((read) => ({
            ...read,
            events: RemoteEvents.Success({
              data: {
                ...Option.getOrThrow(AsyncData.getData(read.events)),
                events: Option.getOrThrow(
                  AsyncData.getData(read.events)
                ).events.map((event) =>
                  event.eventId === target.source.eventId
                    ? {
                        ...event,
                        end: { dateTime: "2026-10-19T09:57:00-07:00" },
                        organizer: { email: "owner@example.test", self: true },
                        start: { dateTime: "2026-10-19T09:07:00-07:00" },
                      }
                    : {
                        ...event,
                        organizer: { email: "owner@example.test", self: true },
                      }
                ),
              },
            }),
          })),
          selected,
          viewport: 700,
          viewportWidth: 1000,
        },
      };

      const commands = yield* Queue.unbounded<typeof EditingCommand.Type>();
      const registry = gestureTargetRegistry();
      const prepare = gestureMountFor(registry);
      const targetsReady = yield* Queue.unbounded<boolean>();
      const armed = yield* Queue.unbounded<boolean>();

      const container = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const root = document.createElement("div");
          root.id = "month-production-gesture";
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

      const program = Runtime.makeElement({
        Model,
        container,
        devTools: false,
        init: () => ({ model: current }),
        resources: Layer.mergeAll(
          unusedBrowserLayers,
          Layer.succeed(CalendarSearchClient, unexpectedSearchClient),
          Layer.succeed(SearchRuntime, {
            observe: () => Stream.die("No search in month gesture test"),
          }),
          Layer.succeed(
            EditingRuntime,
            EditingRuntime.of({
              connect: () => Effect.die("No editing subscription in this seam"),
              dispatch: (_person, command) =>
                Queue.offer(commands, command).pipe(Effect.asVoid),
            })
          )
        ),
        subscriptions: gestureSubscriptions(registry),
        update: (model, message) => {
          if (
            Predicate.isTagged(message, "PreviewedGesture") &&
            message.phase === "armed"
          ) {
            Queue.offerUnsafe(armed, true);
          }

          if (Predicate.isTagged(message, "PreparedGestureTargets")) {
            Queue.offerUnsafe(targetsReady, true);
          }

          const result = update(model, message);
          current = result.model;

          return result;
        },
        view: (model, h) =>
          h.div(
            [
              h.DataAttribute(
                "error",
                Option.getOrElse(model.error, () => "")
              ),
            ],
            [
              monthGrid(model, h, undefined, undefined, prepare),
              ...gestureRefusalNotice(model, h),
            ]
          ),
      });

      const mounted = yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (value) =>
          Effect.sync(() => {
            value.dispose();
          })
      );

      yield* Queue.take(targetsReady);

      const root = yield* Effect.fromNullishOr(
        document.querySelector<HTMLElement>("#gesture-host")
      );

      for (const cell of root.querySelectorAll<HTMLElement>(
        ".month-cell[data-day]"
      )) {
        const day = Number(cell.dataset.day);
        cell.getBoundingClientRect = () =>
          new DOMRect(100, 100 + (day - target.startDay) * 100, 100, 100);
      }

      const chip = yield* Effect.fromNullishOr(
        [...root.querySelectorAll<HTMLElement>(".event-chip")].find(
          (element) => element.dataset.eventKey === target.key
        )
      );

      pointer("pointerdown", 150, chip);

      if (readOnly) {
        yield* untilDom(() =>
          Option.isSome(current.editing.gestureRefusal)
            ? current.editing.gestureRefusal.value
            : undefined
        );
        expect(
          document.querySelector(".gesture-refusal")?.textContent
        ).toContain(
          "You can only view this event, so it can't be moved. Nothing was changed."
        );

        const dismiss = yield* Effect.fromNullishOr(
          document.querySelector<HTMLButtonElement>(".gesture-refusal button")
        );

        dismiss.click();
        yield* untilDom(() =>
          document.querySelector(".gesture-refusal") === null ? true : undefined
        );
        expect(Option.isNone(current.editing.gesture)).toBe(true);
        expect(yield* Queue.size(commands)).toBe(0);
      } else {
        yield* Queue.take(armed);
        pointer("pointermove", 250);
        yield* untilDom(
          () => document.querySelector(".month-gesture-preview") ?? undefined
        );
        expect(root.querySelectorAll(".month-gesture-preview")).toHaveLength(1);
        expect(
          root.querySelectorAll(".month-item-timed [data-resize-edge]")
        ).toHaveLength(0);
        pointer("pointerup", 250);
        const command = yield* Queue.take(commands);
        expect(EditingCommand.guards.Open(command)).toBe(true);

        if (
          EditingCommand.guards.Open(command) &&
          EditorRequest.guards.Existing(command.request)
        ) {
          expect(command.request.event.eventId).toBe(target.source.eventId);
          expect(command.request.range?.startDate).toBe("2026-10-20");
          expect(command.request.range?.allDay).toBe(false);
          expect(command.request.range?.startTime).toBe("09:07");
          expect(command.request.range?.endTime).toBe("09:57");
        }

        yield* saveMonthGestureThroughRpc(current, command);
        chip.click();

        const resize = yield* Effect.fromNullishOr(
          root.querySelector<HTMLElement>(
            '.month-span .event-chip.selected [data-resize-edge="end"]'
          )
        );

        pointer("pointerdown", 550, resize);
        yield* Queue.take(armed);
        pointer("pointermove", 850);
        yield* untilDom(
          () =>
            root.querySelector(".month-gesture-preview-all-day") ?? undefined
        );
        expect(Option.getOrThrow(current.editing.gesture).range).toMatchObject({
          allDay: true,
          endDate: "2026-10-26",
          startDate: "2026-10-19",
        });
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          })
        );
        yield* untilDom(() =>
          root.querySelector(".month-gesture-preview") === null
            ? true
            : undefined
        );
        expect(yield* Queue.size(commands)).toBe(0);
        pointer("pointerdown", 150, chip, true);
        yield* Queue.take(armed);
        pointer("pointermove", 250, window, true);
        yield* untilDom(() =>
          root
            .querySelector(".month-gesture-preview strong")
            ?.textContent?.startsWith("Copy:") === true
            ? true
            : undefined
        );
        pointer("pointerup", 250, window, true);
        const copied = yield* Queue.take(commands);
        yield* saveMonthGestureThroughRpc(current, copied);
        expect(copied).toMatchObject({
          request: {
            event: { eventId: "a-review" },
            mode: "duplicate",
            range: { allDay: false, endTime: "09:57", startTime: "09:07" },
          },
        });
      }

      expect(current.calendar.selected).toEqual(selected);
      mounted.dispose();
      expect(registry.count()).toBe(0);
    })
);
