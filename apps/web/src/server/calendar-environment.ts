import type { DurableObjectNamespace } from "@cloudflare/workers-types";

import type { d1CalendarStore } from "./calendar-store.js";

export interface CalendarEnvironment {
  readonly ALLOWED_EMAILS: string;
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
  readonly BETTER_AUTH_SECRET: string;
  readonly CALENDAR_LIVE: DurableObjectNamespace;
  readonly CALENDAR_ORIGIN: string;
  readonly DB: Parameters<typeof d1CalendarStore>[0];
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly RELEASE: string;
}
