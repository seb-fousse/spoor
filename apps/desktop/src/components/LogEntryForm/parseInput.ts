import type { Value } from "@spoor/core";
import dayjs from "dayjs";

/** A form input as a value of `valueType`, for core to validate. */
export function parseInput(valueType: string, input: string | string[]): Value {
  switch (valueType) {
    case "boolean":
      return input === "true";
    case "number":
      return Number(input);
    case "datetime":
      // A DateTimePicker value, parsed as device-local time.
      return dayjs(input as string).valueOf();
    default:
      return input;
  }
}
