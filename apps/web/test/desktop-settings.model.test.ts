import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { DesktopSettingsValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import {
  DesktopNotice,
  DesktopOutcome,
  initialDesktop,
} from "../src/client/desktop/model.js";
import {
  beginDesktopRequest,
  receiveDesktopNotice,
} from "../src/client/desktop/update.js";

const saved = (
  revision: number,
  openAtLogin: boolean
): DesktopSettingsValue => ({
  issues: [],
  openAtLogin,
  preferences: defaultDesktopPreferences(),
  revision,
});

const revisions = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 1 }))
);

it.effect.prop(
  "late request completions cannot replace the current native settings or failure state",
  { openAtLogin: Arbitrary.schema(Schema.Boolean), revision: revisions },
  ({ revision, openAtLogin }) =>
    Effect.sync(() => {
      const first = beginDesktopRequest(initialDesktop());
      const second = beginDesktopRequest(first);

      const current = receiveDesktopNotice(
        second,
        DesktopNotice.cases.Finished.make({
          outcome: DesktopOutcome.cases.Ready.make({
            error: Option.none(),
            settings: saved(revision, openAtLogin),
          }),
          request: second.request,
        })
      );

      const late = receiveDesktopNotice(
        current,
        DesktopNotice.cases.Finished.make({
          outcome: DesktopOutcome.cases.Failed.make({
            message: "Earlier request failed",
          }),
          request: first.request,
        })
      );

      expect(late).toBe(current);
    })
);

it.effect.prop(
  "native revisions never regress when observations race a current reply",
  { openAtLogin: Arbitrary.schema(Schema.Boolean), revision: revisions },
  ({ revision, openAtLogin }) =>
    Effect.sync(() => {
      const pending = beginDesktopRequest(initialDesktop());

      const current = receiveDesktopNotice(
        pending,
        DesktopNotice.cases.Settings.make({
          settings: saved(revision + 1, openAtLogin),
        })
      );

      const old = receiveDesktopNotice(
        current,
        DesktopNotice.cases.Finished.make({
          outcome: DesktopOutcome.cases.Ready.make({
            error: Option.none(),
            settings: saved(revision, !openAtLogin),
          }),
          request: pending.request,
        })
      );

      expect(old).toBe(current);
    })
);

it.effect(
  "a failed settings operation retains the last observed OS value as stale data",
  () =>
    Effect.sync(() => {
      const current = receiveDesktopNotice(
        initialDesktop(),
        DesktopNotice.cases.Settings.make({ settings: saved(1, false) })
      );

      const pending = beginDesktopRequest(current);

      const failed = receiveDesktopNotice(
        pending,
        DesktopNotice.cases.Finished.make({
          outcome: DesktopOutcome.cases.Failed.make({
            message: "Native settings unavailable",
          }),
          request: pending.request,
        })
      );

      expect(AsyncData.isStale(failed.settings)).toBe(true);
      expect(
        AsyncData.getData(failed.settings).pipe(
          Option.map((value) => value.openAtLogin)
        )
      ).toEqual(Option.some(false));
    })
);
