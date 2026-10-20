import { Option, Schema } from "effect";

export const KeyboardUi = Schema.Struct({
  cursor: Schema.Option(Schema.String),
  deadline: Schema.Finite,
  flash: Schema.Option(Schema.Int),
  flashVersion: Schema.Int,
  focus: Schema.String,
  highlighted: Schema.String,
  opening: Schema.Literals(["none", "toggleAllDay"]),
  prefix: Schema.String,
  query: Schema.String,
  screen: Schema.Literals([
    "closed",
    "commands",
    "days",
    "date",
    "zones",
    "event-zone",
  ]),
  sidebar: Schema.Boolean,
});

export const initialKeyboard = (): typeof KeyboardUi.Type => ({
  cursor: Option.none(),
  deadline: 0,
  flash: Option.none(),
  flashVersion: 0,
  focus: "event-title",
  highlighted: "",
  opening: "none",
  prefix: "",
  query: "",
  screen: "closed",
  sidebar: true,
});
