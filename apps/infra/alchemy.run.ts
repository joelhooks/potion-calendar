import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { calendarWebsite } from "../web/src/website.js";

export default Alchemy.Stack(
  "Calendar",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* calendarStack() {
    const website = yield* calendarWebsite;

    return { websiteUrl: website.url };
  })
);
