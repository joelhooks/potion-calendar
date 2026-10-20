import { ConferencingDefault } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import { initialModel } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { conferencingAccountSettings } from "../src/features/conferencing-account-settings.js";

const labels: Record<typeof ConferencingDefault.Type, string> = {
  googleMeet: "Google Meet",
  none: "No conferencing",
  unset: "Not set",
};

it.effect.prop(
  "the account control distinguishes a confirmed unset value from missing data and disables pending or unconfirmed edits",
  {
    phase: Schema.Literals([
      "success",
      "refreshing",
      "failure",
      "stale",
      "loading",
    ]),
    value: ConferencingDefault,
  },
  ({ phase, value }) =>
    Effect.gen(function* renderAccountControl() {
      const data = { accountId: "account-a", value };

      const remote = Match.value(phase).pipe(
        Match.when("success", () =>
          RemoteConferencingDefault.Success({ data })
        ),
        Match.when("refreshing", () =>
          RemoteConferencingDefault.Refreshing({ data })
        ),
        Match.when("failure", () =>
          RemoteConferencingDefault.Failure({
            error: { message: "Reload the preference" },
          })
        ),
        Match.when("stale", () =>
          RemoteConferencingDefault.Stale({
            data,
            error: { message: "Reload the preference" },
          })
        ),
        Match.when("loading", () => RemoteConferencingDefault.Loading()),
        Match.exhaustive
      );

      const model: AppModel = {
        ...initialModel(0, "UTC"),
        conferencing: {
          accounts: {
            "account-a": { operation: "read", remote, requestId: 1 },
          },
          nextRequestId: 1,
        },
        person: Option.some("person-a"),
      };

      const rendered = yield* renderToString(
        {
          init: () => ({ model }),
          view: (state: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: h.main(
              [],
              [...conferencingAccountSettings(state, h, "account-a")]
            ),
            title: "Account",
          }),
        },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const select = document.querySelector("select");
      const hasData = ["success", "refreshing", "stale"].includes(phase);

      expect(select?.value).toBe(hasData ? value : "");

      const missingLabel =
        phase === "loading" ? "Loading…" : "Preference unavailable";

      expect(select?.selectedOptions[0]?.textContent).toBe(
        hasData ? labels[value] : missingLabel
      );
      expect(select?.disabled).toBe(phase !== "success");
      expect(document.querySelector("label")?.textContent).toContain(
        "Default conferencing"
      );
    })
);
