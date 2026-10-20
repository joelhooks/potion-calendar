import type { NativeIntentValue } from "./native-host.js";

export class NativeIntentEvent extends Event {
  readonly intent: NativeIntentValue;

  constructor(intent: NativeIntentValue) {
    super("intent");
    this.intent = intent;
  }
}
