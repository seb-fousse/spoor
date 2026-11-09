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
    "--app-surface": theme.white,
    "--app-surface-raised": theme.colors.gray[0],
    "--app-surface-hover": theme.colors.gray[1],
    "--app-border": theme.colors.gray[3],
    "--app-text": theme.colors.gray[9],
    "--app-text-muted": theme.colors.gray[6],
    "--app-accent": theme.colors[theme.primaryColor][6],
    // Mantine's own body color, so built-in components match our surface.
    "--mantine-color-body": theme.white,
  },
  dark: {
    "--app-surface": theme.colors.dark[7],
    "--app-surface-raised": theme.colors.dark[6],
    "--app-surface-hover": theme.colors.dark[5],
    "--app-border": theme.colors.dark[4],
    "--app-text": theme.colors.dark[0],
    "--app-text-muted": theme.colors.dark[2],
    "--app-accent": theme.colors[theme.primaryColor][4],
    "--mantine-color-body": theme.colors.dark[7],
  },
});
