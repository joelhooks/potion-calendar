import type {
  AgendaEventValue,
  PromptAction,
  PromptBridge,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { DateTime } from "effect";

const api = window.potionPrompt;

const root = document.querySelector("main");

const card = (event: AgendaEventValue): HTMLElement => {
  const article = document.createElement("article");
  const heading = document.createElement("h2");
  const time = document.createElement("p");
  const actions = document.createElement("div");
  heading.textContent = event.title;
  time.textContent = DateTime.formatLocal(DateTime.makeUnsafe(event.start), {
    hour: "numeric",
    minute: "2-digit",
  });
  actions.className = "actions";
  article.append(heading, time, actions);

  const button = (
    label: string,
    action: (typeof PromptAction.Type)["action"]
  ) => {
    const control = document.createElement("button");
    control.textContent = label;
    control.addEventListener(
      "click",
      () => {
        control.disabled = true;
        api?.act({ action, key: event.key });
      },
      { once: true }
    );
    actions.append(control);

    return control;
  };

  button("Join", "join");
  button("Show event", "show");
  const dismiss = button("Dismiss", "dismiss");
  article.addEventListener("keydown", (key) => {
    if (key.key === "Escape") {
      key.preventDefault();
      dismiss.click();
    }
  });

  return article;
};

const render = (view: typeof PromptView.Type) => {
  if (root === null) {
    return;
  }

  root.replaceChildren(...view.events.map(card));
  root.querySelector("button")?.focus();
};

// @effect-diagnostics-next-line asyncFunction:off -- This bounded native-page bootstrap reads one Promise from its isolated preload.
const load = async (bridge: PromptBridge) => {
  try {
    render(await bridge.getView());
  } catch {
    if (root !== null) {
      root.textContent = "Meeting prompt is unavailable.";
    }
  }
};

if (api !== undefined) {
  const stop = api.onView(render);
  void load(api);
  window.addEventListener("pagehide", stop, { once: true });
}
