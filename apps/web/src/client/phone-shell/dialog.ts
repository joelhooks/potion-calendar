export interface ModalDialogOptions {
  readonly close: () => void;
  readonly fallbackId: string;
  readonly ownsEscape?: boolean;
  readonly selector: string;
}

export const reconcileModalDialog = (
  root: Element,
  options: ModalDialogOptions
) => {
  let current: HTMLDialogElement | undefined;
  let opener: HTMLElement | undefined;

  const restoreFocus = () => {
    const fallback = root.querySelector<HTMLElement>(`#${options.fallbackId}`);
    const target = opener?.isConnected === true ? opener : fallback;

    target?.focus();
    opener = undefined;
  };

  const inspect = () => {
    const next =
      root.querySelector<HTMLDialogElement>(options.selector) ?? undefined;

    if (next === current) {
      return;
    }

    if (next === undefined) {
      current?.close();
      current = undefined;
      restoreFocus();

      return;
    }

    if (current === undefined) {
      const active = root.ownerDocument.activeElement;
      opener = active instanceof HTMLElement ? active : undefined;
    } else {
      current.close();
    }

    current = next;

    if (!next.open && next.isConnected) {
      next.showModal();
    }

    const { initialFocus } = next.dataset;

    if (initialFocus !== undefined) {
      next.querySelector<HTMLElement>(`#${initialFocus}`)?.focus();
    }
  };

  const cancel = (event: Event) => {
    if (event.target === current) {
      event.preventDefault();
      options.close();
    }
  };

  const backdrop = (event: Event) => {
    if (
      !(event instanceof MouseEvent) ||
      event.target !== current ||
      current === undefined
    ) {
      return;
    }

    const bounds = current.getBoundingClientRect();

    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      options.close();
    }
  };

  const keydown = (event: Event) => {
    if (
      options.ownsEscape !== false &&
      event instanceof KeyboardEvent &&
      event.key === "Escape" &&
      !event.isComposing &&
      !event.defaultPrevented &&
      event.target instanceof Node &&
      current?.contains(event.target) === true
    ) {
      event.preventDefault();
      options.close();
    }
  };

  root.addEventListener("cancel", cancel, true);
  root.addEventListener("click", backdrop);
  root.addEventListener("keydown", keydown);
  const observer = new MutationObserver(inspect);
  observer.observe(root, { childList: true, subtree: true });
  inspect();

  return () => {
    observer.disconnect();
    root.removeEventListener("cancel", cancel, true);
    root.removeEventListener("click", backdrop);
    root.removeEventListener("keydown", keydown);
    current?.close();

    if (current !== undefined) {
      restoreFocus();
      current = undefined;
    }
  };
};
