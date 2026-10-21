import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { EditorView } from "../client/editing/editor-model.js";
import { PrepareSelection } from "../client/selection/mount.js";

export const selectionSurface = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  hostKey: Option.Option<string>,
  children: readonly Html[]
) =>
  h.div(
    [
      h.Style({ display: "contents" }),
      ...Option.match(hostKey, {
        onNone: () => [],
        onSome: (key) =>
          Option.isSome(model.person) &&
          EditorView.guards.Closed(model.editing.view)
            ? [
                h.OnMount(
                  PrepareSelection({
                    hostKey: key,
                    personId: model.person.value,
                  })
                ),
              ]
            : [],
      }),
    ],
    children
  );
