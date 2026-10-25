import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import {
  ProfileChange,
  ProfileReply,
  ProfileWork,
} from "../src/client/settings/profile/model.js";
import { primaryAccountId } from "../src/layout/primary-account.js";
import { SettingsRoute } from "../src/layout/route.js";
import { primaryAccountFixture } from "./primary-account-fixture.js";
import { profileChange, profileSnapshot } from "./profile-fixture.js";

const History = Schema.Array(
  Schema.Literals(["work", "personal", "foreign", "revoked", "name"])
).check(Schema.isMinLength(1), Schema.isMaxLength(32));

it.effect.prop(
  "generated primary and name drafts keep one atomic save, reject unavailable messages and preserve the saved identity until acknowledgment",
  { history: Arbitrary.schema(History) },
  ({ history }) =>
    Effect.gen(function* primaryDraftHistory() {
      let model = primaryAccountFixture();
      const before = profileSnapshot(model);
      let selected = "work";
      let { name } = before.user;

      for (const [index, choice] of history.entries()) {
        const change =
          choice === "name"
            ? ProfileChange.cases.Name.make({ value: `Generated ${index}` })
            : ProfileChange.cases.Primary.make({ accountId: choice });

        ({ model } = profileChange(model, change));

        if (choice === "name") {
          name = `Generated ${index}`;
        } else if (choice === "work" || choice === "personal") {
          selected = choice;
        }

        expect(Option.getOrUndefined(model.profile.draftPrimaryAccountId)).toBe(
          selected
        );
        expect(model.profile.draft).toBe(name);
        expect(model.profile.mode).toBe(
          selected === "work" && name === before.user.name
            ? "pristine"
            : "editing"
        );
        expect(profileSnapshot(model)).toEqual(before);
      }

      const dirty = selected !== "work" || name !== before.user.name;
      const requested = profileChange(model, ProfileChange.cases.Save.make({}));

      const commands =
        requested.commands?.filter(
          (command) => command.name === "RunProfileRequest"
        ) ?? [];

      expect(commands).toHaveLength(dirty ? 1 : 0);

      if (!dirty || commands[0] === undefined) {
        return;
      }

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ work: ProfileWork })
      )(commands[0].args);

      const fields = { name, proof: before.profileUpdateProof ?? "" };

      const expected =
        selected === "work"
          ? ProfileWork.cases.Save.make(fields)
          : ProfileWork.cases.Save.make({
              ...fields,
              primaryAccountId: selected,
            });

      expect(args.work).toEqual(expected);

      const repeated = profileChange(
        requested.model,
        ProfileChange.cases.Save.make({})
      );

      expect(
        repeated.commands?.filter(
          (command) => command.name === "RunProfileRequest"
        ) ?? []
      ).toHaveLength(0);
      expect(profileSnapshot(repeated.model)).toEqual(before);

      const done = update(
        repeated.model,
        Message.ProfileCompleted({
          personId: before.user.id,
          reply: ProfileReply.cases.Saved.make({
            name,
            primaryAccountId: selected,
          }),
          sequence: repeated.model.profile.sequence,
        })
      ).model;

      expect(done.profile.mode).toBe("pristine");
      expect(profileSnapshot(done).user).toMatchObject({
        email: before.user.email,
        id: before.user.id,
        name,
        primaryAccountId: selected,
      });
    })
);

it.effect(
  "a disabled saved account remains selected through a name-only save but cannot be selected by a forged change",
  () =>
    Effect.gen(function* disabledPrimarySave() {
      const base = primaryAccountFixture("disabled");
      expect(primaryAccountId(profileSnapshot(base))).toBe("personal");

      const edited = profileChange(
        base,
        ProfileChange.cases.Name.make({ value: "Renamed" })
      ).model;

      const requested = profileChange(
        edited,
        ProfileChange.cases.Save.make({})
      );

      const command = requested.commands?.find(
        (item) => item.name === "RunProfileRequest"
      );

      expect(command).toBeDefined();

      if (command === undefined) {
        return;
      }

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ work: ProfileWork })
      )(command.args);

      expect(args.work).toEqual(
        ProfileWork.cases.Save.make({
          name: "Renamed",
          proof: "a".repeat(64),
        })
      );

      const active = profileChange(
        base,
        ProfileChange.cases.Primary.make({ accountId: "work" })
      ).model;

      const refused = profileChange(
        active,
        ProfileChange.cases.Primary.make({ accountId: "personal" })
      ).model;

      expect(Option.getOrUndefined(refused.profile.draftPrimaryAccountId)).toBe(
        "work"
      );
    })
);

it.effect(
  "primary-only dirty exits retain both drafts on Continue and restore both on Discard",
  () =>
    Effect.sync(() => {
      const base = primaryAccountFixture();

      const changed = profileChange(
        base,
        ProfileChange.cases.Primary.make({ accountId: "personal" })
      ).model;

      const leave = (model: typeof base) =>
        update(
          model,
          Message.RequestedRoute({
            replace: false,
            route: SettingsRoute.make({ page: "general" }),
          })
        ).model;

      const confirming = leave(changed);
      expect(confirming.profile.mode).toBe("confirming");
      expect(
        Option.getOrUndefined(confirming.profile.draftPrimaryAccountId)
      ).toBe("personal");

      const continued = profileChange(
        confirming,
        ProfileChange.cases.Continue.make({})
      ).model;

      expect(continued.profile.mode).toBe("editing");
      expect(
        Option.getOrUndefined(continued.profile.draftPrimaryAccountId)
      ).toBe("personal");

      const discarded = profileChange(
        leave(continued),
        ProfileChange.cases.Discard.make({})
      ).model;

      expect(discarded.route).toEqual(SettingsRoute.make({ page: "general" }));
      expect(profileSnapshot(discarded).user.primaryAccountId).toBe("work");
    })
);

it.effect.each(["sequence", "person", "page"] as const)(
  "a late primary acknowledgment cannot cross the %s fence",
  (fence) =>
    Effect.sync(() => {
      const base = primaryAccountFixture("saving");
      const before = profileSnapshot(base);

      const model =
        fence === "page"
          ? update(
              base,
              Message.RequestedRoute({
                replace: false,
                route: SettingsRoute.make({ page: "general" }),
              })
            ).model
          : base;

      const completed = update(
        model,
        Message.ProfileCompleted({
          personId: fence === "person" ? "other-person" : before.user.id,
          reply: ProfileReply.cases.Saved.make({
            name: "Late identity",
            primaryAccountId: "personal",
          }),
          sequence: model.profile.sequence + (fence === "sequence" ? 1 : 0),
        })
      ).model;

      expect(profileSnapshot(completed)).toEqual(before);
    })
);

it.effect.prop(
  "the resolver accepts only a linked account id, retains a disconnected choice and otherwise preserves the legacy fallback",
  {
    choice: Arbitrary.schema(Schema.Literals(["work", "personal", "foreign"])),
    disconnected: Arbitrary.schema(Schema.Boolean),
  },
  ({ choice, disconnected }) =>
    Effect.sync(() => {
      const base = profileSnapshot(primaryAccountFixture());

      const snapshot = {
        ...base,
        accounts: base.accounts.map((account) => ({
          ...account,
          disconnected,
        })),
        user: { ...base.user, primaryAccountId: choice },
      };

      expect(primaryAccountId(snapshot)).toBe(
        choice === "foreign" ? "work" : choice
      );
      expect(primaryAccountId(null)).toBeUndefined();
    })
);
