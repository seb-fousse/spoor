import { DateTimePicker } from "@mantine/dates";
import classes from "../shared/Field.module.css";

export const DateTimePickerTheme = DateTimePicker.extend({
  classNames: classes,
  // Square, like the segmented controls and the number field.
  defaultProps: { radius: 0 },
});
