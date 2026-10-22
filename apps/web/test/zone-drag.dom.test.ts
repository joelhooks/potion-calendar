import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { vi } from "vitest";

import { initialModel, Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { modelGestureHostKey } from "../src/client/editing/gesture-targets.js";
import { canResumeHost } from "../src/client/grid-resume/host.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { zoneDragHostKey } from "../src/client/zone-drag/host.js";
import { ZoneDragPreview } from "../src/client/zone-drag/model.js";
import { dayInZone } from "../src/layout/navigation.js";
import { timeZonesFixture } from "./time-zones-fixture.js";
import {
  mountZoneDragScene,
  untilZoneDom,
} from "./zone-drag-native-fixture.js";

it.effect(
  "native secondary drop uses Move's root persistence path once and reloads its saved order without changing the clocks",
  () =>
    Effect.gen(function* nativeZonePersistence() {
      localStorage.clear();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.clear();
        })
      );
      const h = yield* mountZoneDragScene();
      const before = h.model();
      const person = Option.getOrThrow(before.person);

      yield* SavePreferences({ ...preferenceSnapshot(before), person }).effect;

      const first = Option.getOrThrow(
        Option.fromNullishOr(before.timeZones.preferences.secondary[0])
      );

      yield* h.press();
      h.point("pointermove", 88);
      yield* untilZoneDom(
        () => h.root.querySelector(".zone-insert-marker") ?? undefined
      );
      expect(h.captures.has(91)).toBe(true);
      expect(h.model().timeZones.preferences).toEqual(
        before.timeZones.preferences
      );
      expect(h.saves()).toBe(0);
      h.point("pointerup", 88);
      yield* h.notice("SavedPreferences");
      yield* untilZoneDom(() =>
        h.root.querySelector<HTMLElement>(".zone-header")?.dataset.zoneId ===
        "Europe/London"
          ? true
          : undefined
      );
      expect(h.saves()).toBe(1);
      expect(h.captures.size).toBe(0);
      expect(
        h.model().timeZones.preferences.secondary.map((zone) => zone.id)
      ).toEqual(["Europe/London", "America/New_York"]);
      expect(h.model().timeZones.preferences.primary).toEqual(
        before.timeZones.preferences.primary
      );
      expect(h.model().timeZones.temporary).toEqual(before.timeZones.temporary);
      expect(h.model().calendar.zone).toBe(before.calendar.zone);

      const keyboard = update(
        before,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Move.make({
            direction: 1,
            id: first.id,
          }),
        })
      );

      expect(keyboard.model.timeZones.preferences).toEqual(
        h.model().timeZones.preferences
      );
      expect(
        keyboard.commands?.filter(
          (command) => command.name === "SavePreferences"
        )
      ).toHaveLength(1);

      const reloaded = update(
        {
          ...initialModel(before.calendar.now, before.calendar.zone),
          person: Option.some(person),
        },
        yield* ReadPreferences({ person }).effect
      );

      expect(reloaded.model.timeZones.preferences.secondary).toEqual(
        h.model().timeZones.preferences.secondary
      );

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });

      h.first.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      yield* Effect.yieldNow;
      expect(h.model().keyboard.screen).toBe("closed");
    }).pipe(Effect.scoped)
);

it.effect(
  "native movement at the existing threshold stays a click and opens the ordinary header chooser without saving",
  () =>
    Effect.gen(function* headerClick() {
      const h = yield* mountZoneDragScene();
      const original = h.model().timeZones.preferences;

      yield* h.press();
      h.point("pointermove", 28);
      h.point("pointerup", 28);
      yield* untilZoneDom(() =>
        h.root.dataset.zoneDragPhase === "idle" ? true : undefined
      );

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });

      h.first.dispatchEvent(click);
      yield* h.notice("TimeZoneAction");
      expect(click.defaultPrevented).toBe(false);
      expect(h.model().keyboard.screen).toBe("zones");
      expect(h.model().timeZones.preferences).toEqual(original);
      expect(h.saves()).toBe(0);
      expect(h.captures.size).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.each([
  "Escape",
  "pointercancel",
  "lostpointercapture",
  "blur",
] as const)(
  "native %s cancels the marker and captured pointer without changing or persisting order or returning from travel",
  (kind) =>
    Effect.gen(function* cancelledZoneDrag() {
      const h = yield* mountZoneDragScene();
      const before = h.model();

      yield* h.press();
      h.point("pointermove", 88);
      yield* untilZoneDom(
        () => h.root.querySelector(".zone-insert-marker") ?? undefined
      );

      if (kind === "Escape") {
        h.first.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          })
        );
      } else if (kind === "blur") {
        window.dispatchEvent(new Event("blur"));
      } else {
        h.point(kind, 88, kind === "lostpointercapture" ? h.root : window);
      }

      yield* untilZoneDom(() =>
        h.root.querySelector(".zone-insert-marker") === null ? true : undefined
      );
      h.point("pointerup", 88);
      yield* Effect.yieldNow;
      expect(h.model().timeZones.preferences).toEqual(
        before.timeZones.preferences
      );
      expect(h.model().timeZones.temporary).toEqual(before.timeZones.temporary);
      expect(h.model().calendar.zone).toBe(before.calendar.zone);
      expect(h.saves()).toBe(0);
      expect(h.captures.size).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "primary and travel headers have no drag handles and stale original-order drops cannot persist",
  () =>
    Effect.gen(function* fixedAndStaleZones() {
      const h = yield* mountZoneDragScene();

      for (const id of [
        h.model().timeZones.preferences.primary.id,
        Option.getOrThrow(h.model().timeZones.temporary).id,
      ]) {
        const button = yield* Effect.fromNullishOr(
          [...h.root.querySelectorAll<HTMLElement>(".zone-header")]
            .find((header) => header.dataset.zoneId === id)
            ?.querySelector("button")
        );

        expect(Object.hasOwn(button.dataset, "zoneDragId")).toBe(false);
        h.point("pointerdown", 115, button);
        h.point("pointermove", 23);
        h.point("pointerup", 23);
        expect(h.root.querySelector(".zone-insert-marker")).toBeNull();
      }

      expect(h.saves()).toBe(0);
      const base = timeZonesFixture();
      const hostKey = Option.getOrThrow(zoneDragHostKey(base));

      const { id } = Option.getOrThrow(
        Option.fromNullishOr(base.timeZones.preferences.secondary[0])
      );

      const current = update(
        base,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Move.make({ direction: 1, id }),
        })
      ).model;

      const stale = update(
        current,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.MoveTo.make({ hostKey, id, index: 0 }),
        })
      );

      expect(stale.model.timeZones.preferences).toEqual(
        current.timeZones.preferences
      );
      expect(
        stale.commands?.filter(
          (command) => command.name === "SavePreferences"
        ) ?? []
      ).toHaveLength(0);

      const preview = update(
        current,
        Message.PreviewedZoneDrag({
          hostKey,
          preview: Option.some(ZoneDragPreview.make({ id, index: 0 })),
        })
      );

      expect(Option.isNone(preview.model.timeZones.drag)).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "the existing resume guard observes actual zone-header pressed and dragging phases",
  () =>
    Effect.gen(function* zoneResumeOwnership() {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi
            .spyOn(document, "visibilityState", "get")
            .mockReturnValue("visible")
        ),
        (mock) =>
          Effect.sync(() => {
            mock.mockRestore();
          })
      );
      const h = yield* mountZoneDragScene();
      const model = h.model();

      const resume = {
        day: dayInZone(model.calendar.now, model.calendar.zone),
        hostKey: Option.getOrThrow(modelGestureHostKey(model)),
      };

      expect(canResumeHost(document, resume)).toBe(true);
      yield* h.press();
      expect(Option.isNone(h.model().timeZones.drag)).toBe(true);
      expect(canResumeHost(document, resume)).toBe(false);
      h.point("pointermove", 88);
      yield* untilZoneDom(
        () => h.root.querySelector(".zone-insert-marker") ?? undefined
      );
      expect(canResumeHost(document, resume)).toBe(false);
      h.point("pointercancel", 88);
      yield* untilZoneDom(() =>
        h.root.querySelector(".zone-insert-marker") === null ? true : undefined
      );
      expect(canResumeHost(document, resume)).toBe(true);
    }).pipe(Effect.scoped)
);
