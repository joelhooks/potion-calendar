import { Provider } from "@calendar/calendar";
import { expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";

import { memoryMaintenanceState } from "./maintenance-state-fixture.js";

const calendar = (calendarId: string, title = calendarId) =>
  ({
    accessRole: "reader",
    accountId: "account-a",
    calendarId,
    primary: false,
    timeZone: "UTC",
    title,
  }) as const;

const account = (
  calendars = [calendar("calendar-a"), calendar("calendar-b")]
) => ({
  accountId: "account-a",
  calendars,
  colors: { calendar: {}, event: {} },
});

it.effect.prop(
  "inventory publication follows added, removed and changed metadata, not reorderings, watch runs or failed account reads",
  {
    change: Schema.Literals([
      "added",
      "removed",
      "title",
      "color",
      "visibility",
      "role",
      "zone",
      "account",
    ]),
  },
  ({ change }) =>
    Effect.gen(function* inventoryChanges() {
      const memory = yield* memoryMaintenanceState;
      const published = yield* Ref.make(0);
      const publish = Ref.update(published, (count) => count + 1);
      const originalAccount = account();
      const listing = { accounts: [originalAccount] };
      expect(yield* memory.make().inventory(listing, publish)).toBe(true);
      expect(yield* memory.make().inventory(listing, publish)).toBe(false);
      expect(
        yield* memory
          .make()
          .inventory(
            { accounts: [account(originalAccount.calendars.toReversed())] },
            publish
          )
      ).toBe(false);
      expect(
        yield* memory.make().inventory(
          {
            accounts: [
              {
                accountId: "account-a",
                failure: new Provider({
                  message: "offline",
                  operation: "GET",
                  status: 503,
                }),
              },
            ],
          },
          publish
        )
      ).toBe(false);
      expect(yield* Ref.get(published)).toBe(1);
      const first = calendar("calendar-a");

      const changed = {
        account: { accounts: [] },
        added: {
          accounts: [
            account([first, calendar("calendar-b"), calendar("calendar-c")]),
          ],
        },
        color: {
          accounts: [
            {
              ...account(),
              calendars: [
                { ...first, backgroundColor: "#112233" },
                calendar("calendar-b"),
              ],
            },
          ],
        },
        removed: { accounts: [account([first])] },
        role: {
          accounts: [
            {
              ...account(),
              calendars: [
                { ...first, accessRole: "writer" as const },
                calendar("calendar-b"),
              ],
            },
          ],
        },
        title: {
          accounts: [
            account([
              calendar("calendar-a", "New title"),
              calendar("calendar-b"),
            ]),
          ],
        },
        visibility: {
          accounts: [
            {
              ...account(),
              calendars: [{ ...first, hidden: true }, calendar("calendar-b")],
            },
          ],
        },
        zone: {
          accounts: [
            {
              ...account(),
              calendars: [
                { ...first, timeZone: "Europe/London" },
                calendar("calendar-b"),
              ],
            },
          ],
        },
      }[change];

      expect(yield* memory.make().inventory(changed, publish)).toBe(true);
      expect(yield* memory.make().inventory(changed, publish)).toBe(false);
      expect(yield* Ref.get(published)).toBe(2);
    })
);
