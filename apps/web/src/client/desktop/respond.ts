import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type { DesktopAction } from "@calendar/core/desktop-bridge";
import { Option } from "effect";
import type { Update } from "foldkit";

import { rsvpSelf } from "../../layout/rsvp-eligibility.js";
import type { AppMessage, AppModel } from "../app.js";
import { DispatchEditing } from "../editing/commands.js";
import { responseIsBusy } from "../editing/response-availability.js";
import { EditingCommand } from "../editing/runtime.js";
import type { EditingRuntime } from "../editing/runtime.js";
import { desktopSelection } from "./selection.js";

type Result = Update.Return<AppModel, AppMessage, EditingRuntime>;

export const respondForSavedEvent = (
  model: AppModel,
  event: CalendarEventValue | undefined,
  response: (typeof DesktopAction.cases.RespondToEvent.Type)["response"]
): Result => {
  if (
    Option.isNone(model.person) ||
    event === undefined ||
    rsvpSelf(event) === undefined
  ) {
    return {
      model: {
        ...model,
        error: Option.some("This event is no longer available for a response."),
      },
    };
  }

  if (responseIsBusy(model)) {
    return {
      model: {
        ...model,
        error: Option.some(
          "Wait for the current event change to finish before responding."
        ),
      },
    };
  }

  return {
    commands: [
      DispatchEditing({
        command: EditingCommand.cases.Rsvp.make({
          event,
          notePolicy: "omit",
          response,
        }),
        personId: model.person.value,
      }),
    ],
    model,
  };
};

export const respondFromDesktop = (
  model: AppModel,
  action: typeof DesktopAction.cases.RespondToEvent.Type
): Result =>
  respondForSavedEvent(
    model,
    desktopSelection(model, action.key)?.source,
    action.response
  );
