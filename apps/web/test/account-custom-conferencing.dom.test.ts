import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { WriteConferencingDefault } from "../src/client/conferencing/commands.js";
import { ConferencingChange } from "../src/client/conferencing/model.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { savedConferencingNotice } from "../src/client/editing/conferencing-notice.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { ConferencingSettingsChange as Change } from "../src/client/settings/conferencing/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import {
  accountCustomFixture,
  accountCustomModel,
  customChoice,
  customRoom,
} from "./account-custom-conferencing-fixture.js";
import {
  inheritanceSession,
  renderInheritanceRoot,
} from "./conferencing-inheritance-fixture.js";
import { writeBody } from "./editing-rpc-fixture.js";

const customSave = Effect.fn("test.successfulCustomSave")(
  function* customSave() {
    const session = yield* inheritanceSession(accountCustomModel("selected"));
    yield* session.add("guest@example.test");
    const saved = yield* session.save();
    const posts = saved.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(1);
    const body = writeBody(posts[0]?.body);
    expect(body.description).toBe(customRoom.link);
    expect(body).not.toHaveProperty("conferenceData");
    const mutation = Option.getOrThrow(saved.mutation);

    if (!EditorMutation.guards.Saved(mutation)) {
      return yield* Effect.die(
        "Expected successful custom-link Saved mutation"
      );
    }

    return { mutation, session };
  }
);

it.effect(
  "an exact saved HTML-anchor custom URL must not be appended a second time",
  () =>
    Effect.gen(function* saveExistingAnchor() {
      for (const description of [
        `<a href="${customRoom.link}">Room</a>`,
        `<a href='${customRoom.link}'>Room</a>`,
        `<a href="https://other.example.test/">${customRoom.link}</a>`,
      ]) {
        const session = yield* inheritanceSession(
          accountCustomModel("selected")
        );

        yield* session.add("guest@example.test");
        yield* session.dispatch(
          EditorAction.cases.TextEdited.make({
            field: "description",
            value: description,
          })
        );
        yield* session.take(
          (notice) =>
            Predicate.isTagged(notice, "Editor") &&
            Predicate.isTagged(notice.view, "Editing") &&
            notice.view.draft.description === description
        );
        const saved = yield* session.save();

        const posts = saved.requests.filter(
          (request) => request.method === "POST"
        );

        expect(posts).toHaveLength(1);
        const body = writeBody(posts[0]?.body);
        expect(
          body.description,
          "an exact saved HTML-anchor custom URL must not be appended a second time"
        ).toBe(description);
        expect(body).not.toHaveProperty("conferenceData");
        const mutation = Option.getOrThrow(saved.mutation);
        expect(EditorMutation.guards.Saved(mutation)).toBe(true);

        if (EditorMutation.guards.Saved(mutation)) {
          expect(Option.isNone(savedConferencingNotice(mutation))).toBe(true);
          expect(Option.isNone(session.get().editing.conferencingResult)).toBe(
            true
          );
        }
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "the actual account selector writes the stable custom reference through the existing named command",
  () =>
    Effect.sync(() => {
      const base = accountCustomModel("removed");

      const model = {
        ...base,
        conferencingSettings: {
          ...base.conferencingSettings,
          entries: [customRoom],
        },
      };

      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.change(
          Scene.selector("#conferencing-default-work"),
          `custom:${customRoom.id}`
        ),
        Scene.expect(
          Scene.selector("#conferencing-default-work")
        ).toBeDisabled(),
        Scene.Command.resolve(
          WriteConferencingDefault,
          Message.ChangedConferencing({
            change: ConferencingChange.cases.Received.make({
              accountId: "work",
              personId: Option.getOrThrow(model.person),
              requestId: 2,
              result: { accountId: "work", value: customChoice },
            }),
          })
        ),
        Scene.expect(Scene.selector("#conferencing-default-work")).toHaveValue(
          `custom:${customRoom.id}`
        ),
        Scene.expect(Scene.selector("#conferencing-default-work")).toBeEnabled()
      );
    })
);

it.effect(
  "the actual user-wide selector never offers the populated custom catalog",
  () =>
    Effect.gen(function* userBoundary() {
      const model = {
        ...accountCustomModel("selected"),
        route: SettingsRoute.make({ page: "conferencing" }),
      };

      const rendered = yield* renderInheritanceRoot(model);

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const select = document.querySelector("#user-default-conferencing");
      expect(
        [...(select?.querySelectorAll("option") ?? [])].map((option) =>
          option.getAttribute("value")
        ),
        "user-wide choices remain None and Google Meet"
      ).toEqual(["none", "googleMeet"]);
      expect(
        document.querySelector("#custom-video-account-room")
      ).not.toBeNull();
    })
);

it.effect(
  "catalog acknowledgements and failures cannot replace the preserved local import source",
  () =>
    Effect.sync(() => {
      const initial = accountCustomModel("selected");
      const personId = Option.getOrThrow(initial.person);

      const loading = update(
        initial,
        Message.ChangedConferencingSettings({
          change: Change.cases.Load.make({}),
          personId,
        })
      ).model;

      const changed = {
        ...customRoom,
        link: "https://room.example/server",
        name: "Server only",
      };

      const settled = update(
        loading,
        Message.ChangedConferencingSettings({
          change: Change.cases.Loaded.make({
            catalog: { conflicts: [customRoom.id], entries: [changed] },
            requestId: loading.conferencingSettings.requestId,
          }),
          personId,
        })
      ).model;

      expect(settled.conferencingSettings.entries).toEqual([changed]);
      expect(
        preferenceSnapshot(settled).customVideoLinks,
        "general preferences must preserve the legacy source, not the D1 projection"
      ).toEqual([customRoom]);
      expect(
        update(
          loading,
          Message.ChangedConferencingSettings({
            change: Change.cases.Loaded.make({
              catalog: { conflicts: [], entries: [] },
              requestId: loading.conferencingSettings.requestId,
            }),
            personId: "another-person",
          })
        ).model
      ).toEqual(loading);
    })
);

it.effect.each([390, 900, 1440])(
  "a custom proposal uses the actual editor actor and root recipient at %s without any write",
  (width) =>
    Effect.gen(function* editorProposal() {
      const fixture = yield* accountCustomFixture(
        "draft",
        width,
        width === 1440 ? "dark" : "light"
      );

      const document = new DOMParser().parseFromString(
        fixture.html,
        "text/html"
      );

      expect(document.body.textContent).toContain(customRoom.link);
      expect(document.body.textContent).toContain(
        "appended to the description when you save"
      );
      expect(
        document.querySelector("#event-remove-conferencing")
      ).not.toBeNull();
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "successful custom-link save must not report unconfirmed conferencing",
  () =>
    Effect.gen(function* successfulCustomNotice() {
      const { session } = yield* customSave();
      expect(
        Option.isNone(session.get().editing.conferencingResult),
        "successful custom-link save must not report unconfirmed conferencing"
      ).toBe(true);
      const rendered = yield* renderInheritanceRoot(session.get());

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.body.textContent).not.toContain(
        "conferencing could not be confirmed"
      );
      expect(
        document.querySelector('[aria-label="Saved event conferencing"]')
      ).toBeNull();
    }).pipe(Effect.scoped)
);

it.effect(
  "a Meet save without conference data must still report unconfirmed conferencing",
  () =>
    Effect.gen(function* meetNoticeControl() {
      const { mutation } = yield* customSave();

      const notice = savedConferencingNotice({
        ...mutation,
        plan: {
          ...mutation.plan,
          session: {
            ...mutation.plan.session,
            draft: {
              ...mutation.plan.session.draft,
              conferencing: {
                participantSeen: true,
                request: { kind: "googleMeet" },
              },
            },
          },
        },
      });

      expect(
        Option.getOrThrow(notice).status,
        "Meet without conference data must remain unconfirmed"
      ).toBe("unconfirmed");
    }).pipe(Effect.scoped)
);
