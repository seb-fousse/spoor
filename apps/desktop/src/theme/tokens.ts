import type { CSSVariablesResolver } from "@mantine/core";

/**
 * Semantic color tokens (`--app-*`), with a value for each color scheme.
 *
 * Component CSS and custom views (such as the timeline) should use these
 * tokens and never raw colors or palette shades, so they follow the color
 * scheme automatically. To add a token, give it both a `light` and a `dark`
 * value.
 */
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {
    "--app-font-mono": theme.fontFamilyMonospace,
  },
  light: {
    "--app-surface": "#f5f0e6",
    "--app-surface-raised": "#ece5d6",
    "--app-surface-hover": "#e2d9c6",
    "--app-border": "#b9ad97",
    "--app-text": "#2a2118",
    "--app-text-muted": "#76695a",
    "--app-accent": theme.colors[theme.primaryColor][6],
    // Mantine's own body color, so built-in components match our surface.
    "--mantine-color-body": "#f5f0e6",
  },
  dark: {
    "--app-surface": "#1c1814",
    "--app-surface-raised": "#25201a",
    "--app-surface-hover": "#332c24",
    "--app-border": "#4d4338",
    "--app-text": "#ece3d3",
    "--app-text-muted": "#a39683",
    "--app-accent": theme.colors[theme.primaryColor][4],
    "--mantine-color-body": "#1c1814",
  },
});
