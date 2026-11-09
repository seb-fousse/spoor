import { ActionIcon } from "@mantine/core";
import classes from "./ActionIcon.module.css";

export const ActionIconTheme = ActionIcon.extend({
  classNames: classes,
  defaultProps: { variant: "subtle" },
});
