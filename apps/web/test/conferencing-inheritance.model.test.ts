import { ConferencingDefault } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Match, Option, Queue, Schema, pipe } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { editorConferencingContext } from "../src/client/conferencing/editor-context.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { applyEditorConferencingDefault } from "../src/client/editing/conferencing-draft.js";
import {
  UserDefaultConferencing,
  resolvedConferencingDefault,
} from "../src/client/settings/conferencing/default.js";
import { conferencingSettingsMachine } from "../src/client/settings/conferencing/machine.js";
import { initialConferencingSettings } from "../src/client/settings/conferencing/model.js";
import {
  SavedPreferences,
  StoredPreferences,
  normalizePreferences,
} from "../src/client/settings/model.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const expectedDefaults: Record<
  typeof ConferencingDefault.Type,
  { readonly meet: string; readonly none: string }
> = {
  googleMeet: { meet: "googleMeet", none: "googleMeet" },
  none: { meet: "none", none: "none" },
  unset: { meet: "googleMeet", none: "none" },
};

it.effect.prop(
  "existing meetings never acquire a default when their first human is invited, across every account and user choice",
  {
    title: Schema.String,
  },
  ({ title }) =>
    Effect.sync(() => {
      const users: readonly (typeof UserDefaultConferencing.Type)[] = [
        null,
        "googleMeet",
      ];

      const accounts: readonly (typeof ConferencingDefault.Type)[] = [
        "unset",
        "none",
        "googleMeet",
      ];

      for (const user of users) {
        for (const setting of accounts) {
          const context = {
            accounts: [
              { accountId: "work", email: "owner@example.test", setting },
            ],
            defaultConferencing: user,
          };

          const result = applyEditorConferencingDefault({
            calendars: editorCalendars.map((calendar) => ({
              ...calendar,
              allowedConferenceSolutionTypes: ["hangoutsMeet"],
            })),
            conferencingContext: context,
            draft: {
              ...editorDraft,
              attendees: [{ email: "new-human@example.test" }],
              conferencing: { participantSeen: false },
              title,
            },
            kind: "edit",
            original: Option.some({ ...editorOriginal, attendees: [], title }),
          });

          expect(result.conferencing?.request).toBeUndefined();
        }
      }
    })
);

it.effect.prop(
  "confirmed account overrides and inherited user defaults obey the six-cell truth table",
  {
    account: ConferencingDefault,
    user: UserDefaultConferencing,
  },
  ({ account, user }) =>
    Effect.sync(() => {
      expect(resolvedConferencingDefault(account, user)).toBe(
        expectedDefaults[account][user === null ? "none" : "meet"]
      );
      expect(resolvedConferencingDefault(undefined, user)).toBeUndefined();
    })
);

it.effect.prop(
  "legacy preference versions normalize the desk factory None and round-trip explicit None or Meet",
  {
    present: Schema.Boolean,
    value: UserDefaultConferencing,
    version: Schema.Literals([1, 2]),
  },
  ({ present, value, version }) =>
    Effect.gen(function* preferenceRoundTrip() {
      const common = present ? { defaultConferencing: value } : {};

      const stored = yield* Schema.decodeEffect(StoredPreferences)(
        version === 1
          ? { ...common, hidden: ["old-calendar"], version }
          : { ...common, version, visibility: { "old-calendar": false } }
      );

      const normalized = normalizePreferences(stored);

      expect(normalized.defaultConferencing).toBe(present ? value : null);
      expect(initialConferencingSettings().defaultConferencing).toBeNull();

      const encoded = yield* Schema.encodeEffect(
        Schema.fromJsonString(SavedPreferences)
      )(normalized);

      const decoded = yield* Schema.decodeEffect(
        Schema.fromJsonString(StoredPreferences)
      )(encoded);

      expect(normalizePreferences(decoded)).toEqual(normalized);
    })
);

it.effect.prop(
  "only the first eligible human on a capable new draft gets the resolved Meet proposal and explicit intent wins",
  {
    account: ConferencingDefault,
    capable: Schema.Boolean,
    kind: Schema.Literals(["create", "duplicate", "edit"]),
    participant: Schema.Literals([
      "human",
      "self",
      "resource",
      "account-email",
    ]),
    request: Schema.Literals(["absent", "none", "googleMeet"]),
    seen: Schema.Boolean,
    user: UserDefaultConferencing,
  },
  ({ account, capable, kind, participant, request, seen, user }) =>
    Effect.sync(() => {
      const explicit = request === "absent" ? undefined : { kind: request };

      const context = {
        accounts: [
          { accountId: "work", email: "owner@example.test", setting: account },
        ],
        defaultConferencing: user,
      };

      const draft = applyEditorConferencingDefault({
        calendars: editorCalendars.map((calendar) => ({
          ...calendar,
          allowedConferenceSolutionTypes: capable ? ["hangoutsMeet"] : [],
        })),
        conferencingContext: context,
        draft: {
          ...editorDraft,
          attendees: [
            {
              email:
                participant === "account-email"
                  ? " OWNER@EXAMPLE.TEST "
                  : "guest@example.test",
              resource: participant === "resource",
              self: participant === "self",
            },
          ],
          conferencing: { participantSeen: seen, request: explicit },
        },
        kind,
        original: Option.none(),
      });

      const eligible = participant === "human";

      const expected =
        capable &&
        kind !== "edit" &&
        eligible &&
        !seen &&
        expectedDefaults[account][user === null ? "none" : "meet"] ===
          "googleMeet";

      expect(draft.conferencing?.request).toEqual(
        explicit ?? (expected ? { kind: "googleMeet" } : undefined)
      );
      expect(draft.conferencing?.participantSeen).toBe(seen || eligible);
    })
);

it.effect.prop(
  "unconfirmed account snapshots never inherit a saved user Meet default",
  {
    phase: Schema.Literals([
      "success",
      "missing",
      "loading",
      "refreshing",
      "stale",
      "failure",
      "mismatch",
      "disconnected",
      "wrong-person",
    ]),
  },
  ({ phase }) =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const data = { accountId: "work", value: "unset" } satisfies {
        readonly accountId: string;
        readonly value: typeof ConferencingDefault.Type;
      };

      const error = { message: "Unavailable account preference" };

      const remote = Match.value(phase).pipe(
        Match.when("loading", () => RemoteConferencingDefault.Loading()),
        Match.when("refreshing", () =>
          RemoteConferencingDefault.Refreshing({ data })
        ),
        Match.when("stale", () =>
          RemoteConferencingDefault.Stale({ data, error })
        ),
        Match.when("failure", () =>
          RemoteConferencingDefault.Failure({ error })
        ),
        Match.when("mismatch", () =>
          RemoteConferencingDefault.Success({
            data: { ...data, accountId: "other-account" },
          })
        ),
        Match.orElse(() => RemoteConferencingDefault.Success({ data }))
      );

      const model: AppModel = {
        ...base,
        conferencing: {
          accounts:
            phase === "missing"
              ? {}
              : { work: { operation: "read", remote, requestId: 1 } },
          nextRequestId: 1,
        },
        conferencingSettings: {
          ...base.conferencingSettings,
          defaultConferencing: "googleMeet",
        },
        person:
          phase === "wrong-person" ? Option.some("stranger") : base.person,
        session: pipe(
          base.session,
          AsyncData.map((snapshot) =>
            snapshot === null
              ? null
              : {
                  ...snapshot,
                  accounts: snapshot.accounts.map((account) => ({
                    ...account,
                    disconnected:
                      phase === "disconnected" || account.disconnected,
                  })),
                }
          )
        ),
      };

      const result = applyEditorConferencingDefault({
        calendars: editorCalendars.map((calendar) => ({
          ...calendar,
          allowedConferenceSolutionTypes: ["hangoutsMeet"],
        })),
        conferencingContext: editorConferencingContext(model),
        draft: editorDraft,
        kind: "create",
        original: Option.none(),
      });

      expect(result.conferencing?.request).toEqual(
        phase === "success" ? { kind: "googleMeet" } : undefined
      );
    })
);

it.effect.prop(
  "a live settings actor keeps the committed default and rejects competing edits while its write is pending",
  {
    history: Schema.Array(Schema.Literals(["Add", "Cancel", "Save"])).check(
      Schema.isMaxLength(12)
    ),
    user: UserDefaultConferencing,
  },
  ({ history, user }) =>
    Effect.gen(function* pendingDefaultHistory() {
      const actor = yield* createEffectActor(conferencingSettingsMachine, {
        input: { ...initialConferencingSettings(), defaultConferencing: user },
      });

      yield* watchActor("calendar.conferencing.inheritance.test", actor);

      const snapshots =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(snapshots, snapshot);
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );

      const proposed = user === null ? "googleMeet" : null;
      actor.send({ type: "Default", value: proposed });

      const pending = yield* Queue.take(snapshots);

      expect(pending.context.defaultConferencing).toBe(user);
      expect(pending.context.pendingDefault).toEqual(Option.some(proposed));
      expect(pending.context.mode).toBe("savingDefault");

      for (const type of history) {
        actor.send({ type });

        const next = yield* Queue.take(snapshots);

        expect(next.context).toEqual(pending.context);
      }
    })
);
