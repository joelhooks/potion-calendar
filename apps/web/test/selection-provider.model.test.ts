import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { selectionCommandFixture } from "./selection-command-fixture.js";

it.effect.prop(
  "Open in Google Calendar is absent without a safe HTTP(S) provider original",
  {
    scheme: Schema.Literals(["mailto", "ftp", "data"]),
  },
  ({ scheme }) =>
    Effect.sync(() => {
      const fixture = selectionCommandFixture(false);

      const event = {
        ...fixture.event,
        htmlLink: `${scheme}:user@example.test`,
      };

      const base = {
        ...fixture.model,
        calendar: {
          ...fixture.model.calendar,
          reads: [
            {
              accountId: event.accountId,
              events: RemoteEvents.Success({
                data: { events: [event], versions: [] },
              }),
            },
          ],
        },
      };

      const open = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        commandChoices(open).find((choice) => choice.id === "open-in-provider")
      ).toBeUndefined();

      const attempted = update(
        open,
        Message.KeyboardAction({ id: "open-in-provider" })
      );

      expect(attempted.model).toBe(open);
      expect(attempted.commands ?? []).toHaveLength(0);
    })
);
