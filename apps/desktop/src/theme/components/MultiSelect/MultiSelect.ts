import { MultiSelect } from "@mantine/core";
import classes from "../shared/Field.module.css";

export const MultiSelectTheme = MultiSelect.extend({
  classNames: classes,
  // Square, like the segmented controls and the number field.
  defaultProps: { radius: 0 },
});
