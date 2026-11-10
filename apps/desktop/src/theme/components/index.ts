/**
 * App-wide overrides for each Mantine component, registered in
 * `theme.components` so they apply to every instance of that component.
 *
 * To customise a component, add a `<Name>/` folder here with `<Name>.ts` and
 * `<Name>.module.css` (if it needs CSS), and add it to the object below. In the CSS
 * module, name the classes after the component's Styles API selectors
 * (`.root`, `.label`, ...; see the "Styles API" tab of each component on
 * mantine.dev) so the module can be passed as `classNames: classes`. Target
 * states through Mantine's data attributes (`[data-active]`,
 * `[data-variant="filled"]`), and use `defaultProps` for "every X should be
 * variant Y".
 *
 * Layout and text primitives (Group, Stack, Center, Text, Title) are left out
 * until we want to change them app-wide.
 */
import { ActionIconTheme } from "./ActionIcon/ActionIcon";
import { AlertTheme } from "./Alert/Alert";
import { AppShellTheme } from "./AppShell/AppShell";
import { ButtonTheme } from "./Button/Button";
import { CheckboxTheme } from "./Checkbox/Checkbox";
import { DatePickerInputTheme } from "./DatePickerInput/DatePickerInput";
import { DateTimePickerTheme } from "./DateTimePicker/DateTimePicker";
import { LoaderTheme } from "./Loader/Loader";
import { ModalTheme } from "./Modal/Modal";
import { MultiSelectTheme } from "./MultiSelect/MultiSelect";
import { NativeSelectTheme } from "./NativeSelect/NativeSelect";
import { NumberInputTheme } from "./NumberInput/NumberInput";
import { SelectTheme } from "./Select/Select";
import { SplitterTheme } from "./Splitter/Splitter";
import { TabsTheme } from "./Tabs/Tabs";
import { TextInputTheme } from "./TextInput/TextInput";
import { TooltipTheme } from "./Tooltip/Tooltip";

export const components = {
  ActionIcon: ActionIconTheme,
  Alert: AlertTheme,
  AppShell: AppShellTheme,
  Button: ButtonTheme,
  Checkbox: CheckboxTheme,
  DatePickerInput: DatePickerInputTheme,
  DateTimePicker: DateTimePickerTheme,
  Loader: LoaderTheme,
  Modal: ModalTheme,
  MultiSelect: MultiSelectTheme,
  NativeSelect: NativeSelectTheme,
  NumberInput: NumberInputTheme,
  Select: SelectTheme,
  Splitter: SplitterTheme,
  Tabs: TabsTheme,
  TextInput: TextInputTheme,
  Tooltip: TooltipTheme,
};
