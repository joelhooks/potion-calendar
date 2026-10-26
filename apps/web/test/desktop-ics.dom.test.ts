import {
  exportIcsCalendar,
  IcsExportOutcome,
} from "@calendar/calendar/contracts";
import {
  IcsSaveOutcome,
  icsSaveByteLimit,
} from "@calendar/core/desktop-bridge";
import type { IcsSaveRequest } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Deferred, Effect, Fiber, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { DesktopRequest } from "../src/client/desktop/model.js";
import { runDesktopRequest } from "../src/client/desktop/runtime.js";
import { DownloadSelectedIcs } from "../src/client/ics-export/browser.js";
import { saveDesktopIcs } from "../src/client/ics-export/desktop.js";
import {
  IcsSelection,
  selectedIcsEvents,
} from "../src/client/ics-export/selection.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { view as appView } from "../src/features/app.js";
import {
  browserIcsBridge,
  calendarText,
  desktopIcsFixture,
  unusedIcsRootLayers,
} from "./desktop-ics-fixture.js";
import { icsExportFixture } from "./ics-export-fixture.js";

const installBridge = (bridge: NonNullable<Window["potionDesktop"]>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.getOwnPropertyDescriptor(window, "potionDesktop");

      const encoderDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "TextEncoder"
      );

      const PreviousEncoder = TextEncoder;

      class BrowserTextEncoder extends PreviousEncoder {
        override encode(input?: string): Uint8Array<ArrayBuffer> {
          return new Uint8Array(super.encode(input));
        }
      }

      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: BrowserTextEncoder,
      });
      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: bridge,
      });

      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {
          throw new Error("Desktop ICS must not dispatch a browser download");
        });

      const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("ICS export must not make provider calls");
      });

      return { click, encoderDescriptor, network, previous };
    }),
    ({ click, encoderDescriptor, network, previous }) =>
      Effect.sync(() => {
        click.mockRestore();
        network.mockRestore();

        if (encoderDescriptor === undefined) {
          Reflect.deleteProperty(globalThis, "TextEncoder");
        } else {
          Object.defineProperty(globalThis, "TextEncoder", encoderDescriptor);
        }

        if (previous === undefined) {
          Reflect.deleteProperty(window, "potionDesktop");
        } else {
          Object.defineProperty(window, "potionDesktop", previous);
        }
      })
  );

const connectedModel = Effect.fn("test.connectedIcsModel")(
  function* connectedModel(
    bridge: NonNullable<Window["potionDesktop"]>,
    base: AppModel = icsExportFixture(true)
  ) {
    const notice = yield* runDesktopRequest(
      DesktopRequest.cases.Read.make({ request: base.desktop.request }),
      Option.some(bridge)
    );

    return update(base, Message.ReceivedDesktop({ notice })).model;
  }
);

const noticeText = Effect.fn("test.icsNoticeText")(function* noticeText(
  model: AppModel
) {
  const rendered = yield* renderToString(
    { init: () => ({ model }), view: appView },
    { isHydratable: false }
  );

  return new DOMParser()
    .parseFromString(rendered.html, "text/html")
    .querySelector("[data-ics-export-notice]")?.textContent;
});

it.effect(
  "the real root catalog sends exact selected bytes to the typed bridge and waits for its receipt before Saved",
  () =>
    Effect.gen(function* rootBridgeReceipt() {
      const received = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const finished = yield* Deferred.make<boolean>();
      const requests: (typeof IcsSaveRequest.Type)[] = [];

      const fixture = yield* desktopIcsFixture({
        save: (request) =>
          Effect.sync(() => {
            requests.push(request);
          }).pipe(
            Effect.andThen(Deferred.succeed(received, true)),
            Effect.andThen(Deferred.await(release)),
            Effect.as(IcsSaveOutcome.cases.Saved.make({}))
          ),
      });

      const spies = yield* installBridge(fixture.bridge);
      const model = yield* connectedModel(fixture.bridge);
      expect(model.desktop.canSaveIcs).toBe(true);

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        keyboardRegistry
          .find((action) => action.id === "export-ics")
          ?.availability(opened)
      ).toBe("enabled");
      const picked = update(opened, Message.KeyboardPick({ id: "export-ics" }));
      expect(picked.commands?.map((command) => command.name)).toEqual([
        "DownloadSelectedIcs",
      ]);
      expect(picked.model.icsExport.phase).toBe("saving");
      expect(yield* noticeText(picked.model)).toContain("Saving…");
      expect(
        update(picked.model, Message.RequestedIcsExport()).commands ?? []
      ).toEqual([]);

      const selection = Option.getOrThrow(
        Option.filter(
          Option.some(selectedIcsEvents(model)),
          IcsSelection.guards.Ready
        )
      );

      const expected = exportIcsCalendar(selection.events, yield* DateTime.now);
      expect(IcsExportOutcome.guards.Ready(expected)).toBe(true);

      if (!IcsExportOutcome.guards.Ready(expected)) {
        return;
      }

      const command = Option.getOrThrow(
        Option.fromUndefinedOr(picked.commands?.[0])
      );

      const scope = yield* Effect.scope;

      const pending = yield* command.effect.pipe(
        Effect.provide(unusedIcsRootLayers),
        Effect.onExit(() => Deferred.succeed(finished, true)),
        Effect.forkIn(scope)
      );

      const first = yield* Effect.raceFirst(
        Deferred.await(received).pipe(Effect.as("received")),
        Deferred.await(finished).pipe(Effect.as("finished"))
      );

      expect(first).toBe("received");
      expect(pending.pollUnsafe()).toBeUndefined();
      expect(yield* noticeText(picked.model)).not.toContain("Saved.");
      yield* Deferred.succeed(release, true);
      const receipt = yield* Fiber.join(pending);
      const completed = update(picked.model, receipt).model;
      expect(yield* noticeText(completed)).toContain("Saved.");
      expect(completed.icsExport.phase).toBe("idle");
      expect(new TextDecoder().decode(requests[0]?.bytes)).toBe(
        expected.content
      );
      expect(requests[0]?.suggestedName).toBe("events.ics");
      expect(fixture.calls).toHaveLength(1);
      expect(spies.click).not.toHaveBeenCalled();
      expect(spies.network).not.toHaveBeenCalled();

      const otherPerson = {
        ...picked.model,
        person: Option.some("other-person"),
      };

      expect(update(otherPerson, receipt).model).toBe(otherPerson);

      const newer = {
        ...picked.model,
        icsExport: {
          ...picked.model.icsExport,
          revision: picked.model.icsExport.revision + 1,
        },
      };

      expect(update(newer, receipt).model).toBe(newer);
    })
);

it.effect(
  "an older bridge keeps the catalog entry hidden and never falls through to Blob",
  () =>
    Effect.gen(function* staleDesktop() {
      const bridge = browserIcsBridge();
      const spies = yield* installBridge(bridge);
      const model = yield* connectedModel(bridge);
      expect(model.desktop.canSaveIcs).toBe(false);

      const opened = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        keyboardRegistry
          .find((action) => action.id === "export-ics")
          ?.availability(opened)
      ).toBe("hidden");

      const rendered = yield* renderToString(
        { init: () => ({ model: opened }), view: appView },
        { isHydratable: false }
      );

      expect(
        new DOMParser()
          .parseFromString(rendered.html, "text/html")
          .querySelector("#command-export-ics")
      ).toBeNull();
      expect(
        update(model, Message.RequestedIcsExport()).commands ?? []
      ).toEqual([]);

      const selection = Option.getOrThrow(
        Option.filter(
          Option.some(selectedIcsEvents(icsExportFixture())),
          IcsSelection.guards.Ready
        )
      );

      const receipt = yield* DownloadSelectedIcs({
        events: selection.events,
        personId: selection.personId,
        revision: 1,
      }).effect;

      expect(receipt.notice.message).toContain("not the desktop app");
      expect(spies.click).not.toHaveBeenCalled();
    })
);

it.effect(
  "native cancellation and write failure receipts produce truthful root notices, never Saved",
  () =>
    Effect.gen(function* terminalRootReceipts() {
      for (const cancelled of [true, false]) {
        yield* Effect.scoped(
          Effect.gen(function* terminalNotice() {
            const fixture = yield* desktopIcsFixture({
              save: () =>
                Effect.succeed(
                  cancelled
                    ? IcsSaveOutcome.cases.Cancelled.make({})
                    : IcsSaveOutcome.cases.Failed.make({ reason: "write" })
                ),
            });

            yield* installBridge(fixture.bridge);
            const model = yield* connectedModel(fixture.bridge);
            const requested = update(model, Message.RequestedIcsExport());

            const command = Option.getOrThrow(
              Option.fromUndefinedOr(requested.commands?.[0])
            );

            const receipt = yield* command.effect.pipe(
              Effect.provide(unusedIcsRootLayers)
            );

            const text = yield* noticeText(
              update(requested.model, receipt).model
            );

            expect(text).toContain(
              cancelled
                ? "Export cancelled."
                : "Couldn't save the calendar file. Try exporting again."
            );
            expect(text).not.toContain("Saved.");
          })
        );
      }
    })
);

it.effect(
  "the renderer admits exactly the decoded cap but refuses larger serialized selections before any bridge request",
  () =>
    Effect.gen(function* rendererBounds() {
      const fixture = yield* desktopIcsFixture({
        save: () => Effect.succeed(IcsSaveOutcome.cases.Saved.make({})),
      });

      yield* installBridge(fixture.bridge);
      expect(
        yield* saveDesktopIcs(
          fixture.bridge,
          calendarText(icsSaveByteLimit),
          "events.ics"
        )
      ).toEqual(IcsSaveOutcome.cases.Saved.make({}));
      expect(fixture.calls).toHaveLength(1);
      expect(
        yield* saveDesktopIcs(
          fixture.bridge,
          calendarText(icsSaveByteLimit + 1),
          "events.ics"
        )
      ).toEqual(IcsSaveOutcome.cases.Failed.make({ reason: "tooLarge" }));
      const base = icsExportFixture();

      const oversized = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: base.calendar.reads.map((read) => {
            const data = Option.getOrThrow(AsyncData.getData(read.events));

            return {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  ...data,
                  events: data.events.map((event) => ({
                    ...event,
                    description: "x".repeat(icsSaveByteLimit),
                  })),
                },
              }),
            };
          }),
        },
      };

      const model = yield* connectedModel(fixture.bridge, oversized);
      const requested = update(model, Message.RequestedIcsExport());

      const command = Option.getOrThrow(
        Option.fromUndefinedOr(requested.commands?.[0])
      );

      const receipt = yield* command.effect.pipe(
        Effect.provide(unusedIcsRootLayers)
      );

      expect(
        Option.getOrThrow(
          update(requested.model, receipt).model.icsExport.notice
        ).message
      ).toBe("This export is too large to save.");
      expect(fixture.calls).toHaveLength(1);
    })
);
