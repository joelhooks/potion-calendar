import { calendarWorker } from "../server/calendar-worker.js";
import { calendarLiveClass } from "../server/live-object.js";

export const CalendarLive = calendarLiveClass("development");

export default calendarWorker("development");
