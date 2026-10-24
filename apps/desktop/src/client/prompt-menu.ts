interface MenuSize {
  readonly height: number;
  readonly width: number;
}

export const promptMenuPosition = (
  anchor: { readonly bottom: number; readonly right: number },
  menu: MenuSize,
  viewport: MenuSize
) => ({
  left: Math.max(
    8,
    Math.min(anchor.right - menu.width, viewport.width - menu.width - 8)
  ),
  top: Math.max(
    8,
    Math.min(anchor.bottom + 4, viewport.height - menu.height - 8)
  ),
});
