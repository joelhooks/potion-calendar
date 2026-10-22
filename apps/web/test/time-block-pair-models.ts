import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ClipboardView } from "../src/client/clipboard/model.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { emptyTimeBlocks } from "../src/layout/time-blocks.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";
import { collectGroupArtifact } from "./clipboard-group-artifact-fixture.js";
import { clipboardGuestFixture } from "./clipboard-root-fixture.js";
import { compactSceneModel } from "./compact-timed-fixture.js";
import { nativeEdgeScene } from "./edge-scroll-native.js";
import { editorCalendars, editorViewFields } from "./editor-fixture.js";
import { placeholderModel } from "./editor-placeholders-fixture.js";
import {
  shortcutFixture,
  pressEditorShortcut,
  receiveShortcutEditor,
} from "./editor-shortcut-fixture.js";
import { emailFixture } from "./email-participants-fixture.js";
import { emptyStateFixture } from "./empty-states-fixture.js";
import { copyFixtureModel } from "./equivalent-fixture.js";
import { eventZoneUiFixture } from "./event-zone-ui-fixture.js";
import { fixtureModel, fixtureSelection } from "./fixture.js";
import { heldModRuntimeFixture } from "./held-mod-runtime-fixture.js";
import { instantArtifactFixture } from "./instant-artifact-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { mapsFixture, settleMapsSnapshot } from "./location-maps-fixture.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";
import { navigationFixture } from "./navigation-root-fixture.js";
import { reminderCardScene } from "./reminder-card-fixture.js";
import {
  createReminderSession,
  reminderEditorView,
} from "./reminder-editor-fixture.js";
import { selectedReadFixture } from "./selected-event-read-fixture.js";
import { settingsManagementFixture } from "./settings-management-fixture.js";
import { statusFidelityScene } from "./status-fidelity-scene.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

const CoreGridPairFamily = Schema.Literals([
  "base-week",
  "equivalent-copies",
  "editing-dialogs",
  "manipulation-previews",
  "keyboard-menu",
  "panels",
  "bulk-selection",
  "clipboard-single",
  "clipboard-group",
  "instant-no-email",
  "held-modifiers",
  "event-zone",
  "location-maps",
  "display-zones",
  "edge-scroll",
  "compact-timed",
]);

const SupplementGridPairFamily = Schema.Literals([
  "navigation",
  "empty-week",
  "joining",
  "upcoming-reload",
  "conferencing-editor",
  "conferencing-notice",
  "placeholders",
  "status-fidelity",
  "editor-shortcuts",
  "reminder-picker",
  "event-links",
  "email-participants",
  "primary-gutter",
  "settings-clock",
  "selected-event-read",
  "reminder-cards",
]);

export const GridPairFamily = Schema.Literals([
  ...CoreGridPairFamily.literals,
  ...SupplementGridPairFamily.literals,
]);

const manipulationModel = (): AppModel => {
  const base = fixtureSelection();
  const selected = visibleEvents(base).find((event) => event.selected);

  if (selected === undefined) {
    throw new Error("Missing manipulation source");
  }

  return {
    ...base,
    editing: {
      ...base.editing,
      gesture: Option.some({
        allDayRow: false,
        duplicate: false,
        id: 1,
        range: {
          allDay: false,
          endDate: "2026-10-19",
          endTime: "12:00",
          startDate: "2026-10-19",
          startTime: "11:00",
        },
        target: gestureTarget(selected, base.calendar.zone),
      }),
    },
  };
};

const linkedModel = (): AppModel => {
  const base = fixtureSelection();

  return {
    ...base,
    calendar: {
      ...base.calendar,
      reads: base.calendar.reads.map((read) => ({
        ...read,
        events: RemoteEvents.Success({
          data: {
            events: visibleEvents(base)
              .filter((item) => item.source.accountId === read.accountId)
              .map((item) =>
                item.selected
                  ? {
                      ...item.source,
                      attachments: [
                        {
                          title: "Review.pdf",
                          url: "https://files.example.test/review.pdf",
                        },
                      ],
                      description: "Source https://example.test/notes",
                    }
                  : item.source
              ),
            versions: [],
          },
        }),
      })),
    },
  };
};

const pairBase = Effect.fn("gridPairBase")(function* pairBase(
  family: typeof CoreGridPairFamily.Type,
  width: number,
  theme: "light" | "dark"
) {
  switch (family) {
    case "base-week": {
      return fixtureModel();
    }

    case "equivalent-copies": {
      return copyFixtureModel();
    }

    case "editing-dialogs": {
      const base = fixtureSelection();

      return {
        ...base,
        editing: {
          ...base.editing,
          view: EditorView.cases.Editing.make(editorViewFields),
        },
      };
    }

    case "manipulation-previews": {
      return manipulationModel();
    }

    case "keyboard-menu": {
      return update(
        keyboardFixture(),
        Message.KeyboardAction({ id: "commands" })
      ).model;
    }

    case "panels": {
      return update(
        fixtureSelection(),
        Message.KeyboardAction({ id: "sidebar" })
      ).model;
    }

    case "bulk-selection": {
      const fixture = bulkRootFixture();

      return {
        ...fixture.model,
        calendar: {
          ...fixture.model.calendar,
          selected: fixture.keys.slice(0, 2),
        },
      };
    }

    case "clipboard-single": {
      const base = clipboardGuestFixture();

      return {
        ...base,
        clipboard: {
          ...base.clipboard,
          view: ClipboardView.cases.Idle.make({
            copied: base.clipboard.view.copied,
            toast: Option.some({
              id: "copy-toast",
              message:
                "Copied event. Repeat and native conferencing are not copied.",
            }),
          }),
        },
      };
    }

    case "clipboard-group": {
      return (yield* collectGroupArtifact("success-week")).model;
    }

    case "instant-no-email": {
      return (yield* Effect.scoped(instantArtifactFixture("meeting-delete")))
        .model;
    }

    case "held-modifiers": {
      return (yield* Effect.scoped(
        heldModRuntimeFixture({ scenario: "week-move" })
      )).model;
    }

    case "event-zone": {
      return eventZoneUiFixture();
    }

    case "location-maps": {
      return settleMapsSnapshot(mapsFixture());
    }

    case "display-zones": {
      return timeZonesFixture(
        true,
        theme === "dark",
        width - (width <= 1000 ? 445 : 520)
      );
    }

    case "edge-scroll": {
      return (yield* Effect.scoped(
        nativeEdgeScene({ scene: "timed-move", theme, width })
      )).model;
    }

    case "compact-timed": {
      return compactSceneModel("boundary", width, theme);
    }

    default: {
      return yield* Effect.die("Missing core grid representative");
    }
  }
});

const pairBaseSupplement = Effect.fn("gridPairBaseSupplement")(
  function* pairBaseSupplement(
    family: typeof SupplementGridPairFamily.Type,
    width: number,
    theme: "light" | "dark"
  ) {
    switch (family) {
      case "navigation": {
        return navigationFixture(theme, width, "week-hidden");
      }

      case "empty-week": {
        return emptyStateFixture("empty-week");
      }

      case "joining": {
        return meetingModel([
          savedMeeting(1, 10, 60, {
            conferenceUrl: "https://meet.google.com/abc-defg-hij",
          }),
        ]);
      }

      case "upcoming-reload": {
        const base = meetingModel([savedMeeting(1, 20, 60)]);
        const data = Option.getOrThrow(AsyncData.getData(base.upcoming.data));

        return {
          ...base,
          upcoming: {
            ...base.upcoming,
            data: RemoteEvents.Refreshing({ data }),
          },
        };
      }

      case "conferencing-editor": {
        const base = fixtureSelection();

        return {
          ...base,
          calendar: { ...base.calendar, calendars: editorCalendars },
          editing: {
            ...base.editing,
            view: EditorView.cases.Editing.make(editorViewFields),
          },
        };
      }

      case "conferencing-notice": {
        const base = fixtureSelection();

        return {
          ...base,
          editing: {
            ...base.editing,
            conferencingResult: Option.some({
              accountId: "work",
              calendarId: "primary",
              eventId: "saved-event",
              id: "saved-mutation",
              status: "unconfirmed",
              title: "Design review",
            }),
          },
        } satisfies AppModel;
      }

      case "placeholders": {
        return placeholderModel("edit", width, theme);
      }

      case "status-fidelity": {
        return (yield* statusFidelityScene("focus-details")).model;
      }

      case "editor-shortcuts": {
        return receiveShortcutEditor(
          pressEditorShortcut(shortcutFixture("with-conferencing"), "t").model
        );
      }

      case "reminder-picker": {
        const base = keyboardFixture();
        const session = yield* createReminderSession(false);

        return {
          ...base,
          calendar: { ...base.calendar, calendars: editorCalendars },
          editing: { ...base.editing, view: reminderEditorView(session) },
        };
      }

      case "event-links": {
        return linkedModel();
      }

      case "email-participants": {
        return emailFixture("button");
      }

      case "primary-gutter": {
        return settingsManagementFixture("primary", theme === "dark", width);
      }

      case "settings-clock": {
        const base = fixtureSelection();

        return {
          ...base,
          settings: { ...base.settings, timeFormat: "24" },
        } satisfies AppModel;
      }

      case "selected-event-read": {
        return update(
          selectedReadFixture("selected"),
          Message.KeyboardAction({ id: "commands" })
        ).model;
      }

      case "reminder-cards": {
        return reminderCardScene("prompt", theme, width).model;
      }

      default: {
        return yield* Effect.die("Missing grid representative");
      }
    }
  }
);

export const gridPairModel = Effect.fn("gridPairModel")(function* gridPairModel(
  family: typeof GridPairFamily.Type,
  width: number,
  theme: "light" | "dark"
) {
  const base = yield* Schema.is(CoreGridPairFamily)(family)
    ? pairBase(family, width, theme)
    : pairBaseSupplement(family, width, theme);

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      viewport: 844,
      viewportWidth: width - (width <= 1000 ? 445 : 520),
    },
    settings: { ...base.settings, theme, timeBlocks: emptyTimeBlocks() },
  };

  return model;
});
