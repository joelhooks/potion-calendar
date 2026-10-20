import { Calendar } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { afterEach } from "vitest";

import {
  clipboardCutEvents,
  clipboardGridHost,
  clipboardNativeHost,
} from "../src/client/clipboard/host.js";
import type { ClipboardConnection } from "../src/client/clipboard/runtime.js";
import { fixtureSelection } from "./fixture.js";

afterEach(() => {
  document.body.replaceChildren();
});

const connection = (
  personId = "fixture-person",
  active = true
): ClipboardConnection => ({
  canReceive: () => active,
  copied: () => ({ id: "owned-copy", personId }),
  native: () => Effect.void,
  notices: Stream.empty,
  personId,
  sessionId: "opaque-session",
});

it("native host uses the selected saved source, all linked identities and the normal default destination with home zone", () => {
  const base = fixtureSelection();
  const model = { ...base, calendar: { ...base.calendar, zone: "Asia/Tokyo" } };
  const host = clipboardNativeHost(model, connection(), undefined, document);
  expect(host?.selected).toMatchObject({
    accountId: "work",
    calendarId: "primary",
    eventId: "a-review",
  });
  expect(host?.target?.calendar).toMatchObject({
    accountId: "work",
    calendarId: "primary",
  });
  expect(host?.target?.primaryZone).toBe("America/Los_Angeles");
  expect(host?.selfEmails).toEqual(
    expect.arrayContaining([
      "owner@example.test",
      "personal@example.test",
      "reconnect@example.test",
    ])
  );
  expect(host?.copied).toEqual({
    id: "owned-copy",
    personId: "fixture-person",
  });
});

it("a read-only destination does not stop readable Copy, while old-person, busy, pending-auth and dialog scopes never expose a native host", () => {
  const model = fixtureSelection();

  const reader = {
    ...model,
    calendar: {
      ...model.calendar,
      calendars: model.calendar.calendars.map((calendar) =>
        Calendar.make({ ...calendar, accessRole: "reader" })
      ),
    },
  };

  const host = clipboardNativeHost(reader, connection(), undefined, document);
  expect(host?.selected?.eventId).toBe("a-review");
  expect(host?.target).toBeUndefined();
  expect(
    clipboardNativeHost(model, connection("prior-person"), undefined, document)
  ).toBeUndefined();
  expect(
    clipboardNativeHost(
      model,
      connection("fixture-person", false),
      undefined,
      document
    )
  ).toBeUndefined();
  expect(
    clipboardNativeHost(
      { ...model, action: "pending" },
      connection(),
      undefined,
      document
    )
  ).toBeUndefined();
  expect(
    clipboardNativeHost(
      { ...model, person: Option.some("other-person") },
      connection(),
      undefined,
      document
    )
  ).toBeUndefined();
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  expect(
    clipboardNativeHost(model, connection(), undefined, document)
  ).toBeUndefined();
});

it("grid host keys invalidate navigation and zone changes, while month uses its current live root", () => {
  const model = fixtureSelection();
  const root = document.createElement("section");
  root.id = "gesture-host";
  document.body.append(root);
  const host = clipboardGridHost(model, document);
  expect(host?.mode).toBe("time");
  expect(
    clipboardGridHost(
      { ...model, calendar: { ...model.calendar, zone: "Asia/Tokyo" } },
      document
    )?.key
  ).not.toBe(host?.key);
  expect(
    clipboardGridHost(
      {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: {
            ...model.calendar.navigation,
            anchor: model.calendar.navigation.anchor + 1,
          },
        },
      },
      document
    )?.key
  ).not.toBe(host?.key);
  const month = document.createElement("section");
  month.className = "month-view";
  document.body.append(month);

  const current = clipboardGridHost(
    {
      ...model,
      calendar: {
        ...model.calendar,
        navigation: { ...model.calendar.navigation, mode: "month" },
      },
    },
    document
  );

  expect(current?.mode).toBe("month");
  expect(current?.root).toBe(month);
});

it("Cut rebasing can inspect saved copies hidden from presentation instead of substituting a visible representative", () => {
  const events = clipboardCutEvents(fixtureSelection());
  expect(
    events.some(
      (event) => event.accountId === "work" && event.calendarId === "hidden"
    )
  ).toBe(true);
});
