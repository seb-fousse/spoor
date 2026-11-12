import { NumberInput } from "@mantine/core";
import field from "../shared/Field.module.css";
import classes from "./NumberInput.module.css";

export const NumberInputTheme = NumberInput.extend({
  // The label, required mark and error come from the shared field style, so they match the other inputs.
  classNames: { label: field.label, required: field.required, error: field.error, ...classes },
  // Square, like the segmented controls; the chevrons' corners follow the input's.
  defaultProps: { radius: 0 },
});
