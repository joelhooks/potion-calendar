import type {
  DesktopBridge,
  PromptBridge,
} from "@calendar/core/desktop-bridge";

declare global {
  interface Window {
    readonly potionDesktop?: DesktopBridge;
    readonly potionPrompt?: PromptBridge;
  }
}
