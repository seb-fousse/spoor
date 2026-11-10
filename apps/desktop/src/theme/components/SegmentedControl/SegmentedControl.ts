import { SegmentedControl } from "@mantine/core";
import classes from "./SegmentedControl.module.css";

export const SegmentedControlTheme = SegmentedControl.extend({
  classNames: classes,
  // Dividers are drawn by our CSS, evenly; Mantine's hide beside the active option.
  defaultProps: { radius: 0, withItemsBorders: false },
});
