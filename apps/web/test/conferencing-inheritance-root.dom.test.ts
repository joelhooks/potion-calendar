import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { editorConferencingContext } from "../src/client/conferencing/editor-context.js";
import { SaveDefaultConferencing } from "../src/client/settings/conferencing/commands.js";
import { ConferencingSettingsChange } from "../src/client/settings/conferencing/model.js";
import { view } from "../src/features/app.js";
import { settingsConferencing } from "../src/features/settings-conferencing.js";
import { SettingsRoute } from "../src/layout/route.js";
import {
  inheritanceModel,
  persistInheritanceChoice,
  renderInheritanceRoot,
} from "./conferencing-inheritance-fixture.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "the real conferencing route exposes the user-wide default selector",
  () =>
    Effect.gen(function* userDefaultSelector() {
      const model = {
        ...fixtureModel(),
        route: SettingsRoute.make({ page: "conferencing" }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const select = document.querySelector<HTMLSelectElement>(
        "#user-default-conferencing"
      );

      expect(select).not.toBeNull();
      expect(
        Array.from(select?.options ?? [], (option) => option.value)
      ).toEqual(["none", "googleMeet"]);
      expect(select?.value).toBe("none");
    })
);

it.effect(
  "the actual default control dispatches through the root and renders pending then a real saved result",
  () =>
    Effect.gen(function* rootDefaultControl() {
      const model = yield* inheritanceModel(null);
      const personId = Option.getOrThrow(model.person);

      const result = update(
        model,
        Message.ChangedConferencingSettings({
          change: ConferencingSettingsChange.cases.Default.make({
            value: "googleMeet",
          }),
          personId,
        })
      );

      expect(editorConferencingContext(result.model)).toMatchObject({
        defaultConferencing: null,
      });

      const actualResult = yield* persistInheritanceChoice(result);

      expect(
        editorConferencingContext(update(result.model, actualResult).model)
      ).toMatchObject({ defaultConferencing: "googleMeet" });

      const savedRendering = yield* renderInheritanceRoot(
        update(result.model, actualResult).model
      );

      const savedDocument = new DOMParser().parseFromString(
        savedRendering.html,
        "text/html"
      );

      expect(
        savedDocument.querySelector<HTMLSelectElement>(
          "#user-default-conferencing"
        )?.value
      ).toBe("googleMeet");

      Scene.scene(
        {
          update,
          view: (state: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: h.main([], [...settingsConferencing(state, h)]),
            title: "Conferencing",
          }),
        },
        Scene.given(model),
        Scene.expect(Scene.selector("#user-default-conferencing")).toHaveValue(
          "none"
        ),
        Scene.change(
          Scene.selector("#user-default-conferencing"),
          "googleMeet"
        ),
        Scene.expect(Scene.selector("#user-default-conferencing")).toHaveValue(
          "googleMeet"
        ),
        Scene.expect(
          Scene.selector("#user-default-conferencing")
        ).toBeDisabled(),
        Scene.Command.resolve(
          SaveDefaultConferencing({
            personId,
            requestId: result.model.conferencingSettings.requestId,
            value: "googleMeet",
          }),
          actualResult
        ),
        Scene.expect(Scene.selector("#user-default-conferencing")).toHaveValue(
          "googleMeet"
        ),
        Scene.expect(Scene.selector("#user-default-conferencing")).toBeEnabled()
      );
    })
);
