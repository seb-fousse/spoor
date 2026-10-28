import { createTheme } from "@mantine/core";

/**
 * The app's Mantine theme. Custom views (such as the timeline) should read its
 * values through Mantine's CSS variables (`var(--mantine-color-*)`, spacing,
 * radius) rather than hard-coding colors, so they follow the color scheme.
 */
export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});
