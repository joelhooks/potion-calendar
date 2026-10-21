import { Schema } from "effect";

export const LocationMaps = Schema.Literals(["google", "apple"]);

export const normalizeLocationMaps = (
  value: typeof LocationMaps.Type | undefined
): typeof LocationMaps.Type => value ?? "google";

export interface MapsNavigator {
  readonly platform: string;
  readonly userAgentData?: { readonly platform: string };
}

export interface MapsPlatform {
  readonly apple: boolean;
  readonly source: "userAgentData" | "navigator.platform";
  readonly value: string;
}

export const mapsPlatform = (browser: MapsNavigator): MapsPlatform => {
  const modern = browser.userAgentData?.platform;

  return modern === undefined
    ? {
        apple: browser.platform.startsWith("Mac"),
        source: "navigator.platform",
        value: browser.platform,
      }
    : { apple: modern === "macOS", source: "userAgentData", value: modern };
};

export const effectiveLocationMaps = (
  saved: typeof LocationMaps.Type,
  platform: MapsPlatform
): typeof LocationMaps.Type => (platform.apple ? saved : "google");
