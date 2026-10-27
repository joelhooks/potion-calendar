import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { view } from "../src/features/app.js";
import {
  recoveryAdmission,
  recoveryEnd,
  recoveryEvent,
  recoveryHost,
  recoveryIntent,
  recoveryModel,
} from "./tray-note-recovery-fixture.js";

const responses = [
  { label: "Yes", response: "accepted" },
  { label: "No", response: "declined" },
  { label: "Maybe", response: "tentative" },
] as const;

const scenes = [1280, 390].flatMap((width) =>
  (["light", "dark"] as const).flatMap((theme) =>
    responses.map((choice) => ({ ...choice, theme, width }))
  )
);

const appearance = Effect.fn("TrayNoteAppearance.render")(function* appearance(
  model: AppModel
) {
  const rendered = yield* renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  );

  const parsed = new DOMParser().parseFromString(rendered.html, "text/html");

  const pane =
    (model.phoneShell.viewportWidth ?? 1280) <= 640
      ? parsed.querySelector("#phone-shell-dialog")
      : parsed.querySelector(".detail-panel");

  const section = pane?.querySelector(".event-rsvp");
  expect(section).not.toBeNull();

  return {
    pressed: [
      ...(section?.querySelectorAll('button[aria-pressed="true"]') ?? []),
    ].map((button) => button.textContent),
    rendered: rendered.html,
    staged: [
      ...(section?.querySelectorAll('button[data-rsvp-staged="true"]') ?? []),
    ].map((button) => button.textContent),
  };
});

const computedFont = Effect.fn("TrayNoteAppearance.computedFont")(
  function* computedFont(model: AppModel) {
    const fs = yield* FileSystem.FileSystem;
    const css = yield* fs.readFileString("src/client/style.css");
    const projection = yield* appearance(model);
    const style = document.createElement("style");
    style.textContent = css;
    const root = document.createElement("div");
    root.innerHTML = projection.rendered;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.head.append(style);
        document.body.append(root);
      }),
      () =>
        Effect.sync(() => {
          root.remove();
          style.remove();
        })
    );

    const selector =
      (model.phoneShell.viewportWidth ?? 1280) <= 640
        ? "#phone-shell-dialog #rsvp-note"
        : ".detail-panel #rsvp-note";

    const field = root.querySelector<HTMLTextAreaElement>(selector);
    const app = root.querySelector(".app");
    expect(field).not.toBeNull();
    expect(app).not.toBeNull();

    if (field !== null && app !== null) {
      const family = getComputedStyle(field).fontFamily;
      expect(
        family,
        "RSVP textarea computed font must inherit the app family"
      ).toBe(getComputedStyle(app).fontFamily);
      expect(family).toContain("Inter");
      expect(family).not.toContain("monospace");
    }
  }
);

it.effect.each(scenes)(
  "staged appearance clears after a real explicit send %j",
  ({ width, theme, label, response }) =>
    Effect.gen(function* sendAppearance() {
      const initial = recoveryModel(width);

      const h = yield* recoveryHost({
        ...initial,
        settings: { ...initial.settings, theme },
      });

      expect((yield* appearance(h.model())).staged).toEqual([]);
      yield* h.apply(recoveryAdmission({ ...recoveryIntent, response }));
      yield* h.receive();
      expect((yield* appearance(h.model())).staged).toEqual([label]);
      expect((yield* appearance(h.model())).pressed).toEqual([]);
      yield* computedFont(h.model());
      yield* h.apply(
        Message.EditingAction({
          action: EditorAction.cases.RsvpNoteEdited.make({
            value: "Appearance note",
          }),
        })
      );
      yield* h.receive();
      yield* h.receive();
      expect(h.calls).toHaveLength(0);
      yield* h.apply(
        Message.EditingAction({
          action: EditorAction.cases.Rsvp.make({ response }),
        })
      );
      yield* h.receive();
      yield* h.receive();
      yield* h.receive();
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]?.response).toBe(response);
      expect(h.calls[0]?.note).toBe("Appearance note");
      expect(h.model().editing.rsvp.prepared).toBeUndefined();
      const model = h.model();
      yield* h.apply(
        Message.ReceivedEvents({
          accountId: recoveryEvent.accountId,
          request: model.calendar.rangeRequest,
          result: {
            events: [
              {
                ...recoveryEvent,
                attendees: [
                  {
                    email: "self@example.test",
                    responseStatus: response,
                    self: true,
                  },
                ],
              },
            ],
            versions: [],
          },
        })
      );
      const saved = yield* appearance(h.model());
      expect(
        saved.pressed,
        "saved RSVP must remain pressed independently of staging"
      ).toEqual([label]);
      expect(
        saved.staged,
        "staged emphasis must be absent after explicit send even when saved RSVP is pressed"
      ).toEqual([]);
      yield* computedFont(h.model());
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect.each([1280, 390])(
  "replacement and retirement remove the former staged attribute at %s",
  (width) =>
    Effect.gen(function* retireAppearance() {
      const h = yield* recoveryHost(recoveryModel(width));
      yield* h.apply(recoveryAdmission());
      yield* h.receive();
      expect((yield* appearance(h.model())).staged).toEqual(["Maybe"]);
      yield* h.apply(
        recoveryAdmission({ ...recoveryIntent, response: "accepted" })
      );
      yield* h.receive();
      expect((yield* appearance(h.model())).staged).toEqual(["Yes"]);
      yield* h.apply(Message.Ticked({ now: recoveryEnd }));
      yield* h.receive();
      expect((yield* appearance(h.model())).staged).toEqual([]);
      expect(Option.isNone(h.model().editing.rsvp.saving)).toBe(true);
      expect(h.calls).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);
