import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import {
  ProfileChange,
  ProfileReply,
} from "../src/client/settings/profile/model.js";
import { SettingsRoute } from "../src/layout/route.js";
import {
  profileChange,
  profileFixture,
  profileSnapshot,
} from "./profile-fixture.js";

const History = Schema.Array(
  Schema.Literals([
    "edit",
    "invalid",
    "save",
    "success",
    "failure",
    "exit",
    "continue",
    "discard",
  ])
).check(Schema.isMinLength(1), Schema.isMaxLength(32));

type HistoryStep = (typeof History.Type)[number];

interface ExpectedProfile {
  readonly back: number;
  readonly draft: string;
  readonly failed: boolean;
  readonly invalid: boolean;
  readonly mode: "pristine" | "editing" | "saving" | "confirming";
  readonly pendingExit: boolean;
  readonly saved: string;
  readonly sequence: number;
  readonly writes: number;
}

const editExpected = (
  state: ExpectedProfile,
  draft: string
): ExpectedProfile =>
  state.mode === "pristine" || state.mode === "editing"
    ? {
        ...state,
        draft,
        failed: false,
        invalid: false,
        mode: draft === state.saved ? "pristine" : "editing",
      }
    : state;

const saveExpected = (state: ExpectedProfile): ExpectedProfile => {
  if (state.mode !== "editing") {
    return state;
  }

  const invalid = state.draft.trim() === "";

  return {
    ...state,
    failed: false,
    invalid,
    mode: invalid ? "editing" : "saving",
    sequence: state.sequence + (invalid ? 0 : 1),
    writes: invalid ? 0 : 1,
  };
};

const leaveExpected = (state: ExpectedProfile): ExpectedProfile => {
  if (state.mode === "editing") {
    return { ...state, mode: "confirming", pendingExit: true };
  }

  return state.mode === "confirming" ? state : { ...state, back: 1 };
};

const stepExpected = (
  state: ExpectedProfile,
  step: HistoryStep,
  index: number
): ExpectedProfile =>
  Match.value(step).pipe(
    Match.when("edit", () => editExpected(state, `Generated ${index}`)),
    Match.when("invalid", () => editExpected(state, " ")),
    Match.when("save", () => saveExpected(state)),
    Match.when("exit", () => leaveExpected(state)),
    Match.when("success", (): ExpectedProfile =>
      state.mode === "saving"
        ? {
            ...state,
            draft: state.draft.trim(),
            failed: false,
            mode: "pristine",
            saved: state.draft.trim(),
          }
        : state
    ),
    Match.when("failure", (): ExpectedProfile =>
      state.mode === "saving"
        ? { ...state, failed: true, mode: "editing" }
        : state
    ),
    Match.when("continue", (): ExpectedProfile =>
      state.mode === "confirming"
        ? { ...state, mode: "editing", pendingExit: false }
        : state
    ),
    Match.when("discard", (): ExpectedProfile =>
      state.mode === "confirming"
        ? {
            ...state,
            back: 1,
            draft: state.saved,
            failed: false,
            invalid: false,
            mode: "pristine",
            pendingExit: false,
          }
        : state
    ),
    Match.exhaustive
  );

const historyMessage = (
  state: ExpectedProfile,
  step: HistoryStep,
  index: number,
  personId: string
): AppMessage =>
  Match.value(step).pipe(
    Match.when("edit", () =>
      Message.ChangedProfile({
        change: ProfileChange.cases.Name.make({ value: `Generated ${index}` }),
        personId,
      })
    ),
    Match.when("invalid", () =>
      Message.ChangedProfile({
        change: ProfileChange.cases.Name.make({ value: " " }),
        personId,
      })
    ),
    Match.when("save", () =>
      Message.ChangedProfile({
        change: ProfileChange.cases.Save.make({}),
        personId,
      })
    ),
    Match.when("continue", () =>
      Message.ChangedProfile({
        change: ProfileChange.cases.Continue.make({}),
        personId,
      })
    ),
    Match.when("discard", () =>
      Message.ChangedProfile({
        change: ProfileChange.cases.Discard.make({}),
        personId,
      })
    ),
    Match.when("exit", () => Message.RequestedRouteBack()),
    Match.when("success", () =>
      Message.ProfileCompleted({
        personId,
        reply: ProfileReply.cases.Saved.make({
          name: state.mode === "saving" ? state.draft.trim() : "Unsolicited",
        }),
        sequence: state.sequence,
      })
    ),
    Match.when("failure", () =>
      Message.ProfileCompleted({
        personId,
        reply: ProfileReply.cases.Failed.make({ message: "Write refused" }),
        sequence: state.sequence,
      })
    ),
    Match.exhaustive
  );

it.effect.prop(
  "generated profile histories agree with an independent draft, save and dirty-exit model",
  { history: Arbitrary.schema(History) },
  ({ history }) =>
    Effect.sync(() => {
      let model = profileFixture();
      const personId = Option.getOrThrow(model.person);

      let expected: ExpectedProfile = {
        back: 0,
        draft: model.profile.savedName,
        failed: false,
        invalid: false,
        mode: "pristine",
        pendingExit: false,
        saved: model.profile.savedName,
        sequence: model.profile.sequence,
        writes: 0,
      };

      const commands: readonly HistoryStep[] = [
        "edit",
        "save",
        "save",
        ...history,
      ];

      for (const [index, step] of commands.entries()) {
        const message = historyMessage(expected, step, index, personId);
        expected = stepExpected(
          { ...expected, back: 0, writes: 0 },
          step,
          index
        );
        const result = update(model, message);
        ({ model } = result);
        expect(
          {
            draft: model.profile.draft,
            failed: Option.isSome(model.profile.error),
            invalid: Option.isSome(model.profile.validation),
            mode: model.profile.mode,
            pendingExit: Option.isSome(model.profile.exit),
            saved: model.profile.savedName,
            sequence: model.profile.sequence,
          },
          step
        ).toEqual({
          draft: expected.draft,
          failed: expected.failed,
          invalid: expected.invalid,
          mode: expected.mode,
          pendingExit: expected.pendingExit,
          saved: expected.saved,
          sequence: expected.sequence,
        });
        expect(
          result.commands?.filter(
            (command) => command.name === "RunProfileRequest"
          ).length ?? 0
        ).toBe(expected.writes);
        expect(
          result.commands?.filter((command) => command.name === "BackRoute")
            .length ?? 0
        ).toBe(expected.back);
        expect(profileSnapshot(model).user.name).toBe(expected.saved);
      }
    })
);

it.effect(
  "an old save cannot settle a newer save for the same person after departure and re-entry",
  () =>
    Effect.sync(() => {
      const original = profileFixture("saving");
      const personId = Option.getOrThrow(original.person);
      const oldSequence = original.profile.sequence;

      const left = update(
        original,
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

      const loaded = update(
        loading,
        Message.ProfileCompleted({
          personId,
          reply: ProfileReply.cases.Loaded.make({
            snapshot: profileSnapshot(loading),
          }),
          sequence: loading.profile.sequence,
        })
      ).model;

      const edited = profileChange(
        loaded,
        ProfileChange.cases.Name.make({ value: "New Draft" })
      ).model;

      const saving = profileChange(
        edited,
        ProfileChange.cases.Save.make({})
      ).model;

      expect(saving.profile.sequence).toBeGreaterThan(oldSequence);

      const result = update(
        saving,
        Message.ProfileCompleted({
          personId,
          reply: ProfileReply.cases.Saved.make({ name: "Old Name" }),
          sequence: oldSequence,
        })
      );

      expect(result.model.profile).toEqual(saving.profile);
      expect(profileSnapshot(result.model).user.name).toBe(
        profileSnapshot(saving).user.name
      );
    })
);

it.effect(
  "a changed person retires the draft and ignores both old UI messages and old save receipts",
  () =>
    Effect.sync(() => {
      const original = profileFixture("saving");

      const next = update(
        original,
        Message.ReceivedSession({
          snapshot: {
            accounts: [],
            user: {
              email: "next@example.test",
              id: "next-person",
              name: "Next Person",
            },
          },
        })
      ).model;

      const loaded = update(
        next,
        Message.ProfileCompleted({
          personId: "next-person",
          reply: ProfileReply.cases.Loaded.make({
            snapshot: profileSnapshot(next),
          }),
          sequence: next.profile.sequence,
        })
      ).model;

      const ghost = profileChange(
        original,
        ProfileChange.cases.Name.make({ value: "Ghost" })
      );

      expect(ghost.model.profile).toEqual(original.profile);

      const staleInput = update(
        loaded,
        Message.ChangedProfile({
          change: ProfileChange.cases.Name.make({ value: "Ghost" }),
          personId: Option.getOrThrow(original.person),
        })
      );

      expect(staleInput.model.profile).toEqual(loaded.profile);

      const staleSave = update(
        loaded,
        Message.ProfileCompleted({
          personId: Option.getOrThrow(original.person),
          reply: ProfileReply.cases.Saved.make({ name: "Old Name" }),
          sequence: original.profile.sequence,
        })
      );

      expect(staleSave.model.profile).toEqual(loaded.profile);
      expect(profileSnapshot(staleSave.model).user.name).toBe("Next Person");
    })
);
