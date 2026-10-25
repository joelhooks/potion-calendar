import { normalizeProfileName } from "@calendar/auth/contracts";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { UrlRequest } from "foldkit/navigation";
import { fromString } from "foldkit/url";

import { Message, update } from "../src/client/app.js";
import {
  ProfileChange,
  ProfileReply,
} from "../src/client/settings/profile/model.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  SettingsRoute,
} from "../src/layout/route.js";
import {
  profileChange,
  profileFixture,
  profileSnapshot,
} from "./profile-fixture.js";

it.effect(
  "profile success updates the shared identity and makes the normalized draft pristine",
  () =>
    Effect.sync(() => {
      const current = profileFixture();

      const edited = profileChange(
        current,
        ProfileChange.cases.Name.make({ value: "  Saved Person  " })
      ).model;

      const saving = profileChange(edited, ProfileChange.cases.Save.make({}));
      expect(saving.model.profile.mode).toBe("saving");
      expect(
        saving.commands?.filter(
          (command) => command.name === "RunProfileRequest"
        )
      ).toHaveLength(1);

      const saved = update(
        saving.model,
        Message.ProfileCompleted({
          personId: Option.getOrThrow(current.person),
          reply: ProfileReply.cases.Saved.make({ name: "Saved Person" }),
          sequence: saving.model.profile.sequence,
        })
      );

      expect(saved.model.profile.mode).toBe("pristine");
      expect(saved.model.profile.draft).toBe("Saved Person");
      expect(saved.model.profile.savedName).toBe("Saved Person");
      expect(profileSnapshot(saved.model).user.name).toBe("Saved Person");
      expect(
        update(saved.model, Message.RequestedRouteBack()).commands?.map(
          (command) => command.name
        )
      ).toContain("BackRoute");
    })
);

it.effect(
  "another save or input while pending cannot schedule a duplicate or overwrite the submitted draft",
  () =>
    Effect.sync(() => {
      const saving = profileFixture("saving");

      const duplicate = profileChange(
        saving,
        ProfileChange.cases.Save.make({})
      );

      expect(duplicate.commands ?? []).toEqual([]);
      expect(duplicate.model.profile).toEqual(saving.profile);
      expect(
        profileChange(
          saving,
          ProfileChange.cases.Name.make({ value: "Another" })
        ).model.profile
      ).toEqual(saving.profile);
    })
);

it.effect.each(["route", "back", "escape"] as const)(
  "dirty %s exit waits for an explicit discard and Continue editing preserves the draft",
  (exit) =>
    Effect.sync(() => {
      const base = profileFixture();

      const editing = profileChange(
        base,
        ProfileChange.cases.Name.make({ value: "Unsaved Person" })
      ).model;

      const message =
        exit === "back"
          ? Message.RequestedRouteBack()
          : Message.RequestedRoute({
              replace: exit === "escape",
              route:
                exit === "escape"
                  ? CalendarRoute.make({})
                  : SettingsRoute.make({ page: "general" }),
            });

      const guarded = update(editing, message);
      expect(guarded.model.profile.mode).toBe("confirming");
      expect(guarded.commands ?? []).toEqual([]);
      expect(guarded.model.route).toEqual(editing.route);

      const continued = profileChange(
        guarded.model,
        ProfileChange.cases.Continue.make({})
      );

      expect(continued.model.profile.mode).toBe("editing");
      expect(continued.model.profile.draft).toBe("Unsaved Person");
      const second = update(continued.model, message);

      const discarded = profileChange(
        second.model,
        ProfileChange.cases.Discard.make({})
      );

      expect(discarded.commands?.map((command) => command.name)).toContain(
        exit === "back" ? "BackRoute" : "NavigateRoute"
      );
      expect(discarded.model.profile.draft).not.toBe("Unsaved Person");
    })
);

it.effect.each(["general", "calendars"] as const)(
  "the actual internal %s URL intent stays pending until Discard and resumes without an alias write",
  (page) =>
    Effect.sync(() => {
      const current = profileChange(
        profileFixture(),
        ProfileChange.cases.Name.make({ value: "Unsaved Person" })
      ).model;

      const request = UrlRequest.Internal({
        url: Option.getOrThrow(
          fromString(`http://calendar.test/settings/${page}`)
        ),
      });

      const guarded = update(current, Message.BrowserUrlRequested({ request }));
      expect(guarded.model.profile.mode).toBe("confirming");
      expect(guarded.commands ?? []).toEqual([]);
      expect(guarded.model.route).toEqual(
        SettingsRoute.make({ page: "profile" })
      );

      const discarded = profileChange(
        guarded.model,
        ProfileChange.cases.Discard.make({})
      );

      expect(discarded.commands?.[0]?.name).toBe(
        page === "calendars" ? "NavigateRoute" : "FollowRouteRequest"
      );

      if (page === "calendars") {
        expect(discarded.commands?.[0]?.args).toEqual({
          replace: false,
          route: AccountSettingsRoute.make({ accountId: "work" }),
        });
      } else {
        expect(discarded.commands?.[0]?.args).toEqual({ request });
      }
    })
);

it.effect(
  "save failure retains the draft and re-arms dirty exit confirmation",
  () =>
    Effect.sync(() => {
      const failed = profileFixture("failure");
      expect(failed.profile.mode).toBe("editing");
      expect(failed.profile.draft).toBe("Updated Person");
      expect(Option.getOrUndefined(failed.profile.error)).toContain(
        "changes are still here"
      );
      expect(
        update(failed, Message.RequestedRouteBack()).model.profile.mode
      ).toBe("confirming");
    })
);

it.effect(
  "leaving while saving is allowed, late receipts are ignored, and re-entry reads persisted identity",
  () =>
    Effect.sync(() => {
      const saving = profileFixture("saving");
      const personId = Option.getOrThrow(saving.person);
      const { sequence } = saving.profile;

      const left = update(
        saving,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "general" }),
        })
      ).model;

      expect(left.profile.mode).toBe("idle");

      const receipt = Message.ProfileCompleted({
        personId,
        reply: ProfileReply.cases.Saved.make({ name: "Updated Person" }),
        sequence,
      });

      expect(update(left, receipt).model.profile).toEqual(left.profile);
      expect(profileSnapshot(update(left, receipt).model).user.name).toBe(
        profileSnapshot(left).user.name
      );

      const reopened = update(
        left,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "profile" }),
        })
      );

      expect(reopened.model.profile.mode).toBe("loading");
      expect(
        reopened.commands?.some(
          (command) => command.name === "RunProfileRequest"
        )
      ).toBe(true);
      const snapshot = profileSnapshot(reopened.model);

      const loaded = update(
        reopened.model,
        Message.ProfileCompleted({
          personId,
          reply: ProfileReply.cases.Loaded.make({
            snapshot: {
              ...snapshot,
              user: { ...snapshot.user, name: "Persisted Person" },
            },
          }),
          sequence: reopened.model.profile.sequence,
        })
      ).model;

      expect(loaded.profile.draft).toBe("Persisted Person");
      expect(loaded.profile.mode).toBe("pristine");
      expect(update(loaded, receipt).model.profile.draft).toBe(
        "Persisted Person"
      );
    })
);

it.effect(
  "wrong-person, wrong-request and mismatched-session replies cannot replace the current draft",
  () =>
    Effect.sync(() => {
      const saving = profileFixture("saving");
      const personId = Option.getOrThrow(saving.person);

      for (const request of [
        { personId: "another-person", sequence: saving.profile.sequence },
        { personId, sequence: saving.profile.sequence - 1 },
      ]) {
        const result = update(
          saving,
          Message.ProfileCompleted({
            ...request,
            reply: ProfileReply.cases.Saved.make({ name: "Wrong" }),
          })
        );

        expect(result.model.profile).toEqual(saving.profile);
        expect(profileSnapshot(result.model).user.name).toBe(
          profileSnapshot(saving).user.name
        );
      }
    })
);

it.effect(
  "a changed session cannot seed the profile and retry performs a fresh read",
  () =>
    Effect.sync(() => {
      const current = profileFixture();

      const left = update(
        current,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "general" }),
        })
      ).model;

      const loading = update(
        left,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "profile" }),
        })
      ).model;

      const snapshot = profileSnapshot(loading);

      const failed = update(
        loading,
        Message.ProfileCompleted({
          personId: Option.getOrThrow(loading.person),
          reply: ProfileReply.cases.Loaded.make({
            snapshot: {
              ...snapshot,
              user: { ...snapshot.user, id: "other", name: "Other Person" },
            },
          }),
          sequence: loading.profile.sequence,
        })
      ).model;

      expect(failed.profile.mode).toBe("load-failed");
      expect(failed.profile.draft).not.toBe("Other Person");
      expect(profileSnapshot(failed).user.id).toBe(snapshot.user.id);
      const retry = profileChange(failed, ProfileChange.cases.Retry.make({}));
      expect(retry.model.profile.mode).toBe("loading");
      expect(retry.model.profile.sequence).toBeGreaterThan(
        failed.profile.sequence
      );
      expect(
        retry.commands?.some((command) => command.name === "RunProfileRequest")
      ).toBe(true);
    })
);

it.effect(
  "native Back is not intercepted or restored under the explicit desk limit",
  () =>
    Effect.sync(() => {
      const current = profileChange(
        profileFixture(),
        ProfileChange.cases.Name.make({ value: "Unsaved Person" })
      ).model;

      const url = Option.getOrThrow(
        fromString("http://calendar.test/settings/general")
      );

      const result = update(current, Message.BrowserUrlChanged({ url }));
      expect(result.model.route).toEqual(
        SettingsRoute.make({ page: "general" })
      );
      expect(result.model.profile.mode).toBe("idle");
      expect(
        result.commands?.some(
          (command) =>
            command.name === "NavigateRoute" || command.name === "BackRoute"
        ) ?? false
      ).toBe(false);
    })
);

it.effect.each(["", "   ", "x".repeat(101)])(
  "invalid draft %s produces inline validation and no write command",
  (draft) =>
    Effect.sync(() => {
      const editing = profileChange(
        profileFixture(),
        ProfileChange.cases.Name.make({ value: draft })
      ).model;

      const result = profileChange(editing, ProfileChange.cases.Save.make({}));
      expect(result.model.profile.mode).toBe("editing");
      expect(Option.isSome(result.model.profile.validation)).toBe(true);
      expect(result.commands ?? []).toEqual([]);
      expect(result.model.profile.draft).toBe(draft);
    })
);

it.effect.prop(
  "generated names normalize without changing internal characters and obey the inclusive character bound",
  {
    count: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 102, minimum: 1 }))
    ),
    padded: Arbitrary.schema(Schema.Boolean),
  },
  ({ count, padded }) =>
    Effect.sync(() => {
      const name = "👩‍💻".repeat(count);
      const input = padded ? `  ${name}  ` : name;
      const parsed = normalizeProfileName(input);
      expect(Option.isSome(parsed)).toBe(count <= 100);

      if (Option.isSome(parsed)) {
        expect(parsed.value).toBe(name);
      }
    })
);
