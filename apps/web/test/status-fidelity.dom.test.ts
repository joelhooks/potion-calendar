import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { writeBody } from "./editing-rpc-fixture.js";
import {
  nextTypeNotice,
  renderStatusRoot,
  savedStatusFixture,
} from "./status-fidelity-fixture.js";

const requireDetailsPanel = (document: Document) => {
  const panel = document.querySelector(".detail-panel");

  if (panel === null) {
    throw new Error("Missing selected status details");
  }

  return panel;
};

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "saved %s details omit ordinary sections even when the source contains adversarial ordinary metadata",
  (type) =>
    Effect.gen(function* savedStatusDetails() {
      const f = yield* savedStatusFixture({
        mode: "declineOnlyNewConflictingInvitations",
        type,
      });

      expect(f.calendar.accessRole).toBe("owner");
      expect(f.source.organizer?.self).toBe(true);
      expect(f.source.eventType).toBe(type);
      expect(f.source.attendees?.length).toBe(2);
      expect(f.source.attachments?.length).toBe(1);
      expect(f.source.location).toContain("Station hall");
      expect(f.source.description).toContain("Private notes");
      expect(f.source.conferenceUrl).toBeDefined();
      const rendered = yield* renderStatusRoot(yield* Ref.get(f.state));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const panel = requireDetailsPanel(document);
      expect(panel.querySelector("[data-saved-event-type]")?.textContent).toBe(
        type === "focusTime" ? "Focus time" : "Out of office"
      );
      expect(panel.querySelector(".detail-status-policy")?.textContent).toBe(
        "Declines new invitations during this time."
      );
      const when = `${panel.querySelector(".detail-date")?.textContent ?? ""} ${panel.querySelector(".detail-time")?.textContent ?? ""}`;
      expect(when).toContain("9am");
      expect(when).toContain(type === "outOfOffice" ? "5pm" : "10am");
      expect(panel.querySelector(".detail-calendar")?.textContent).toContain(
        "Work"
      );

      for (const selector of [
        ".event-rsvp",
        ".email-participants",
        ".join-link",
        "a",
      ]) {
        expect(panel.querySelector(selector)).toBeNull();
      }

      expect(
        [...panel.querySelectorAll("h3")].map((heading) => heading.textContent)
      ).toEqual(["Calendar"]);
      expect(panel.textContent).not.toContain("Private notes");
      expect(panel.textContent).not.toContain("Casey");

      const edit = [...panel.querySelectorAll("button")].find(
        (button) => button.textContent === "Edit"
      );

      expect(edit?.disabled).toBe(false);
    })
);

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "the %s checkbox prefills a supported saved mode and PATCHes only its explicit matching change",
  (type) =>
    Effect.gen(function* statusPolicyChange() {
      const f = yield* savedStatusFixture({
        mode: "declineOnlyNewConflictingInvitations",
        type,
      });

      yield* f.open();
      const rendered = yield* renderStatusRoot(yield* Ref.get(f.state));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.checked
      ).toBe(true);
      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.disabled
      ).toBe(false);

      for (const id of [
        "event-location",
        "event-description",
        "event-links",
        "event-participantEmail",
        "event-add-meet",
        "event-type",
      ]) {
        expect(document.querySelector(`#${id}`)).toBeNull();
      }

      yield* f.dispatch(
        EditorAction.cases.StatusInvitationsChosen.make({ value: false })
      );
      yield* nextTypeNotice(
        f.queue,
        (notice) =>
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.statusInvitationChoice === "declineNone"
      );

      const key =
        type === "focusTime" ? "focusTimeProperties" : "outOfOfficeProperties";

      const prior =
        type === "focusTime"
          ? f.source.focusTimeProperties
          : f.source.outOfOfficeProperties;

      const properties = writeBody(JSON.stringify(prior));
      yield* Ref.set(f.api.fake.pending, [
        response(200, f.raw),
        response(200, {
          accessRole: "owner",
          id: f.calendar.calendarId,
          primary: true,
        }),
        response(200, {
          ...f.raw,
          [key]: { ...properties, autoDeclineMode: "declineNone" },
        }),
      ]);
      yield* f.dispatch(EditorAction.cases.Save.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        Option.isSome(notice.mutation)
      );

      const patches = (yield* Ref.get(f.api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "PATCH"
      );

      expect(patches).toHaveLength(1);
      expect(patches[0]?.request.accountId).toBe(f.source.accountId);
      expect(patches[0]?.request.path).toBe(
        `/calendars/calendar/events/${f.source.eventId}?sendUpdates=none`
      );
      expect(writeBody(patches[0]?.request.body)).toEqual({
        [key]: { autoDeclineMode: "declineNone" },
      });
    })
);

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "a saved all-conflicting %s policy is read-only and survives a title-only PATCH",
  (type) =>
    Effect.gen(function* preserveUnsupportedPolicy() {
      const f = yield* savedStatusFixture({
        mode: "declineAllConflictingInvitations",
        type,
      });

      yield* f.open();
      const rendered = yield* renderStatusRoot(yield* Ref.get(f.state));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.checked
      ).toBe(true);
      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.disabled
      ).toBe(true);
      expect(
        document.querySelector("#event-status-policy-readonly")?.textContent
      ).toBe(
        "Google is set to decline all conflicting invitations. Change this in Google Calendar."
      );
      yield* f.dispatch(
        EditorAction.cases.StatusInvitationsChosen.make({ value: false })
      );
      yield* nextTypeNotice(f.queue, (notice) => Option.isSome(notice.error));
      yield* f.titleEdit();

      const patches = (yield* Ref.get(f.api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "PATCH"
      );

      expect(patches).toHaveLength(1);
      expect(patches[0]?.request.path).toContain("sendUpdates=none");
      expect(writeBody(patches[0]?.request.body)).toEqual({
        summary: "Drafting the plan",
      });
    })
);

it.effect.each(["reader", "writer"] as const)(
  "shared %s status metadata cannot enable meeting or policy controls",
  (role) =>
    Effect.gen(function* sharedStatusPermissions() {
      const f = yield* savedStatusFixture({
        mode: "declineNone",
        organizer: false,
        role,
        type: "focusTime",
      });

      yield* f.open();
      const rendered = yield* renderStatusRoot(yield* Ref.get(f.state));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLInputElement>("#event-title")?.disabled
      ).toBe(true);
      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.disabled
      ).toBe(true);
      yield* f.dispatch(
        EditorAction.cases.StatusInvitationsChosen.make({ value: true })
      );
      yield* nextTypeNotice(f.queue, (notice) => Option.isSome(notice.error));
      expect(
        (yield* Ref.get(f.api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "PATCH"
        )
      ).toHaveLength(0);
    })
);

it.effect(
  "a missing saved policy stays Unknown and is not synthesized during an unrelated title edit",
  () =>
    Effect.gen(function* missingPolicy() {
      const f = yield* savedStatusFixture({
        mode: undefined,
        type: "focusTime",
      });

      yield* f.open();
      const rendered = yield* renderStatusRoot(yield* Ref.get(f.state));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLInputElement>("#event-status-invitations")
          ?.disabled
      ).toBe(true);
      expect(
        document.querySelector("#event-status-policy-readonly")?.textContent
      ).toContain("didn't provide");
      yield* f.titleEdit();

      const patches = (yield* Ref.get(f.api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "PATCH"
      );

      expect(patches).toHaveLength(1);
      expect(writeBody(patches[0]?.request.body)).toEqual({
        summary: "Drafting the plan",
      });
    })
);
