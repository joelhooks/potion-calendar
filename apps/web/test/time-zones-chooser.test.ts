import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { ReadEvents, SavePreferences } from "../src/client/commands.js";
import { TimeZoneAction, ZoneChooser } from "../src/client/time-zones/model.js";
import { applyZonePreferences } from "../src/client/time-zones/update.js";
import { systemZonePrompt } from "../src/features/calendar.js";
import { commandMenu } from "../src/features/command-menu.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

const chooserView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div(
    [
      h.Id("zone-state"),
      h.DataAttribute("active-zone", model.calendar.zone),
      h.DataAttribute("home-zone", model.timeZones.preferences.primary.id),
      h.DataAttribute("home-label", model.timeZones.preferences.primary.label),
    ],
    [...systemZonePrompt(model, h), ...commandMenu(model, h)]
  ),
  title: "Zone chooser",
});

it.effect(
  "the actual quiet-prompt Keep button dismisses without replacing home",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const model = {
        ...base,
        timeZones: applyZonePreferences(
          { ...base.timeZones, system: "Asia/Tokyo" },
          base.timeZones.preferences
        ),
      };

      Scene.scene(
        { update, view: chooserView },
        Scene.given(model),
        Scene.expect(Scene.selector(".zone-system-prompt")).toExist(),
        Scene.click(Scene.role("button", { name: "Keep home zone" })),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector(".zone-system-prompt")).toBeAbsent(),
        Scene.expect(Scene.selector("#zone-state")).toHaveAttr(
          "data-home-zone",
          base.calendar.zone
        )
      );
    })
);

it.effect(
  "the actual command-menu zone result changes the active clock and persists only home preferences",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();
      Scene.scene(
        { update, view: chooserView },
        Scene.given(base),
        Scene.Subscription.emit(
          Message.PressedCalendarKey({
            alt: false,
            key: "z",
            mod: false,
            now: 100,
            shift: false,
          })
        ),
        Scene.expect(
          Scene.role("dialog", { name: "Travel to time zone" })
        ).toExist(),
        Scene.type(Scene.selector("#keyboard-query"), "Tokyo"),
        Scene.click(Scene.selector("[id='command-Asia/Tokyo']")),
        Scene.Command.resolveAll(
          [
            ReadEvents,
            Message.ReceivedEvents({
              accountId: "work",
              request: base.calendar.rangeRequest + 1,
              result: {
                events: fixtureEvents.filter(
                  (event) => event.accountId === "work"
                ),
                versions: [],
              },
            }),
          ],
          [
            ReadEvents,
            Message.ReceivedEvents({
              accountId: "personal",
              request: base.calendar.rangeRequest + 1,
              result: {
                events: fixtureEvents.filter(
                  (event) => event.accountId === "personal"
                ),
                versions: [],
              },
            }),
          ]
        ),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#keyboard-command-dialog")).toBeAbsent(),
        Scene.expect(Scene.selector("#zone-state")).toHaveAttr(
          "data-active-zone",
          "Asia/Tokyo"
        ),
        Scene.expect(Scene.selector("#zone-state")).toHaveAttr(
          "data-home-zone",
          base.calendar.zone
        )
      );
    })
);

it.effect(
  "the existing chooser offers an empty-label reset and keeps home-zone identity",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const renamed = {
        ...base,
        timeZones: {
          ...base.timeZones,
          preferences: {
            ...base.timeZones.preferences,
            primary: {
              ...base.timeZones.preferences.primary,
              label: "Home office",
            },
          },
        },
      };

      const { model } = update(
        renamed,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Open.make({
            chooser: ZoneChooser.cases.RenameValue.make({
              id: base.calendar.zone,
            }),
          }),
        })
      );

      Scene.scene(
        { update, view: chooserView },
        Scene.given(model),
        Scene.expect(
          Scene.role("dialog", { name: "Time-zone label" })
        ).toExist(),
        Scene.click(Scene.role("option", { name: "Restore default label" })),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#zone-state")).toHaveAttr(
          "data-home-label",
          ""
        ),
        Scene.expect(Scene.selector("#zone-state")).toHaveAttr(
          "data-home-zone",
          base.calendar.zone
        )
      );
    })
);
