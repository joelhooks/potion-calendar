import { Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteCalendars } from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import { fixtureEvents, fixtureIndex } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const commandChoiceFixture = (
  ids: readonly string[] = ["7", "11"],
  paletteAccount = "work"
): AppModel => {
  const base = keyboardFixture();

  return {
    ...base,
    calendar: {
      ...base.calendar,
      index: RemoteCalendars.Success({
        data: {
          accounts: fixtureIndex.accounts.map((account) =>
            account.accountId === paletteAccount && "colors" in account
              ? {
                  ...account,
                  colors: {
                    ...account.colors,
                    event: Object.fromEntries(
                      ids.map((id) => [
                        id,
                        {
                          background: id === "7" ? "#4CA8DF" : "#ED201D",
                          foreground: "#000000",
                        },
                      ])
                    ),
                  },
                }
              : account
          ),
        },
      }),
      navigation: { ...base.calendar.navigation, weekStartsOn: 0 },
    },
  };
};

export const readyCommandColor = (model: AppModel): AppModel => {
  const original = fixtureEvents.find((event) => event.eventId === "a-review");

  if (original === undefined) {
    throw new Error("Missing selected source for command-color fixture");
  }

  return {
    ...model,
    editing: {
      ...model.editing,
      owner: model.person,
      view: EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: { ...editorDraft, colorId: null, title: original.title ?? "" },
        original: Option.some(original),
      }),
    },
  };
};
