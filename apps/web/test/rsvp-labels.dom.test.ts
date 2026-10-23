import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { view } from "../src/features/app.js";
import { eventRsvp } from "../src/features/event-rsvp.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { rsvpChipFixture, rsvpScenes } from "./rsvp-chip-fixture.js";
import {
  responseExamples,
  responseLabelFixture,
  responseLabelScenes,
} from "./rsvp-label-fixture.js";

const responseChoicesView = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div(
    [],
    eventRsvp(
      model,
      h,
      Option.getOrThrow(Option.fromUndefinedOr(visibleEvents(model)[0]))
    )
  );

it.effect.each([
  { label: "Yes", response: "accepted" },
  { label: "No", response: "declined" },
  { label: "Maybe", response: "tentative" },
] as const)(
  "%s choice sends the provider response, not its display label",
  ({ label, response }) =>
    Effect.sync(() => {
      Scene.scene(
        {
          update: (model: AppModel, message: AppMessage) => ({
            model,
            outMessage: message,
          }),
          view: responseChoicesView,
        },
        Scene.given(responseLabelFixture(1440, 900, "light")),
        Scene.click(Scene.role("button", { name: label })),
        Scene.expectOutMessage(
          Message.EditingAction({
            action: EditorAction.cases.Rsvp.make({ response }),
          })
        )
      );
    })
);

it.effect(
  "RSVP shortcut hints use response words while chip aria retains derived style states",
  () =>
    Effect.gen(function* responseHintsAndChipStates() {
      const base = responseLabelFixture(1440, 900, "light");

      const model = {
        ...base,
        keyboard: { ...base.keyboard, prefix: "e" as const },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const parsed = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const hint = parsed.querySelector(
        ".event-rsvp .editor-hint"
      )?.textContent;

      expect(hint).toContain(" Yes");
      expect(hint).toContain(" No");
      expect(hint).toContain(" Maybe");
      expect(hint).not.toMatch(/accepted|declined|tentative|needsAction/u);

      const chipsModel = rsvpChipFixture(rsvpScenes[0]);

      const chips = yield* renderToString(
        { init: () => ({ model: chipsModel }), view },
        { isHydratable: false }
      );

      const chipDocument = new DOMParser().parseFromString(
        chips.html,
        "text/html"
      );

      for (const status of [
        "accepted",
        "declined",
        "unanswered",
        "tentative",
        "unconfirmed",
      ]) {
        expect(
          chipDocument
            .querySelector(`.event-chip.status-${status}`)
            ?.getAttribute("aria-label")
        ).toMatch(new RegExp(`, ${status}$`, "u"));
      }
    })
);

for (const scene of responseLabelScenes) {
  it.effect(
    `participant response words reach ${scene.width} ${scene.theme} without changing identity or chip aria`,
    () =>
      Effect.gen(function* responseWords() {
        const model = responseLabelFixture(
          scene.width,
          scene.height,
          scene.theme
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const parsed = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const rows = [...parsed.querySelectorAll(".attendee-response")];
        expect(rows.map((row) => row.textContent)).toEqual([
          "Yes",
          "No",
          "Maybe",
          "Not answered",
          "Not answered",
        ]);
        expect(rows).toHaveLength(5);

        for (const [index, row] of rows.entries()) {
          expect(row.parentElement?.querySelector("strong")?.textContent).toBe(
            `Guest ${index + 1}`
          );
        }

        expect(rows[0]?.parentElement?.textContent).toContain("You");
        expect(rows[1]?.parentElement?.textContent).toContain("Organizer");
        expect(rows[2]?.parentElement?.textContent).toContain("Optional");

        const aria = parsed
          .querySelector(".event-chip")
          ?.getAttribute("aria-label");

        expect(aria).toContain(", accepted");
        const choices = [...parsed.querySelectorAll(".event-rsvp button")];
        expect(choices.map((choice) => choice.textContent)).toEqual([
          "Yes",
          "No",
          "Maybe",
        ]);
        expect(
          choices.map((choice) => choice.getAttribute("aria-pressed"))
        ).toEqual(["true", "false", "false"]);
        expect(
          scene.width > 640 ||
            parsed.querySelector(".phone-shell-dialog") !== null
        ).toBe(true);
      })
  );
}

it.effect.prop(
  "generated participant response histories retain each person's plain answer",
  {
    indices: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 0 }))
    ),
  },
  ({ indices }) =>
    Effect.gen(function* generatedResponses() {
      const attendees = indices.map((index, position) => {
        const example = Option.getOrThrow(
          Option.fromUndefinedOr(responseExamples[index])
        );

        const attendee = { email: `person-${position}@example.test` };

        return example.response === undefined
          ? attendee
          : { ...attendee, responseStatus: example.response };
      });

      const model = responseLabelFixture(1440, 900, "light", attendees);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const parsed = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const actual = [...parsed.querySelectorAll(".attendee-response")].map(
        (row) => row.textContent
      );

      const expected = indices.map(
        (index) => ["Yes", "No", "Maybe", "Not answered", "Not answered"][index]
      );

      expect(actual).toEqual(expected);
    })
);
