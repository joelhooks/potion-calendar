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
import { fixtureModel } from "./fixture.js";

it.effect(
  "part 1 exposes no conferencing page, default selector or Meet controls from account routes or the command menu",
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
            document.querySelector('select[id^="conferencing-default-"]')
          ).toBeNull();
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
        [...editorDocument.querySelectorAll("button")].some((button) =>
          /^(?:Add Google Meet|Remove conferencing|Replace with Google Meet)$/u.test(
            button.textContent?.trim() ?? ""
          )
        )
      ).toBe(false);

      expect(isDocumentRoute("/settings/conferencing")).toBe(false);
    })
);

it.effect(
  "normal authentication and inventory updates do not start the dormant preference commands",
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
          result: {
            accounts: [
              {
                accountId: "part1-account",
                calendars: [],
                colors: { calendar: {}, event: {} },
              },
            ],
          },
        })
      );

      expect(
        [...(authenticated.commands ?? []), ...(inventory.commands ?? [])].some(
          (command) => /ConferencingDefault/u.test(command.name)
        )
      ).toBe(false);
      expect(inventory.model.conferencing.accounts).toEqual({});
    })
);
