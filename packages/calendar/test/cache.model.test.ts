import { calendarStoreContract } from "@calendar/calendar/testing";

import { memoryCalendarStore } from "../src/memory.js";

calendarStoreContract("memory calendar store", () => memoryCalendarStore);
