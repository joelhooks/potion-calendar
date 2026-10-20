import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { detailPanel, sidebar, toolbar } from "./calendar.js";
import { monthGrid, timeGrid } from "./time-grid.js";

export const view = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Document => ({
  body: h.main(
    [h.Class("app")],
    [
      ...AsyncData.match(model.session, {
        onFailure: (error) => [
          h.section(
            [h.Class("auth-shell")],
            [h.h1([], ["Calendar"]), h.p([h.Role("alert")], [error])]
          ),
        ],
        onIdle: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onLoading: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onRefreshing: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onStale: ({ error }) => [
          h.p([h.Class("auth-shell"), h.Role("alert")], [error]),
        ],
        onSuccess: (data) =>
          data === null
            ? [
                h.section(
                  [h.Class("auth-shell")],
                  [
                    h.h1([], ["Calendar"]),
                    h.p([], ["Your Google calendars, in one place."]),
                    h.button(
                      [
                        h.OnClick(Message.ClickedSignIn()),
                        h.Disabled(model.action === "pending"),
                      ],
                      ["Sign in with Google"]
                    ),
                  ]
                ),
              ]
            : [
                toolbar(model, h),
                h.div(
                  [h.Class("workspace")],
                  [
                    sidebar(model, h),
                    model.calendar.navigation.mode === "month"
                      ? monthGrid(model, h)
                      : timeGrid(model, h),
                    ...detailPanel(model, h),
                  ]
                ),
              ],
      }),
      ...(Option.isNone(model.error)
        ? []
        : [h.p([h.Class("app-error"), h.Role("alert")], [model.error.value])]),
    ]
  ),
  title: "Calendar",
});
