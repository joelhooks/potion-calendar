import { BetterAuth, Memory } from "@alchemy.run/better-auth";
import { Effect, Layer } from "effect";

import { authOptions } from "./auth-options.js";
import { AuthService } from "./auth-service.js";

export { authOptions } from "./auth-options.js";

export type { AuthInstance } from "./auth-options.js";

export interface MemoryLayerOptions {
  readonly baseURL?: string;
}

// @effect-diagnostics-next-line leakingRequirements:off -- Devtools' memory Auth retains Alchemy's per-request RuntimeContext.
export class Auth extends AuthService {
  static memoryLayer(secret: string, options: MemoryLayerOptions = {}) {
    const configured =
      options.baseURL === undefined
        ? { ...authOptions, secret }
        : { ...authOptions, baseURL: options.baseURL, secret };

    return Layer.effect(
      Auth,
      BetterAuth(configured).pipe(Effect.provide(Memory()))
    );
  }
}
