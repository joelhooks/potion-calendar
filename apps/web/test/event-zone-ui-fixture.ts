import { Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import { displayZone } from "../src/layout/time-zones.js";
import { editorViewFields } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const eventZoneUiFixture = (): AppModel => {
  const base = keyboardFixture();

  return {
    ...base,
    calendar: { ...base.calendar, zone: "Europe/London" },
    editing: {
      ...base.editing,
      view: EditorView.cases.Editing.make(editorViewFields),
    },
    keyboard: { ...base.keyboard, focus: "event-timeZone" },
    timeZones: {
      ...base.timeZones,
      temporary: Option.some(displayZone("Europe/London")),
    },
  };
};

export const renderEventZoneUi = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });
