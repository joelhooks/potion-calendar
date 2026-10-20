import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { initialModel, Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { view } from "../src/features/app.js";
import { isDocumentRoute, parseRoute } from "../src/layout/route.js";
import { editingFixture } from "./editor-fixture.js";
import { fixtureIndex, fixtureModel } from "./fixture.js";

it.effect(
  "only the connected account root mounts its default while the editor requires reported Meet capability",
  () =>
    Effect.gen(function* noDeadSwitch() {
      const fixture = fixtureModel();

      const session = yield* Effect.fromOption(
        AsyncData.getData(fixture.session)
      ).pipe(Effect.orDie);

      const accountId = yield* Effect.fromNullishOr(
        session?.accounts[0]?.id
      ).pipe(Effect.orDie);

      const prepared: AppModel = {
        ...fixture,
        conferencing: {
          accounts: {
            [accountId]: {
              operation: "read",
              remote: RemoteConferencingDefault.Success({
                data: { accountId, value: "googleMeet" },
              }),
              requestId: 1,
            },
          },
          nextRequestId: 1,
        },
      };

      for (const path of [
        "/",
        "/settings/general",
        "/settings/calendars",
        `/settings/calendar/${encodeURIComponent(accountId)}`,
        "/settings/notifications",
        "/settings/conferencing",
      ]) {
        for (const menu of [false, true]) {
          const model: AppModel = {
            ...prepared,
            keyboard: {
              ...prepared.keyboard,
              screen: menu ? "commands" : "closed",
            },
            route: parseRoute(path),
          };

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const document = new DOMParser().parseFromString(
            rendered.html,
            "text/html"
          );

          expect(
            document.querySelectorAll('select[id^="conferencing-default-"]')
              .length
          ).toBe(
            path === `/settings/calendar/${encodeURIComponent(accountId)}`
              ? 1
              : 0
          );
          expect(
            document.querySelector('a[href="/settings/conferencing"]')
          ).toBeNull();
          expect(
            [...document.querySelectorAll("button")].map((button) =>
              button.textContent?.trim()
            )
          ).not.toEqual(expect.arrayContaining(["Add Google Meet"]));
          expect(
            [...document.querySelectorAll("button")].some((button) =>
              /^(?:Remove conferencing|Replace with Google Meet)$/u.test(
                button.textContent?.trim() ?? ""
              )
            )
          ).toBe(false);
        }
      }

      const editing = {
        ...prepared,
        calendar: {
          ...prepared.calendar,
          calendars: prepared.calendar.calendars.map((calendar) => ({
            ...calendar,
            allowedConferenceSolutionTypes: [],
          })),
        },
        editing: { ...prepared.editing, view: editingFixture },
      };

      const editor = yield* renderToString(
        { init: () => ({ model: editing }), view },
        { isHydratable: false }
      );

      const editorDocument = new DOMParser().parseFromString(
        editor.html,
        "text/html"
      );

      expect(
        editorDocument.querySelector<HTMLButtonElement>("#event-add-meet")
          ?.disabled
      ).toBe(true);
      expect(
        editorDocument.querySelector("#event-meet-availability")?.textContent
      ).toContain("can't add Google Meet");

      expect(isDocumentRoute("/settings/conferencing")).toBe(false);
    })
);

it.effect(
  "authentication loads connected account preferences once and inventory does not restart pending reads",
  () =>
    Effect.sync(() => {
      const fixture = fixtureModel();
      const snapshot = Option.getOrThrow(AsyncData.getData(fixture.session));

      const authenticated = update(
        initialModel(fixture.calendar.now, "UTC"),
        Message.ReceivedSession({ snapshot })
      );

      const inventory = update(
        authenticated.model,
        Message.ReceivedCalendars({
          result: fixtureIndex,
        })
      );

      const connected =
        snapshot?.accounts.filter((account) => !account.disconnected) ?? [];

      expect(
        (authenticated.commands ?? []).filter(
          (command) => command.name === "ReadConferencingDefault"
        )
      ).toHaveLength(connected.length);
      expect(
        (inventory.commands ?? []).filter((command) =>
          /ConferencingDefault/u.test(command.name)
        )
      ).toHaveLength(0);
      expect(
        Object.keys(inventory.model.conferencing.accounts).toSorted()
      ).toEqual(connected.map((account) => account.id).toSorted());
    })
);
