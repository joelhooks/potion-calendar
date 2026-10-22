export const canResumeHost = (
  document: Document,
  resume: { readonly day: number; readonly hostKey: string }
): boolean => {
  const host = document.querySelector<HTMLElement>("#gesture-host");

  return (
    document.visibilityState === "visible" &&
    document.querySelector(
      'dialog[open], [data-editing-dialog], [role="dialog"]'
    ) === null &&
    host?.dataset.gestureHostKey === resume.hostKey &&
    host.querySelector(`.day-column[data-day="${resume.day}"]`) !== null &&
    host.dataset.gesturePhase !== "armed" &&
    host.dataset.gesturePhase !== "dragging" &&
    host.dataset.selectionPhase !== "armed" &&
    host.dataset.selectionPhase !== "dragging" &&
    host.querySelector(
      '[data-zone-drag-phase="pressed"], [data-zone-drag-phase="dragging"]'
    ) === null
  );
};
