import { isDocumentRoute } from "../layout/route.js";
import type { CalendarEnvironment } from "./calendar-environment.js";

// @effect-diagnostics-next-line asyncFunction:off -- Cloudflare's static asset binding is a native Promise boundary.
export const serveCalendarAsset = async (
  request: Request,
  assets: CalendarEnvironment["ASSETS"],
  headers: Headers
): Promise<Response> => {
  const url = new URL(request.url);
  const documentRoute = isDocumentRoute(url.pathname);

  const reminderWorker =
    url.pathname === "/reminder-worker.js" &&
    ["GET", "HEAD"].includes(request.method);

  if (
    !reminderWorker &&
    !url.pathname.startsWith("/assets/") &&
    (!documentRoute || !["GET", "HEAD"].includes(request.method))
  ) {
    return new Response("Not found", { headers, status: 404 });
  }

  const response = await assets.fetch(
    documentRoute ? new Request(new URL("/", url), request) : request
  );

  const assetHeaders = new Headers([...response.headers, ...headers]);

  if (reminderWorker && response.status === 200) {
    assetHeaders.set("cache-control", "no-store");
    assetHeaders.set("content-type", "application/javascript; charset=utf-8");
    assetHeaders.set("x-content-type-options", "nosniff");
  }

  return new Response(request.method === "HEAD" ? null : response.body, {
    headers: assetHeaders,
    status: response.status,
  });
};
