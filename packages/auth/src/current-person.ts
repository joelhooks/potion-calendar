import type { PersonId } from "@calendar/database";
import { Context } from "effect";

export class CurrentPerson extends Context.Service<CurrentPerson, PersonId>()(
  "@calendar/auth/CurrentPerson"
) {}
