import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import { response } from "../../../packages/calendar/test/fake-google.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
  typeFixtureId,
  typeScenes,
} from "./create-type-runtime-fixture.js";
import { writeBody } from "./editing-rpc-fixture.js";

it.effect.each(typeScenes)(
  "create-time %s uses the normal root, editor actors, RPC and Google insert or a proved refusal",
  (scene) =>
    Effect.gen(function* createTypeRecipient() {
      const f = yield* createTypeRuntimeFixture(scene);
      const before = yield* Ref.get(f.state);
      expect(f.calendar.accountId).toBe("account");
      expect(f.calendar.calendarId).toBe("calendar");
      expect(f.calendar.accessRole).toBe("owner");
      expect(f.calendar.primary).toBe(scene !== "ineligible");
      expect(EditorView.guards.Editing(before.editing.view)).toBe(true);
      const rendered = yield* renderTypeRoot(before);
      const doc = new DOMParser().parseFromString(rendered.html, "text/html");
      const control = doc.querySelector("#event-type");
      expect(control).not.toBeNull();
      expect(
        doc.querySelector<HTMLElement>("[data-status-entitlement]")?.dataset
          .statusEntitlement
      ).toBe(scene === "ineligible" ? "ineligible" : "unknown");

      if (scene === "ineligible") {
        expect(
          doc
            .querySelector('#event-type option[value="focusTime"]')
            ?.hasAttribute("disabled")
        ).toBe(true);
        expect(doc.querySelector("#event-type-reason")?.textContent).toBe(
          "Focus time and Out of office only work on your primary calendar."
        );
        yield* f.dispatch(
          EditorAction.cases.EventTypeSelected.make({ value: "focusTime" })
        );

        const refused = yield* nextTypeNotice(f.queue, (notice) =>
          Option.isSome(notice.error)
        );

        expect(Option.getOrThrow(refused.error)).toContain("primary calendar");
        expect(yield* Ref.get(f.api.fake.receipts)).toHaveLength(0);

        return;
      }

      yield* f.dispatch(EditorAction.cases.Save.make({}));

      const settled = yield* nextTypeNotice(f.queue, (notice) =>
        scene === "refused"
          ? EditorView.guards.Failure(notice.view)
          : Option.isSome(notice.mutation)
      );

      const receipts = yield* Ref.get(f.api.fake.receipts);

      const posts = receipts.filter(
        (receipt) => receipt.request.method === "POST"
      );

      expect(posts).toHaveLength(1);
      const [receipt] = posts;
      expect(receipt).toBeDefined();
      const body = writeBody(receipt?.request.body);
      expect(receipt?.request.accountId).toBe(f.calendar.accountId);
      expect(receipt?.request.path).toBe(
        "/calendars/calendar/events?sendUpdates=none"
      );
      expect(body.id).toBe(typeFixtureId);
      expect(body.attendees).toEqual([]);
      expect(body.start).toEqual({
        dateTime: "2026-10-21T16:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });
      expect(body.end).toEqual({
        dateTime:
          scene === "ooo"
            ? "2026-10-24T00:00:00.000Z"
            : "2026-10-21T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });

      if (scene !== "event") {
        expect(body.eventType).toBe(
          scene === "ooo" ? "outOfOffice" : "focusTime"
        );
        expect(body.transparency).toBe("opaque");
        expect(
          body[
            scene === "ooo" ? "outOfOfficeProperties" : "focusTimeProperties"
          ]
        ).toEqual({ autoDeclineMode: "declineNone" });
        expect(
          body[
            scene === "ooo" ? "focusTimeProperties" : "outOfOfficeProperties"
          ]
        ).toBeUndefined();
        expect(body.conferenceData).toBeUndefined();
      }

      if (scene === "refused") {
        expect(receipt?.response.status).toBe(403);
        expect(posts.filter((post) => post.response.status < 300)).toHaveLength(
          0
        );
        expect(EditorView.guards.Failure(settled.view)).toBe(true);
        const after = yield* Ref.get(f.state);

        const failed = yield* Schema.decodeUnknownEffect(
          EditorView.cases.Failure
        )(after.editing.view);

        const initial = yield* Schema.decodeUnknownEffect(
          EditorView.cases.Editing
        )(before.editing.view);

        expect(failed.draft).toEqual(initial.draft);
        const failedRender = yield* renderTypeRoot(after);
        expect(failedRender.html).toContain(
          "Google didn't accept a Focus time event for this account. Nothing was created."
        );
        expect(failedRender.html).toContain("event-save-as-event");
      } else {
        expect(receipt?.response.status).toBe(200);
        expect(Option.isSome(settled.mutation)).toBe(true);
        const mutation = Option.getOrThrow(settled.mutation);
        expect(mutation._tag).toBe("Saved");
      }
    })
);

it.effect(
  "Save as event is explicit after a confirmed refusal, reuses the create id and does not cache entitlement",
  () =>
    Effect.gen(function* explicitFallback() {
      const f = yield* createTypeRuntimeFixture("refused");
      yield* f.dispatch(EditorAction.cases.Save.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        EditorView.guards.Failure(notice.view)
      );
      expect(
        (yield* Ref.get(f.api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "POST"
        )
      ).toHaveLength(1);
      yield* Ref.set(f.api.fake.pending, [
        response(200, { ...f.saved, eventType: "default" }),
      ]);
      yield* f.dispatch(EditorAction.cases.SaveAsEvent.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        Option.isSome(notice.mutation)
      );

      const posts = (yield* Ref.get(f.api.fake.receipts)).filter(
        (receipt) => receipt.request.method === "POST"
      );

      expect(posts).toHaveLength(2);
      const fallback = writeBody(posts[1]?.request.body);
      expect(fallback.id).toBe(typeFixtureId);
      expect(fallback.eventType).toBeUndefined();
      expect(fallback.focusTimeProperties).toBeUndefined();
      expect(fallback.outOfOfficeProperties).toBeUndefined();
      expect(posts[1]?.request.path).toContain("sendUpdates=none");
      expect(fallback.summary).toBe("Writing time");
      expect((yield* Ref.get(f.state)).calendar.calendars).toEqual(
        f.model.calendar.calendars
      );
    })
);

it.effect(
  "an unconfirmed status insert is not reported as zero creation and cannot fall back or retry as another type",
  () =>
    Effect.gen(function* unknownInsert() {
      const f = yield* createTypeRuntimeFixture("refused", 503);
      yield* f.dispatch(EditorAction.cases.Save.make({}));
      yield* nextTypeNotice(f.queue, (notice) =>
        EditorView.guards.Failure(notice.view)
      );
      const rendered = yield* renderTypeRoot(yield* Ref.get(f.state));
      expect(rendered.html).toContain("result could not be confirmed");
      expect(rendered.html).not.toContain("Nothing was created.");
      expect(rendered.html).not.toContain("event-save-as-event");
      yield* f.dispatch(EditorAction.cases.SaveAsEvent.make({}));
      yield* f.dispatch(EditorAction.cases.Retry.make({}));
      const receipts = yield* Ref.get(f.api.fake.receipts);
      expect(
        receipts.filter((receipt) => receipt.request.method === "POST")
      ).toHaveLength(1);
      expect(
        EditorView.guards.Failure((yield* Ref.get(f.state)).editing.view)
      ).toBe(true);
    })
);
