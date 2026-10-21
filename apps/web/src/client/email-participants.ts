import { Option } from "effect";
import { AsyncData } from "foldkit";
import { UrlRequest } from "foldkit/navigation";

import { participantEmail } from "../layout/email-participants.js";
import type { ParticipantEmail } from "../layout/email-participants.js";
import { visibleEvents } from "../layout/presentation.js";
import { primarySelection } from "../layout/selection-set.js";
import type { AppModel } from "./app.js";
import { EditorView } from "./editing/editor-model.js";
import { FollowRouteRequest } from "./routing.js";

export const selectedParticipantEmail = (model: AppModel): ParticipantEmail => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  const selected = visibleEvents(model).find((event) =>
    Option.contains(primarySelection(model.calendar.selected), event.key)
  );

  if (
    session === undefined ||
    session === null ||
    !Option.contains(model.person, session.user.id) ||
    selected === undefined ||
    model.calendar.selected.length !== 1 ||
    !EditorView.guards.Closed(model.editing.view)
  ) {
    return { kind: "disabled" };
  }

  return participantEmail(selected.source, [
    session.user.email,
    ...session.accounts.map((account) => account.email),
  ]);
};

export const emailParticipants = (model: AppModel) => {
  const result = selectedParticipantEmail(model);

  return result.kind === "ready"
    ? {
        commands: [
          FollowRouteRequest({
            request: UrlRequest.External({ href: result.href }),
          }),
        ],
        model,
      }
    : { model };
};
