import { NumberInput } from "@mantine/core";
import classes from "./NumberInput.module.css";

export const NumberInputTheme = NumberInput.extend({
  classNames: classes,
  // Square, like the segmented controls; the chevrons' corners follow the input's.
  defaultProps: { radius: 0 },
});
