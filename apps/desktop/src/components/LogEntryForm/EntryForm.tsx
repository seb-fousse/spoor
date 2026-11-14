import { useThings } from "@data/things";
import { Button, Group, MultiSelect, NumberInput, Select, Stack, TextInput } from "@mantine/core";
import { DatePickerInput, DateTimePicker } from "@mantine/dates";
import { type LogField, optionLabel, type Precision, type Value } from "@spoor/core";
import { type FormEvent, useState } from "react";
import { parseInput } from "./parseInput";
import { dayToTime } from "./when";

export interface EntryTimeInput {
  occurredAt?: number;
  endedAt?: number | null;
  precision?: Precision;
}

interface EntryFormProps {
  fields: LogField[];
  /** A child entry takes its parent's time, so the form has no time inputs. */
  child: boolean;
  /**
   * The day ("YYYY-MM-DD") the entry is on. When given, the form doesn't ask for
   * one; without it, the form has a date picker.
   */
  day?: string;
  /** `inline` puts everything in one row; `stacked` gives each input its own row. */
  layout?: "inline" | "stacked";
  onCreate: (time: EntryTimeInput, values: Record<string, Value>) => void;
}

/** A new entry's time (unless it is a child entry) and a value per field. */
export function EntryForm({ fields, child, day, layout = "inline", onCreate }: EntryFormProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const entryDay = day ?? picked;
  const [inputs, setInputs] = useState<Record<string, string | string[]>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, Value> = {};
    for (const field of fields) {
      const input = inputs[field.id];
      if (input === undefined || input === "" || (Array.isArray(input) && input.length === 0)) {
        continue;
      }
      values[field.id] = parseInput(field.shape.valueType, input);
    }
    const time = child || entryDay === null ? {} : dayToTime(entryDay);
    onCreate(time, values);
    setInputs({});
  };

  const stacked = layout === "stacked";
  const Layout = stacked ? Stack : Group;
  const layoutProps = stacked
    ? ({ gap: "sm" } as const)
    : ({ gap: "xs", align: "flex-end" } as const);
  // Stacked inputs are labelled; inline ones rely on placeholders to stay compact.
  const size = stacked ? "sm" : "xs";

  return (
    <form onSubmit={submit}>
      <Layout {...layoutProps}>
        {!child && day === undefined && (
          <DatePickerInput
            size={size}
            label="Date"
            placeholder="Pick a date"
            valueFormat="ddd D MMM YYYY"
            value={picked}
            onChange={setPicked}
            data-autofocus
          />
        )}
        {fields.map((field) => (
          <ValueInput
            key={field.id}
            field={field}
            size={size}
            value={inputs[field.id] ?? (field.shape.valueType === "multi_ref" ? [] : "")}
            onChange={(v) => setInputs({ ...inputs, [field.id]: v })}
          />
        ))}
        {/* The pickers are not native inputs, so `required` cannot stop an empty start. */}
        <Button type="submit" size={size} disabled={!child && entryDay === null}>
          Add
        </Button>
      </Layout>
    </form>
  );
}

function ValueInput({
  field,
  size,
  value,
  onChange,
}: {
  field: LogField;
  size: "xs" | "sm";
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const { shape } = field;
  const things = useThings(
    shape.valueType === "ref" || shape.valueType === "multi_ref"
      ? shape.constraints.thingTypeId
      : null,
  );
  const text = value as string;
  // The field's name labels its input; "*" marks a required one.
  const common = { size, label: field.name, withAsterisk: field.required } as const;
  // Selects keep "" as an explicit "–" option and a cleared picker gives "", so an empty value stays a string.
  const pick = (v: string | null) => onChange(v ?? "");
  switch (shape.valueType) {
    case "boolean":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            { value: "true", label: "yes" },
            { value: "false", label: "no" },
          ]}
        />
      );
    case "number":
      // Kept as text, like the plain input it replaces; `parseInput` makes it a number.
      return <NumberInput {...common} value={text} onChange={(v) => onChange(String(v))} />;
    case "enum":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            ...shape.constraints.options.map((o) => ({
              value: o.key,
              label: optionLabel(field.optionLabels, o.key),
            })),
          ]}
        />
      );
    case "date":
      return <DatePickerInput {...common} clearable value={text || null} onChange={pick} />;
    case "datetime":
      return <DateTimePicker {...common} clearable value={text || null} onChange={pick} />;
    case "ref":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            ...things.map((t) => ({ value: t.id, label: t.title })),
          ]}
        />
      );
    case "multi_ref":
      return (
        <MultiSelect
          {...common}
          value={value as string[]}
          onChange={onChange}
          data={things.map((t) => ({ value: t.id, label: t.title }))}
        />
      );
    default:
      return (
        <TextInput {...common} value={text} onChange={(e) => onChange(e.currentTarget.value)} />
      );
  }
}
