import { TextInput } from "@mantine/core";
import classes from "../shared/Field.module.css";

export const TextInputTheme = TextInput.extend({
  classNames: classes,
  // Square, like the segmented controls and the number field.
  defaultProps: { radius: 0 },
});
