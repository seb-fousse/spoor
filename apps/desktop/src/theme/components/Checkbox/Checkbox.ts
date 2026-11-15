import { Checkbox } from "@mantine/core";
import classes from "./Checkbox.module.css";

/**
 * Checked boxes take the app's accent, like the rest of the highlighting.
 * Mantine's own fill follows `primaryShade`, which is darker in dark mode, so
 * the accent token is passed as the color; the check is the surface color.
 */
export const CheckboxTheme = Checkbox.extend({
  classNames: classes,
  defaultProps: {
    color: "var(--app-accent)",
    iconColor: "var(--app-surface)",
  },
});
