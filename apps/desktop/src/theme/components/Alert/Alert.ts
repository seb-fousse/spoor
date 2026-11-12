import { Alert } from "@mantine/core";
import classes from "./Alert.module.css";

export const AlertTheme = Alert.extend({
  classNames: classes,
  // Square, like the panels around it.
  defaultProps: { radius: 0 },
});
