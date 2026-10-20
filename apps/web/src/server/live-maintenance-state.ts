import { Provider } from "@calendar/calendar";
import { AccountCalendars } from "@calendar/calendar/contracts";
import type { ListCalendarsOutput } from "@calendar/calendar/contracts";
import type { PushResourceValue } from "@calendar/database/google-push";
import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

export const unwatchableWindowMs = 24 * 60 * 60 * 1000;

const Cooldown = Schema.Struct({
  reason: Schema.optional(Schema.String),
  status: Schema.Int,
  until: Schema.Int,
});

const [SuccessfulAccount] = AccountCalendars.members;

const Inventory = Schema.Array(SuccessfulAccount);

export type MaintenanceValue = typeof Cooldown.Type | typeof Inventory.Type;

const storageFailure = () =>
  new Provider({
    message: "Live maintenance state is unavailable",
    operation: "live.maintenance",
    status: 0,
  });

const cooldownKey = (resource: PushResourceValue) =>
  `watch-cooldown:${JSON.stringify([resource.accountId, resource.kind, resource.calendarId])}`;

const normalizedAccount = (account: typeof SuccessfulAccount.Type) => ({
  ...account,
  calendars: account.calendars
    .toSorted((a, b) => a.calendarId.localeCompare(b.calendarId))
    .map((calendar) => ({
      ...calendar,
      allowedConferenceSolutionTypes:
        calendar.allowedConferenceSolutionTypes?.toSorted(),
      defaultReminders: calendar.defaultReminders?.toSorted(
        (a, b) => a.method.localeCompare(b.method) || a.minutes - b.minutes
      ),
    })),
  colors: {
    calendar: Object.fromEntries(
      Object.entries(account.colors.calendar).toSorted(([a], [b]) =>
        a.localeCompare(b)
      )
    ),
    event: Object.fromEntries(
      Object.entries(account.colors.event).toSorted(([a], [b]) =>
        a.localeCompare(b)
      )
    ),
  },
});

export const maintenanceStateWith = (store: {
  readonly read: (key: string) => Effect.Effect<unknown, Provider>;
  readonly write: (
    key: string,
    value: MaintenanceValue
  ) => Effect.Effect<void, Provider>;
}) => {
  const blocked = Effect.fn("liveMaintenance.blocked")(function* blocked(
    resource: PushResourceValue,
    now: number
  ) {
    const raw = yield* store.read(cooldownKey(resource));

    if (raw === undefined) {
      return false;
    }

    const cooldown = yield* Schema.decodeUnknownEffect(Cooldown)(raw).pipe(
      Effect.mapError(storageFailure)
    );

    return cooldown.until > now;
  });

  const suppress = (
    resource: PushResourceValue,
    error: Provider,
    now: number
  ) =>
    store.write(cooldownKey(resource), {
      reason: error.reason,
      status: error.status,
      until: now + unwatchableWindowMs,
    });

  const inventory = Effect.fn("liveMaintenance.inventory")(function* inventory(
    listing: typeof ListCalendarsOutput.Type,
    publish: Effect.Effect<void, Provider>
  ) {
    const raw = yield* store.read("calendar-inventory");

    const previous =
      raw === undefined
        ? []
        : yield* Schema.decodeUnknownEffect(Inventory)(raw).pipe(
            Effect.mapError(storageFailure)
          );

    const next = listing.accounts
      .flatMap((account) => {
        if ("failure" in account) {
          const retained = previous.find(
            (known) => known.accountId === account.accountId
          );

          return retained === undefined ? [] : [retained];
        }

        return [normalizedAccount(account)];
      })
      .toSorted((a, b) => a.accountId.localeCompare(b.accountId));

    const encoded = yield* Schema.encodeEffect(Inventory)(next).pipe(
      Effect.mapError(storageFailure)
    );

    if (JSON.stringify(previous) === JSON.stringify(encoded)) {
      return false;
    }

    yield* publish;
    yield* store.write("calendar-inventory", next);

    return true;
  });

  return { blocked, inventory, suppress };
};

export type LiveMaintenanceState = ReturnType<typeof maintenanceStateWith>;

export const liveMaintenanceState = (
  storage: DurableObjectStorage
): LiveMaintenanceState =>
  maintenanceStateWith({
    read: (key) =>
      Effect.tryPromise({
        catch: storageFailure,

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => storage.get(key),
      }),
    write: (key, value) =>
      Effect.tryPromise({
        catch: storageFailure,

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => storage.put(key, value),
      }),
  });
