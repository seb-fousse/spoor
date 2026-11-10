import { Splitter } from "@mantine/core";
import classes from "./Splitter.module.css";

export const SplitterTheme = Splitter.extend({
  classNames: classes,
  defaultProps: { lineSize: "1px", withHandle: false },
});
