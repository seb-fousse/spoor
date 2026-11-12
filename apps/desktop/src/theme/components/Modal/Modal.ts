import { Modal } from "@mantine/core";
import classes from "./Modal.module.css";

export const ModalTheme = Modal.extend({
  classNames: classes,
  // Square, like the panels and fields; a card centered over the app.
  defaultProps: { radius: 0, centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 2 } },
});
