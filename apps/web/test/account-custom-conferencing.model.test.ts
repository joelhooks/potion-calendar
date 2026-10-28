import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema } from "effect";

import {
  changeConferencingSettings,
  conferencingSettingsMachine,
} from "../src/client/settings/conferencing/machine.js";
import type { ConferencingSettings } from "../src/client/settings/conferencing/model.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
  initialConferencingSettings,
} from "../src/client/settings/conferencing/model.js";

const tokenSchema = Schema.Int.check(
  Schema.isBetween({ maximum: 10_000, minimum: 0 })
);

it.effect.prop(
  "import histories retain the exact legacy source and reject stale catalog acknowledgements",
  {
    failures: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(10)),
    token: tokenSchema,
  },
  ({ token, failures }) =>
    Effect.sync(() => {
      const legacy = [
        {
          id: `room-${token}`,
          link: `https://room.example/${token}`,
          name: `Room ${token}`,
        },
      ];

      let state: typeof ConferencingSettings.Type = {
        ...initialConferencingSettings(),
        legacyEntries: legacy,
      };

      for (const fails of [...failures, false]) {
        const loading = changeConferencingSettings(
          state,
          Change.cases.Load.make({})
        );

        expect(loading.mode).toBe("loading");
        expect(loading.legacyEntries).toEqual(legacy);
        expect(
          changeConferencingSettings(
            loading,
            Change.cases.Loaded.make({
              catalog: { conflicts: [], entries: [] },
              requestId: loading.requestId - 1,
            })
          )
        ).toEqual(loading);
        state = fails
          ? changeConferencingSettings(
              loading,
              Change.cases.LoadFailed.make({
                message: "Unconfirmed",
                requestId: loading.requestId,
              })
            )
          : changeConferencingSettings(
              loading,
              Change.cases.Loaded.make({
                catalog: { conflicts: [], entries: legacy },
                requestId: loading.requestId,
              })
            );
        expect(state.mode).toBe(fails ? "unconfirmed" : "listing");
        expect(
          state.legacyEntries,
          "catalog operations must preserve the legacy import source"
        ).toEqual(legacy);
      }

      expect(state.entries).toEqual(legacy);
    })
);

it.effect.prop(
  "lost save acknowledgements reconcile stable IDs without retrying writes or losing an uncommitted draft",
  { committed: Schema.Boolean, token: tokenSchema },
  ({ token, committed }) =>
    Effect.sync(() => {
      let state = initialConferencingSettings();

      for (const change of [
        Change.cases.Add.make({}),
        Change.cases.Name.make({ value: `Room ${token}` }),
        Change.cases.Link.make({ value: `https://room.example/${token}` }),
        Change.cases.Save.make({}),
      ]) {
        state = changeConferencingSettings(state, change);
      }

      const entry = {
        id: `new-${token}`,
        link: `https://room.example/${token}`,
        name: `Room ${token}`,
      };

      const unknown = changeConferencingSettings(
        state,
        Change.cases.Unconfirmed.make({
          message: "Lost acknowledgement",
          requestId: state.requestId,
          write: CustomVideoWrite.cases.Save.make({
            ...entry,
            create: true,
            id: Option.some(entry.id),
          }),
        })
      );

      expect(unknown.mode).toBe("unconfirmed");
      expect(unknown.draft.id).toEqual(Option.some(entry.id));
      expect(
        changeConferencingSettings(unknown, Change.cases.Save.make({}))
      ).toEqual(unknown);

      const loading = changeConferencingSettings(
        unknown,
        Change.cases.Load.make({})
      );

      const settled = changeConferencingSettings(
        loading,
        Change.cases.Loaded.make({
          catalog: { conflicts: [], entries: committed ? [entry] : [] },
          requestId: loading.requestId,
        })
      );

      expect(settled.mode).toBe(committed ? "listing" : "editing");

      if (!committed) {
        expect(settled.draft).toMatchObject({
          ...entry,
          create: true,
          id: Option.some(entry.id),
        });
        expect(
          changeConferencingSettings(settled, Change.cases.Save.make({})).draft
            .id
        ).toEqual(Option.some(entry.id));
      }
    })
);

it.effect.prop(
  "the live pure lifecycle actor rejects stale imports and preserves committed rows through reconciliation",
  { token: tokenSchema },
  ({ token }) =>
    Effect.gen(function* actorHistory() {
      const entry = {
        id: `room-${token}`,
        link: `https://room.example/${token}`,
        name: "Room",
      };

      const actor = yield* createEffectActor(conferencingSettingsMachine, {
        input: { ...initialConferencingSettings(), legacyEntries: [entry] },
      });

      yield* watchActor("conferencingSettingsMachine", actor);

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
      actor.send({ type: "Load" });
      const { requestId } = (yield* Queue.take(snapshots)).context;
      actor.send({
        catalog: { conflicts: [], entries: [] },
        requestId: requestId - 1,
        type: "Loaded",
      });
      expect((yield* Queue.take(snapshots)).context.mode).toBe("loading");
      actor.send({
        catalog: { conflicts: [], entries: [entry] },
        requestId,
        type: "Loaded",
      });
      const settled = yield* Queue.take(snapshots);
      expect(settled.context.entries).toEqual([entry]);
      expect(settled.context.legacyEntries).toEqual([entry]);
    }).pipe(Effect.scoped)
);
