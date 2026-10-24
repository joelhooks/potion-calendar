import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import { expect } from "@effect/vitest";
import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import type { EditorAction } from "../src/client/editing/editor-action.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import { editorDialogs } from "../src/features/event-editor.js";
import { typeConversionToast } from "../src/features/type-conversion-toast.js";

export const conversionEditorScene = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
) => {
  const send = (action: typeof EditorAction.Type) =>
    Message.EditingAction({
      action,
      personId: Option.getOrUndefined(model.person),
    });

  const conversion = currentConversion(model.editing.view);

  return h.div(
    [],
    editorDialogs(h, {
      calendars: model.calendar.calendars,
      footerNotice:
        conversion === undefined
          ? undefined
          : typeConversionToast(h, conversion, send),
      model: model.editing.view,
      reminderLimit: googleCalendarCapabilities.maxRemindersCount,
      send,
    })
  );
};

export const conversionInputMessage = (
  model: AppModel,
  selector: string,
  value: string
): AppMessage => {
  const messages: AppMessage[] = [];

  Scene.scene(
    {
      update: (current: AppModel, message: AppMessage) => {
        messages.push(message);

        return { model: current };
      },
      view: conversionEditorScene,
    },
    Scene.given(model),
    Scene.type(Scene.selector(selector), value)
  );
  expect(messages).toHaveLength(1);

  return Option.getOrThrow(Option.fromUndefinedOr(messages[0]));
};
