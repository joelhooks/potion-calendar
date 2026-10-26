import { GlobalShortcut } from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
  PromptPreferences,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

import type { PromptPresentation } from "./prompt-machine.js";

export const nextPromptView = (
  previous: typeof PromptView.Type,
  events: readonly AgendaEventValue[],
  presentation: PromptPresentation
): typeof PromptView.Type => ({
  events,
  preferences: presentation.preferences,
  revision: previous.revision + 1,
});

export const projectPromptPreferences = (
  snapshot: AgendaSnapshotValue,
  native: DesktopPreferencesValue
): typeof PromptPreferences.Type | undefined =>
  snapshot.promptPreferences === undefined
    ? undefined
    : {
        ...snapshot.promptPreferences,
        joinShortcut: native.menuBar
          ? Option.getOrNull(
              Schema.decodeOption(GlobalShortcut)(native.joinShortcut)
            )
          : null,
      };
