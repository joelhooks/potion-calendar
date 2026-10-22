import { Effect, Option, Ref } from "effect";

import { Message } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { ShortcutsRoute } from "../src/layout/route.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";
import { modDeleteKey } from "./mod-delete-fixture.js";

export const modDeleteScenarios = [
  "organizer-repeat",
  "invitation",
  "no-guests",
  "mixed",
  "shortcuts",
  "catalog",
] as const;

export type ModDeleteScenario = (typeof modDeleteScenarios)[number];

export const modDeleteArtifactFixture = Effect.fn("modDeleteArtifactFixture")(
  function* modDeleteArtifactFixture(scenario: ModDeleteScenario) {
    const h = yield* instantRuntimeFixture({
      bulk: scenario === "mixed",
      mixedGuests: scenario === "mixed",
      noGuests: scenario === "no-guests",
      operation: "delete",
      organizer: scenario !== "invitation",
      recurring: scenario === "organizer-repeat",
      undo: false,
    });

    const before = h.model;

    if (scenario === "shortcuts") {
      yield* Ref.update(h.state, (model) => ({
        ...model,
        route: ShortcutsRoute.make({ section: Option.none() }),
      }));
      yield* h.dispatch(Message.KeyboardQuery({ query: "Delete" }));
    } else if (scenario === "catalog") {
      yield* h.dispatch(Message.KeyboardAction({ id: "commands" }));
      yield* h.dispatch(Message.KeyboardQuery({ query: "Delete" }));
    } else {
      yield* h.dispatch(
        Option.getOrThrow(
          modDeleteKey(before, {
            alias: "Backspace",
            platform: "MacIntel",
            shift: false,
          })
        )
      );
      yield* nextInstantNotice(h.queue, (notice) =>
        scenario === "mixed"
          ? EditingNotice.guards.Bulk(notice) &&
            BulkView.guards.Settled(notice.view)
          : EditingNotice.guards.Editor(notice) &&
            Option.isSome(notice.mutation) &&
            EditorMutation.guards.DeletedStaged(notice.mutation.value)
      );
    }

    const model = yield* Ref.get(h.state);
    const requests = yield* Ref.get(h.api.fake.requests);

    const marks = model.editing.deletes.filter(
      (mark) => mark.phase === "pending"
    );

    const email = scenario === "organizer-repeat" || scenario === "mixed";

    const expected = {
      catalog: "Delete instantly",
      invitation:
        'Removed "Weekly sync" from your calendar. Google may email the organizer.',
      mixed: "Guests will be notified.",
      "no-guests": 'Cancelled "Weekly sync". No email sent.',
      "organizer-repeat":
        'Cancelled this occurrence of "Design review". Guests will be notified.',
      shortcuts: "Delete instantly",
    }[scenario];

    return {
      evidence: {
        calendar: before.calendar.calendars[0],
        companion:
          scenario === "organizer-repeat"
            ? JSON.stringify([
                h.source.accountId,
                h.source.calendarId,
                "instant-next-occurrence",
              ])
            : undefined,
        email,
        expected,
        loaded: before.calendar.reads.length > 0,
        mutations: requests.filter((request) => request.method !== "GET"),
        pending: marks.map((mark) => ({
          event: mark.intent.event,
          id: mark.intent.id,
          request: mark.intent.request,
        })),
        scenario,
        selected: before.calendar.selected,
        source: h.source,
        views: h.views,
      },
      model,
    };
  }
);
