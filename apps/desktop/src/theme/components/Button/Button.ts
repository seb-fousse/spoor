import { Button } from "@mantine/core";
import classes from "./Button.module.css";

export const ButtonTheme = Button.extend({
  classNames: classes,
  // Square, like the bottom bar's tabs and the fields.
  defaultProps: { radius: 0 },
});
