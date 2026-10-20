export const eventPalette = [
  { google: "11", hex: "#ED201D", name: "Red" },
  { google: "4", hex: "#D06B65", name: "Coral" },
  { google: "6", hex: "#FD7941", name: "Orange" },
  { google: "5", hex: "#F4BE40", name: "Yellow" },
  { google: "", hex: "#B3DC6D", name: "Lime" },
  { google: "", hex: "#7BD149", name: "Grass" },
  { google: "10", hex: "#5ECC89", name: "Green" },
  { google: "2", hex: "#92E1C1", name: "Mint" },
  { google: "7", hex: "#4CA8DF", name: "Blue" },
  { google: "9", hex: "#4986E8", name: "Sapphire" },
  { google: "1", hex: "#9A9CFE", name: "Indigo" },
  { google: "", hex: "#B99AFE", name: "Violet" },
  { google: "3", hex: "#985DF6", name: "Purple" },
  { google: "", hex: "#F691B3", name: "Pink" },
  { google: "", hex: "#CCA6AD", name: "Blush" },
  { google: "", hex: "#AC725F", name: "Brown" },
  { google: "8", hex: "#B8B8B8", name: "Gray" },
];

export const eventColor = (
  override: string | undefined,
  calendar: string
): string =>
  eventPalette.find((item) => item.google !== "" && item.google === override)
    ?.hex ?? calendar;
