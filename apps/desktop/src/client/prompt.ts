import type {
  AgendaEventValue,
  PromptAction,
  PromptBridge,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { DateTime } from "effect";
import { initialTransition, transition } from "xstate";
import type { EventFromLogic } from "xstate";

import { promptEmailUrl } from "../prompt-email.js";
import { attachmentControls } from "./prompt-attachments.js";
import { createPromptMeasurement } from "./prompt-measurement.js";
import { promptMenuPosition } from "./prompt-menu.js";
import { promptSwipe } from "./prompt-swipe.js";
import { createSoundReceiver, createToneAudio } from "./sound.js";

const api = window.potionPrompt;

const root = document.querySelector("main");

const card = (event: AgendaEventValue): HTMLElement => {
  const article = document.createElement("article");
  article.dataset.promptCard = "";
  article.dataset.eventId = event.key.eventId;
  let [gesture] = initialTransition(promptSwipe);

  const swipe = (input: EventFromLogic<typeof promptSwipe>) => {
    [gesture] = transition(promptSwipe, gesture, input);
    article.dataset.dragging = String(gesture.matches("dragging"));
    article.style.transform = gesture.matches("dragging")
      ? `translateX(${Math.max(0, gesture.context.dx)}px)`
      : "";
  };

  const body = document.createElement("div");
  body.dataset.promptBody = "";
  body.setAttribute("role", "button");
  body.setAttribute("aria-label", `Show ${event.title}`);
  body.tabIndex = 0;
  const heading = document.createElement("h2");
  const time = document.createElement("p");
  const actions = document.createElement("div");
  heading.textContent = event.title;
  time.textContent = DateTime.formatLocal(DateTime.makeUnsafe(event.start), {
    hour: "numeric",
    minute: "2-digit",
  });
  body.append(heading, time);
  actions.className = "actions";
  article.append(body, attachmentControls(event, api), actions);

  const button = (
    label: string,
    action: Exclude<(typeof PromptAction.Type)["action"], "attachment">
  ) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.addEventListener(
      "click",
      (click) => {
        click.stopPropagation();
        control.disabled = true;
        api?.act({ action, key: event.key });
      },
      { once: true }
    );

    return control;
  };

  const join = button("Join", "join");
  join.dataset.promptJoin = "";
  actions.append(join);
  const dismiss = button("×", "dismiss");
  dismiss.dataset.promptDismiss = "";
  dismiss.className = "dismiss";
  dismiss.setAttribute("aria-label", `Dismiss ${event.title}`);
  dismiss.addEventListener("click", () => {
    swipe({ type: "Dismiss" });
  });

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.textContent = "⋯";
  menuButton.className = "menu-toggle";
  menuButton.dataset.promptMenu = "";
  menuButton.setAttribute("aria-label", `Actions for ${event.title}`);
  menuButton.setAttribute("aria-haspopup", "menu");
  menuButton.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "prompt-menu";
  menu.setAttribute("role", "menu");
  menu.id = `prompt-menu-${encodeURIComponent(JSON.stringify(event.key))}`;
  menuButton.setAttribute("aria-controls", menu.id);
  menu.hidden = true;

  const closeMenu = (restoreFocus: boolean) => {
    menu.hidden = true;
    article.dataset.menuOpen = "false";
    menuButton.setAttribute("aria-expanded", "false");

    if (restoreFocus) {
      menuButton.focus();
    }
  };

  const enabledItems = () => [
    ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];

  const openMenu = () => {
    article.dataset.menuOpen = "true";
    swipe({ pointer: gesture.context.pointer, type: "Cancel" });
    menu.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");

    const position = promptMenuPosition(
      menuButton.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      { height: window.innerHeight, width: window.innerWidth }
    );

    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    enabledItems()[0]?.focus();
  };

  for (const item of [
    { action: "email", label: "Email participants" },
    { action: "snooze", label: "Snooze for 1 minute" },
    { action: "show", label: "Show event" },
  ] satisfies readonly {
    readonly action: Exclude<
      (typeof PromptAction.Type)["action"],
      "attachment"
    >;
    readonly label: string;
  }[]) {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = item.label;
    control.dataset.promptItem = item.action;
    control.setAttribute("role", "menuitem");
    control.tabIndex = -1;
    control.disabled =
      item.action === "email" && promptEmailUrl(event) === undefined;
    control.addEventListener("click", (click) => {
      click.stopPropagation();
      closeMenu(true);
      api?.act({ action: item.action, key: event.key });
    });
    menu.append(control);
  }

  menuButton.addEventListener("click", (click) => {
    click.stopPropagation();

    if (menu.hidden === true) {
      openMenu();
    } else {
      closeMenu(false);
    }
  });
  menuButton.addEventListener("keydown", (key) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(key.key)) {
      key.preventDefault();
      key.stopPropagation();
      openMenu();

      if (key.key === "ArrowUp") {
        enabledItems().at(-1)?.focus();
      }
    }
  });
  menu.addEventListener("keydown", (key) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key.key)) {
      key.preventDefault();
      key.stopPropagation();
      const items = enabledItems();
      const active = document.activeElement;

      const current =
        active instanceof HTMLButtonElement ? items.indexOf(active) : -1;

      let next =
        (current + (key.key === "ArrowDown" ? 1 : -1) + items.length) %
        items.length;

      if (key.key === "Home") {
        next = 0;
      } else if (key.key === "End") {
        next = items.length - 1;
      }

      items[next]?.focus();
    }
  });
  actions.append(menuButton, dismiss);
  article.append(menu);
  article.addEventListener(
    "wheel",
    () => {
      closeMenu(false);
    },
    { passive: true }
  );
  article.addEventListener("focusout", (focus) => {
    if (
      !(focus.relatedTarget instanceof Node) ||
      !article.contains(focus.relatedTarget)
    ) {
      closeMenu(false);
    }
  });
  article.addEventListener("click", (click) => {
    if (
      click.target instanceof Element &&
      click.target.closest("button,[role=menu]") !== null
    ) {
      return;
    }

    closeMenu(false);
    const canShow = gesture.matches("idle");
    swipe({ type: "Click" });

    if (canShow) {
      api?.act({ action: "show", key: event.key });
    }
  });
  body.addEventListener("keydown", (key) => {
    if (key.key === "Enter" || key.key === " ") {
      key.preventDefault();
      key.stopPropagation();
      api?.act({ action: "show", key: event.key });
    }
  });
  article.addEventListener("keydown", (key) => {
    if (key.key === "Escape") {
      key.preventDefault();
      key.stopPropagation();

      if (menu.hidden === true) {
        dismiss.click();
      } else {
        closeMenu(true);
      }
    }
  });
  article.addEventListener("pointerdown", (pointer) => {
    if (
      pointer.button !== 0 ||
      !pointer.isPrimary ||
      (pointer.target instanceof Element &&
        pointer.target.closest("button,[role=menu]") !== null)
    ) {
      return;
    }

    closeMenu(false);
    swipe({
      at: pointer.timeStamp,
      pointer: pointer.pointerId,
      type: "Start",
      width: article.getBoundingClientRect().width,
      x: pointer.clientX,
      y: pointer.clientY,
    });
    article.setPointerCapture?.(pointer.pointerId);
  });
  article.addEventListener("pointermove", (pointer) => {
    swipe({
      at: pointer.timeStamp,
      pointer: pointer.pointerId,
      type: "Move",
      x: pointer.clientX,
      y: pointer.clientY,
    });

    if (gesture.matches("dragging")) {
      pointer.preventDefault();
    }
  });
  article.addEventListener("pointerup", (pointer) => {
    const wasDismissed = gesture.matches("dismissed");
    swipe({
      at: pointer.timeStamp,
      pointer: pointer.pointerId,
      type: "End",
      x: pointer.clientX,
      y: pointer.clientY,
    });

    if (!wasDismissed && gesture.matches("dismissed")) {
      dismiss.click();
    }

    if (article.hasPointerCapture?.(pointer.pointerId)) {
      article.releasePointerCapture(pointer.pointerId);
    }
  });
  article.addEventListener("pointercancel", (pointer) => {
    swipe({ pointer: pointer.pointerId, type: "Cancel" });
  });
  article.addEventListener("lostpointercapture", (pointer) => {
    swipe({ pointer: pointer.pointerId, type: "Cancel" });
  });

  return article;
};

const measurement = createPromptMeasurement(root, api);

const render = (view: typeof PromptView.Type) => {
  if (root === null) {
    return;
  }

  root.replaceChildren(...view.events.map(card));
  root.querySelector("button")?.focus();
  measurement.presented(view.revision);
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

  const receiveSound = createSoundReceiver(createToneAudio(), (reply) => {
    api.soundReply?.(reply);
  });

  const stopSound = api.onSound?.((request) => {
    void receiveSound(request);
  });

  void load(api);
  window.addEventListener(
    "pagehide",
    () => {
      stop();
      stopSound?.();
      measurement.dispose();
    },
    { once: true }
  );
}
