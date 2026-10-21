import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { joinSelection } from "../src/client/meetings/selection.js";
import { savedMeetings } from "../src/client/meetings/source.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

it.effect(
  "joining a selected event uses its saved link while leaving an unconfirmed edit intact",
  () =>
    Effect.gen(function* savedAuthority() {
      const source = savedMeeting(0, 30, 60, {
        conferenceUrl: undefined,
        location: "https://meet.google.com/saved-link",
        organizer: { self: true },
      });

      const base = meetingModel([source]);
      const [candidate] = savedMeetings(base);

      if (candidate === undefined) {
        throw new Error("Missing saved selection fixture");
      }

      const selected = update(
        base,
        Message.ClickedEvent({ key: candidate.item.key })
      ).model;

      const baseline = yield* eventDraft(source, undefined, base.calendar.zone);

      const session = LoadedEditor.make({
        baseline,
        calendars: base.calendar.calendars.map((calendar) => ({
          ...calendar,
          accessRole: "owner",
        })),
        createId: Option.none(),
        draft: {
          ...baseline,
          location: "https://meet.google.com/unconfirmed-link",
        },
        id: "meeting-write",
        kind: "edit",
        master: Option.none(),
        moveSupport: "notAvailable",
        navigation: base.calendar.navigation,
        operation: "save",
        original: Option.some(source),
        selection: primarySelection(selected.calendar.selected),
      });

      const plan = yield* prepareEditor(session);

      const view = EditorView.cases.Saving.make({
        draft: session.draft,
        error: Option.none(),
        kind: "edit",
        moveSupport: "notAvailable",
        operation: "save",
        original: session.original,
        permissions: {
          calendarWritable: true,
          editGuests: true,
          editMeeting: true,
          inviteGuests: true,
        },
      });

      const pending = update(
        selected,
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Editor.make({
            error: Option.none(),
            mutation: Option.none(),
            plan: Option.some(plan),
            saving: true,
            view,
          }),
          personId: Option.getOrThrow(base.person),
        })
      ).model;

      expect(
        visibleEvents(pending).find((event) => event.selected)?.source.location
      ).toBe("https://meet.google.com/unconfirmed-link");
      expect(joinSelection(pending)).toMatchObject({
        conferenceUrl: "https://meet.google.com/saved-link",
      });

      const requested = update(
        pending,
        Message.RequestedJoinMeeting({ key: Option.none() })
      );

      expect(requested.model.editing).toBe(pending.editing);
      expect(
        requested.commands?.find((entry) => entry.name === "JoinMeeting")?.args
      ).toMatchObject({
        selection: { conferenceUrl: "https://meet.google.com/saved-link" },
      });
    })
);
