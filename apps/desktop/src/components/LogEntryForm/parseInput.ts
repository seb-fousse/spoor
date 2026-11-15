import { instantAt, type Value } from "@spoor/core";

/**
 * A form input as a value of `valueType`, for core to validate. A datetime is read in
 * `timeZone`, the `time_zone` setting, which `describeValues` shows it in.
 */
export function parseInput(valueType: string, input: string | string[], timeZone: string): Value {
  switch (valueType) {
    case "boolean":
      return input === "true";
    case "number":
      return Number(input);
    case "datetime": {
      // A DateTimePicker value is a wall-clock time with no zone: "YYYY-MM-DD HH:mm:ss".
      const [date, time] = (input as string).split(" ");
      return instantAt(date, time ?? "", timeZone);
    }
    default:
      return input;
  }
}
