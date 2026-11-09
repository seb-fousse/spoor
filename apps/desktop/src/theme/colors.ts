import type { MantineColorsTuple } from "@mantine/core";

/**
 * The app's color palettes: ten shades each, lightest first, as Mantine
 * expects. They drive `primaryColor` and the `color` prop on components.
 *
 * `brand` copies Mantine's blue for now so the app looks the same as it did.
 * Replace it with ten shades generated from the brand color
 * (https://mantine.dev/colors-generator/).
 */
export const brand: MantineColorsTuple = [
  "#e7f5ff",
  "#d0ebff",
  "#a5d8ff",
  "#74c0fc",
  "#4dabf7",
  "#339af0",
  "#228be6",
  "#1c7ed6",
  "#1971c2",
  "#1864ab",
];

export const colors = { brand };
