// Rules 6 and 7: a component is PascalCase, and imports its own files directly.
import { Icon } from "@components/Icon";
import classes from "./Widget.module.css";
import { widgetSize } from "./widgetSize";

export const Widget = () => [Icon, classes, widgetSize];
