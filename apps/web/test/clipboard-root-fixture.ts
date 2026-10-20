import { Option } from "effect";

import { ClipboardView } from "../src/client/clipboard/model.js";
import { fixtureSelection } from "./fixture.js";

export const clipboardGuestFixture = (complete = true, count = 1) => {
  const model = fixtureSelection();

  return {
    ...model,
    clipboard: {
      ...model.clipboard,
      sessionId: Option.some("clipboard-connection"),
      view: ClipboardView.cases.Guests.make({
        calendarTitle: "Work",
        complete,
        copied: Option.some({ id: "owned-copy", personId: "fixture-person" }),
        count,
        intentId: "paste-intent",
        title: "Product review",
        toast: Option.none(),
      }),
    },
  };
};
