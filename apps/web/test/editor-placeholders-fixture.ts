import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
  editorViewFields,
} from "./editor-fixture.js";
import { placeholderProofScript } from "./editor-placeholders-proof.js";
import { fixtureModel } from "./fixture.js";

export const placeholderFields = [
  ["event-title", "Title"],
  ["event-location", "Location"],
  ["event-description", "Description"],
] as const;

const emptyValues = { description: "", location: "", title: "" };

export const placeholderModel = (
  kind: "create" | "edit",
  width = 1440,
  theme: "light" | "dark" = "light",
  values = emptyValues
): AppModel => {
  const base = fixtureModel();
  const original = { ...editorOriginal };

  for (const field of ["title", "location", "description"] as const) {
    original[field] = values[field];
  }

  return {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: editorCalendars,
      reads: [
        {
          accountId: original.accountId,
          events: RemoteEvents.Success({
            data: { events: kind === "edit" ? [original] : [], versions: [] },
          }),
        },
      ],
      selected: kind === "edit" ? [eventKey(original)] : [],
      viewportWidth: width - (width <= 1000 ? 445 : 520),
    },
    editing: {
      ...base.editing,
      view: EditorView.cases.Editing.make({
        ...editorViewFields,
        draft: { ...editorDraft, ...values },
        kind,
        original: kind === "edit" ? Option.some(original) : Option.none(),
      }),
    },
    settings: { ...base.settings, theme },
  };
};

export const renderPlaceholderRoot = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

export const placeholderArtifact = Effect.fn("placeholderArtifact")(
  function* placeholderArtifact(
    kind: "create" | "edit",
    width: number,
    theme: "light" | "dark",
    css: string
  ) {
    const model = placeholderModel(kind, width, theme);
    const editor = model.editing.view;

    if (!EditorView.guards.Editing(editor)) {
      return yield* Effect.die("Missing open editor precondition");
    }

    const rendered = yield* renderPlaceholderRoot(model);

    const evidence = {
      account: editor.draft.accountId,
      calendar: editor.draft.calendarId,
      commandsExecuted: 0,
      description: editor.draft.description,
      editMeeting: editor.permissions.editMeeting,
      eventType: editor.draft.eventType ?? "default",
      kind: editor.kind,
      loaded: true,
      location: editor.draft.location,
      original: Option.getOrNull(editor.original),
      person: Option.getOrNull(model.person),
      qualification:
        "Constructed model rendered through the actual root view; no actor or provider operation.",
      selected: model.calendar.selected,
      theme,
      title: editor.draft.title,
    };

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Editor placeholders ${kind} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script id="placeholder-evidence" type="application/json">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script id="placeholder-proof">${placeholderProofScript}</script></body></html>`;
  }
);
