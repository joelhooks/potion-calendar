import {
  AccountNotOwned,
  Provider,
  CalendarAppearanceRefused,
  CalendarChanges,
  CustomVideoCatalog,
  CustomVideoLink,
  CalendarSettings,
  CalendarStore,
  GoogleCalendarClient,
} from "@calendar/calendar";
import {
  accountConferencingDefaultRepository,
  customVideoLinksRepository,
} from "@calendar/database/account-conferencing-default";
import { accountDisconnectRepository } from "@calendar/database/account-disconnect";
import type { D1Database } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

import { disconnectOwnedAccount } from "./account-disconnect.js";
import type { DisconnectEffects } from "./account-disconnect.js";

const preferenceFailure = () =>
  new Provider({
    message: "Account conferencing preference could not be stored or read",
    operation: "account.conferencingDefault",
    status: 0,
  });

const linkFailure = () =>
  new Provider({
    message:
      "The saved custom link is unavailable or the operation could not be confirmed. Reload before retrying; no fallback conferencing was selected.",
    operation: "customVideoLink",
    status: 409,
  });

const catalog = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CustomVideoCatalog)),
    Effect.mapError(linkFailure)
  );

export const calendarSettingsFor = Effect.fn("calendarSettingsFor")(
  function* calendarSettingsFor(
    database: D1Database,
    personId: string,
    effects: DisconnectEffects
  ) {
    const google = yield* GoogleCalendarClient;
    const store = yield* CalendarStore;
    const changes = yield* CalendarChanges;
    const repository = accountDisconnectRepository(database, personId);

    const conferencing = accountConferencingDefaultRepository(
      database,
      personId
    );

    const links = customVideoLinksRepository(database, personId);

    return CalendarSettings.of({
      disconnect: (input) =>
        disconnectOwnedAccount(repository, effects, input.accountId),
      getConferencingDefault: Effect.fn(
        "CalendarSettings.getConferencingDefault"
      )(function* getConferencingDefault(input) {
        const preference = yield* conferencing
          .get(input.accountId)
          .pipe(Effect.mapError(preferenceFailure));

        if (preference === null) {
          return yield* new AccountNotOwned({ accountId: input.accountId });
        }

        return preference;
      }),
      importCustomVideoLinks: (input) =>
        catalog(links.importEntries(input.entries)),
      readCustomVideoLinks: () => catalog(links.list()),
      removeCustomVideoLink: (input) => catalog(links.remove(input.id)),
      resolveCustomVideoLink: (id) =>
        links
          .get(id)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(CustomVideoLink)),
            Effect.mapError(linkFailure)
          ),
      saveCustomVideoLink: (input) => catalog(links.save(input)),
      setAppearance: Effect.fn("CalendarSettings.setAppearance")(
        function* setAppearance(input) {
          const { accountId, calendarId, ...patch } = input;

          if (
            patch.colorId === undefined &&
            patch.hidden === undefined &&
            patch.selected === undefined
          ) {
            return yield* new CalendarAppearanceRefused({
              accountId,
              calendarId,
              reason: "emptyUpdate",
            });
          }

          if (patch.colorId !== undefined) {
            const palette = yield* google.colors(accountId);

            if (palette.calendar[patch.colorId] === undefined) {
              return yield* new CalendarAppearanceRefused({
                accountId,
                calendarId,
                reason: "unknownCalendarColor",
              });
            }
          }

          const updated = yield* google.patchCalendar(input, patch);
          const version = yield* store.invalidate(input);
          yield* changes.publish({
            accountId,
            calendarId,
            reason: "write",
            version,
          });
          yield* effects.notify();

          return updated;
        }
      ),
      setConferencingDefault: Effect.fn(
        "CalendarSettings.setConferencingDefault"
      )(function* setConferencingDefault(input) {
        const preference = yield* conferencing
          .set(input)
          .pipe(Effect.mapError(preferenceFailure));

        if (preference === null) {
          return yield* new AccountNotOwned({ accountId: input.accountId });
        }

        yield* effects.notify();

        return preference;
      }),
    });
  }
);
