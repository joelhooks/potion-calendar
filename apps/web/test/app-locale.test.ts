import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { initialModel, Message, update } from "../src/client/app.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import {
  AppLanguage,
  normalizedBrowserLocale,
  resolvedAppLocale,
} from "../src/layout/app-locale.js";
import { upcomingNow, upcomingSession } from "./upcoming-fixture.js";

it.effect.prop(
  "saved app language wins over a conflicting browser locale after real session and preference receipts",
  {
    language: Arbitrary.schema(AppLanguage),
    systemFirst: Arbitrary.schema(Schema.Boolean),
  },
  ({ language, systemFirst }) =>
    Effect.sync(() => {
      let model = initialModel(upcomingNow, "UTC");
      const browser = language === "fr-FR" ? "de-DE" : "fr-FR";

      const system = Message.ReceivedSystemSettings({
        dark: false,
        hour24: true,
        locale: browser,
      });

      const session = Message.ReceivedSession({ snapshot: upcomingSession });

      for (const message of systemFirst
        ? [system, session]
        : [session, system]) {
        ({ model } = update(model, message));
      }

      ({ model } = update(
        model,
        Message.ReceivedPreferences({
          person: upcomingSession.user.id,
          preferences: normalizePreferences({
            language,
            version: 2,
            visibility: {},
          }),
        })
      ));
      expect(
        resolvedAppLocale(model),
        "saved app language wins over a conflicting browser locale"
      ).toBe(language);
      expect(model.settings.timeFormat).toBe("system");
      expect(model.settings.system24Hour).toBe(true);
      expect(model.calendar.navigation.weekStartsOn).toBe(0);
    })
);

it.effect(
  "null and other-person session receipts retain the browser observation but not another person's saved language",
  () =>
    Effect.sync(() => {
      let model = initialModel(upcomingNow, "UTC");
      ({ model } = update(
        model,
        Message.ReceivedSystemSettings({
          dark: false,
          hour24: false,
          locale: "ja-JP",
        })
      ));
      ({ model } = update(
        model,
        Message.ReceivedSession({ snapshot: upcomingSession })
      ));

      const preferences = normalizePreferences({
        language: "fr-FR",
        version: 2,
        visibility: {},
      });

      ({ model } = update(
        model,
        Message.ReceivedPreferences({
          person: upcomingSession.user.id,
          preferences,
        })
      ));
      expect(resolvedAppLocale(model)).toBe("fr-FR");
      ({ model } = update(model, Message.ReceivedSession({ snapshot: null })));
      expect(model.person).toEqual(Option.none());
      expect(resolvedAppLocale(model)).toBe("ja-JP");

      const other = {
        accounts: [],
        user: {
          email: "other@example.test",
          id: "locale-other-person",
          name: "Other person",
        },
      };

      ({ model } = update(model, Message.ReceivedSession({ snapshot: other })));
      ({ model } = update(
        model,
        Message.ReceivedPreferences({
          person: upcomingSession.user.id,
          preferences,
        })
      ));
      expect(resolvedAppLocale(model)).toBe("ja-JP");
      expect(model.settings.language).toBeUndefined();
    })
);

it.effect.each(["not a locale", "pseudo", 7, null])(
  "malformed stored language %s does not discard unrelated preferences",
  (language) =>
    Effect.sync(() => {
      const preferences = normalizePreferences({
        language,
        theme: "dark",
        timeFormat: "24",
        version: 2,
        visibility: {},
        weekStartsOn: 1,
      });

      expect(preferences.language).toBeUndefined();
      expect(preferences.theme).toBe("dark");
      expect(preferences.timeFormat).toBe("24");
      expect(preferences.weekStartsOn).toBe(1);
    })
);

it.effect("invalid or missing browser locale uses the named fallback", () =>
  Effect.sync(() => {
    expect(normalizedBrowserLocale("not a locale")).toBe("en-US");
    expect(normalizedBrowserLocale()).toBe("en-US");
    expect(resolvedAppLocale({ settings: {} })).toBe("en-US");
  })
);
