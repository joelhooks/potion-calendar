export const clipboardGuestCount = (count: number): string =>
  `${count} ${count === 1 ? "guest" : "guests"}`;
