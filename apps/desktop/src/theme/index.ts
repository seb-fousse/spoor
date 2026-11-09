import { createTheme } from "@mantine/core";
import { colors } from "./colors";
import { components } from "./components";
import { fonts } from "./fonts";

export { cssVariablesResolver } from "./tokens";

/**
 * The app's Mantine theme. Its parts:
 * - colors.ts: palettes (`brand`, ...) for `primaryColor` and `color` props
 * - tokens.ts: semantic `--app-*` CSS variables for light and dark mode
 * - fonts.ts: bundled font families
 * - components/: styles and default props applied to every instance of a component
 * - global.css: base styles for the page
 *
 * Custom views (such as the timeline) should use the `--app-*` tokens, not raw
 * colors, so they follow the color scheme.
 */
export const theme = createTheme({
  colors,
  primaryColor: "brand",
  defaultRadius: "md",
  fontFamily: fonts.sans,
  fontFamilyMonospace: fonts.mono,
  headings: { fontFamily: fonts.sans, fontWeight: "600" },
  components,
});
