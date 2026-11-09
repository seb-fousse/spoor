import { Tooltip } from "@mantine/core";
import classes from "./Tooltip.module.css";

export const TooltipTheme = Tooltip.extend({
  classNames: classes,
  defaultProps: { openDelay: 300, withArrow: true },
});
