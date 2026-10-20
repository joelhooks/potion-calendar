import type { BetterAuthInstance } from "@alchemy.run/better-auth";

interface AuthOptions {
  readonly basePath: "/auth";
  readonly emailAndPassword: { readonly enabled: true };
}

export const authOptions: AuthOptions = {
  basePath: "/auth",
  emailAndPassword: { enabled: true },
};

export type AuthInstance = BetterAuthInstance<typeof authOptions>;
