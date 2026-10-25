export const attachSettingsStrip = (root: Element): (() => void) => {
  let previousStrip: HTMLElement | undefined;
  let previousHref: string | null | undefined;

  const inspect = () => {
    const strip =
      root.querySelector<HTMLElement>(
        "#phone-settings-dialog[open] .settings-nav"
      ) ?? undefined;

    const active = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
    const href = active?.getAttribute("href");

    if (strip === previousStrip && href === previousHref) {
      return;
    }

    previousStrip = strip;
    previousHref = href;
    active?.scrollIntoView?.({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    });
  };

  const observer = new MutationObserver(inspect);
  observer.observe(root, {
    attributeFilter: ["open", "aria-current", "href"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  inspect();

  return () => {
    observer.disconnect();
  };
};
