import { mapsPlatform } from "../../layout/location-maps.js";

export const browserMapsPlatform = () =>
  mapsPlatform(typeof navigator === "undefined" ? { platform: "" } : navigator);
