import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { fromString } from "foldkit/url";

import { Message, RemoteSession, update } from "../src/client/app.js";
import {
  Route,
  AccountSettingsRoute,
  SettingsRoute,
} from "../src/layout/route.js";
import { calendarsRedirectSnapshot } from "./calendars-redirect-fixture.js";
import { fixtureModel } from "./fixture.js";

const NavigateArgs = Schema.Struct({ replace: Schema.Boolean, route: Route });

const redirects = (result: ReturnType<typeof update>) =>
  (result.commands ?? [])
    .filter((command) => command.name === "NavigateRoute")
    .map((command) => Schema.decodeUnknownSync(NavigateArgs)(command.args));

it.effect.prop(
  "Calendars navigation selects the first sidebar account in existing order and replaces the redirect",
  {
    disconnected: Schema.Boolean,
    phone: Schema.Boolean,
    reversed: Schema.Boolean,
  },
  ({ reversed, disconnected, phone }) =>
    Effect.sync(() => {
      const base = fixtureModel();
      const snapshot = calendarsRedirectSnapshot();

      const accounts = (
        reversed ? snapshot.accounts.toReversed() : snapshot.accounts
      ).map((account) => ({ ...account, disconnected }));

      const first = Option.getOrThrow(Option.fromUndefinedOr(accounts[0]));

      const seeded = {
        ...base,
        session: RemoteSession.Success({ data: { ...snapshot, accounts } }),
      };

      const model = phone
        ? update(seeded, Message.MeasuredShellViewport({ width: 390 })).model
        : seeded;

      const target = AccountSettingsRoute.make({ accountId: first.id });

      const result = update(
        model,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "calendars" }),
        })
      );

      expect(
        result.model.route,
        "Calendars must resolve to the first ordered account"
      ).toEqual(target);
      expect(
        redirects(result),
        "The redirect must use one history replacement"
      ).toEqual([{ replace: true, route: target }]);
      const repeated = update(result.model, Message.Navigated());
      expect(repeated.model.route).toEqual(target);
      expect(redirects(repeated)).toEqual([]);
    })
);

it.effect.each([false, true])(
  "Calendars with no provider accounts replaces to General without a loop (phone=%s)",
  (phone) =>
    Effect.sync(() => {
      const base = fixtureModel();
      const snapshot = calendarsRedirectSnapshot();

      const seeded = {
        ...base,
        session: RemoteSession.Success({ data: { ...snapshot, accounts: [] } }),
      };

      const model = phone
        ? update(seeded, Message.MeasuredShellViewport({ width: 390 })).model
        : seeded;

      const target = SettingsRoute.make({ page: "general" });

      const result = update(
        model,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "calendars" }),
        })
      );

      expect(
        result.model.route,
        "No-account Calendars must resolve to General"
      ).toEqual(target);
      expect(redirects(result)).toEqual([{ replace: true, route: target }]);
      expect(redirects(update(result.model, Message.Navigated()))).toEqual([]);
    })
);

it.effect(
  "a deep-linked Calendars route waits for session truth then replaces once to the account landing",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      const waiting = { ...base, session: RemoteSession.Loading() };

      const url = Option.getOrThrow(
        fromString("https://calendar.example.test/settings/calendars")
      );

      const linked = update(waiting, Message.BrowserUrlChanged({ url }));
      expect(linked.model.route).toEqual(
        SettingsRoute.make({ page: "calendars" })
      );
      expect(redirects(linked)).toEqual([]);
      const snapshot = calendarsRedirectSnapshot();

      const target = AccountSettingsRoute.make({
        accountId: snapshot.accounts[0]?.id ?? "missing",
      });

      const received = update(
        linked.model,
        Message.ReceivedSession({ snapshot })
      );

      expect(
        received.model.route,
        "Deep link must settle after the real session arrives"
      ).toEqual(target);
      expect(redirects(received)).toEqual([{ replace: true, route: target }]);
      expect(redirects(update(received.model, Message.Navigated()))).toEqual(
        []
      );
    })
);

it.effect(
  "Manage calendar accounts uses the same redirect result rather than preserving an overview route",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const opened = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const result = update(
        opened,
        Message.KeyboardPick({ id: "manage-accounts" })
      );

      expect(
        result.model.route,
        "The real command must land on its account page"
      ).toEqual(AccountSettingsRoute.make({ accountId: "work" }));
      expect(redirects(result)).toEqual([
        {
          replace: true,
          route: AccountSettingsRoute.make({ accountId: "work" }),
        },
      ]);
    })
);

it.effect(
  "explicit account links keep their own account identity instead of redirecting to the first account",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      const target = AccountSettingsRoute.make({ accountId: "personal" });

      const result = update(
        base,
        Message.RequestedRoute({ replace: false, route: target })
      );

      expect(result.model.route).toEqual(target);
      expect(redirects(result)).toEqual([{ replace: false, route: target }]);
    })
);
