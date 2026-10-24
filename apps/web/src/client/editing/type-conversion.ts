import { createEffectLogic } from "@xstate/effect";
import { Effect, Option } from "effect";

import { hasEditorConferencing } from "./conferencing-draft.js";
import type { LoadedEditor } from "./editor-session-model.js";
import { selectCreateEventType } from "./status-event-draft.js";

export const titleConversionTarget = (title: string) => {
  switch (title.trim().toLowerCase()) {
    case "focus":
    case "focus time": {
      return Option.some("focusTime");
    }

    case "ooo":
    case "out of office": {
      return Option.some("outOfOffice");
    }

    default: {
      return Option.none();
    }
  }
};

export const autoTypeConversion = Effect.fn("Editor.autoTypeConversion")(
  function* autoTypeConversion(session: typeof LoadedEditor.Type) {
    const target = Option.getOrUndefined(
      titleConversionTarget(session.draft.title)
    );

    if (
      session.kind !== "create" ||
      target === undefined ||
      target === session.draft.eventType ||
      session.draft.statusInvitationChoice !== undefined ||
      session.draft.attendees.length > 0 ||
      session.draft.participantEmail.trim() !== "" ||
      hasEditorConferencing(session) ||
      session.draft.conferencing?.request?.kind === "googleMeet" ||
      session.draft.location !== "" ||
      session.draft.description !== "" ||
      (session.draft.attachments?.length ?? 0) > 0
    ) {
      return Option.none();
    }

    return yield* selectCreateEventType(session, target).pipe(Effect.option);
  }
);

export const typeConversionLogic = createEffectLogic({
  effect: ({
    input,
  }: {
    readonly input: {
      readonly manual: boolean;
      readonly session: typeof LoadedEditor.Type;
    };
  }) =>
    input.manual
      ? Effect.succeedNone
      : Effect.sleep(250).pipe(
          Effect.andThen(autoTypeConversion(input.session))
        ),
});
