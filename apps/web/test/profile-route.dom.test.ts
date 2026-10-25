import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { parseRoute, printRoute, SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "the literal Profile deep link belongs to the finite Settings route",
  () =>
    Effect.sync(() => {
      const route = parseRoute("/settings/profile");
      expect(route._tag).toBe("Settings");
      expect(printRoute(route)).toBe("/settings/profile");
    })
);

it.effect(
  "the actual settings navigation exposes the literal Profile anchor",
  () =>
    Effect.gen(function* profileNavigation() {
      const model = {
        ...fixtureModel(),
        route: SettingsRoute.make({ page: "general" }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector('.settings-nav a[href="/settings/profile"]')
          ?.textContent
      ).toBe("Profile");
    })
);

it.effect(
  "the real Profile landing prefills the current identity and provides a name-only form",
  () =>
    Effect.gen(function* profileLanding() {
      const base = fixtureModel();

      const snapshot = Option.getOrThrow(
        Option.fromNullishOr(Option.getOrThrow(AsyncData.getData(base.session)))
      );

      const { model } = update(
        base,
        Message.RequestedRoute({
          replace: false,
          route: parseRoute("/settings/profile"),
        })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(root.querySelector<HTMLInputElement>("#profile-name")?.value).toBe(
        snapshot.user.name
      );
      expect(
        root.querySelector('.settings-nav a[aria-current="page"]')?.textContent
      ).toBe("Profile");
      expect(
        root.querySelector(
          'input[name="email"], input[name="userId"], input[name="image"]'
        )
      ).toBeNull();
    })
);

it.effect("the existing General route and sidebar link remain intact", () =>
  Effect.gen(function* generalControl() {
    const model = {
      ...fixtureModel(),
      route: SettingsRoute.make({ page: "general" }),
    };

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    const root = new DOMParser().parseFromString(rendered.html, "text/html");
    expect(
      root.querySelector(".settings-content")?.getAttribute("aria-label")
    ).toBe("General settings");
    expect(
      root.querySelector(
        '.settings-nav a[href="/settings/general"][aria-current="page"]'
      )
    ).not.toBeNull();
  })
);
