import { Schema } from "effect";

export const PhoneShellMode = Schema.Literals([
  "closed",
  "drawer",
  "details",
  "upcoming",
]);

export const PhoneShell = Schema.Struct({
  mode: PhoneShellMode,
  viewportWidth: Schema.optional(Schema.Finite),
});

export type PhoneShellValue = typeof PhoneShell.Type;

export const initialPhoneShell = (): PhoneShellValue => ({
  mode: "closed",
  viewportWidth: undefined,
});

export const isPhoneShell = (model: {
  readonly phoneShell: PhoneShellValue;
}): boolean =>
  model.phoneShell.viewportWidth !== undefined &&
  model.phoneShell.viewportWidth <= 640;
