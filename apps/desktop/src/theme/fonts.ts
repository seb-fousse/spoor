// Fonts are bundled (not loaded from a CDN) because the desktop app runs offline.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

const systemSans =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const systemMono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export const fonts = {
  sans: `'Inter Variable', ${systemSans}`,
  mono: `'JetBrains Mono Variable', ${systemMono}`,
};
