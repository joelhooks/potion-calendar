const editable = (target: EventTarget | null): boolean => {
  if (target instanceof Element) {
    return (
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
      ) !== null
    );
  }

  return target instanceof Node && editable(target.parentElement);
};

export const nativeClipboardFocusAllowed = (
  event: {
    readonly defaultPrevented: boolean;
    readonly isTrusted: boolean;
    readonly target: EventTarget | null;
  },
  document: Document,
  composing: boolean
): boolean => {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    composing ||
    editable(event.target)
  ) {
    return false;
  }

  let focused = document.activeElement;

  while (focused !== null) {
    if (editable(focused)) {
      return false;
    }

    focused = focused.shadowRoot?.activeElement ?? null;
  }

  return document.getSelection()?.isCollapsed !== false;
};
