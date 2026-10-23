import { Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { dayInZone } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { displayZone } from "../src/layout/time-zones.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

export const phoneGridScenes = [
  { height: 844, scene: "day", theme: "light", width: 390 },
  { height: 932, scene: "day", theme: "dark", width: 430 },
  { height: 932, scene: "month", theme: "light", width: 430 },
  { height: 844, scene: "month", theme: "dark", width: 390 },
  { height: 844, scene: "travel", theme: "dark", width: 390 },
  { height: 932, scene: "travel", theme: "light", width: 430 },
  { height: 932, scene: "selected", theme: "dark", width: 430 },
  { height: 844, scene: "selected", theme: "light", width: 390 },
] as const;

export const phoneGridFixture = (
  scene: (typeof phoneGridScenes)[number]
): AppModel => {
  const base = phoneShellFixture(
    scene.width,
    scene.height,
    "closed",
    scene.theme
  );

  let { model } = update(
    {
      ...base,
      timeZones: {
        ...base.timeZones,
        preferences: {
          ...base.timeZones.preferences,
          secondary: [
            displayZone("Europe/London"),
            displayZone("Asia/Tokyo"),
            displayZone("America/New_York"),
          ],
        },
      },
    },
    Message.MeasuredShellViewport({ width: scene.width })
  );

  if (scene.scene === "month") {
    ({ model } = update(
      model,
      Message.ClickedView({ days: 7, mode: "month" })
    ));
  }

  if (scene.scene === "travel") {
    ({ model } = update(
      model,
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Travel.make({
          zone: displayZone("Europe/Paris"),
        }),
      })
    ));
    model = {
      ...model,
      calendar: {
        ...model.calendar,
        navigation: {
          ...model.calendar.navigation,
          anchor: dayInZone(model.calendar.now, model.calendar.zone),
        },
      },
    };
  }

  if (scene.scene === "selected") {
    const key = Schema.decodeUnknownSync(Schema.String)(
      visibleEvents(model)[0]?.key
    );

    ({ model } = update(model, Message.ClickedEvent({ key })));
  }

  return {
    ...model,
    calendar: { ...model.calendar, previousTimePeriod: Option.none() },
  };
};
