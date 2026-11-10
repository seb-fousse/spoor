import { Button, Checkbox, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import {
  FIELD_VALUE_TYPES,
  type FieldDefinition,
  type FieldPatch,
  type FieldValueType,
  type NewField,
} from "@spoor/core";
import { type FormEvent, useState } from "react";

/**
 * A type's fields, each edited and saved on its own, plus a row to add one.
 * A field's value type is fixed once created, as is the thing type a reference
 * refers to; to change either, add a new field and delete the old one.
 */
export function FieldList({
  fields,
  thingTypes,
  lockedId,
  onAdd,
  onUpdate,
  onReorder,
  onDelete,
}: {
  fields: FieldDefinition[];
  /** Offered as reference targets, and used to name existing ones. */
  thingTypes: { id: string; name: string }[];
  /** A field that must stay required and cannot be deleted, such as a thing type's title. */
  lockedId?: string;
  onAdd: (field: NewField) => void;
  onUpdate: (fieldId: string, patch: FieldPatch) => void;
  onReorder: (fieldIds: string[]) => void;
  /** Asks before deleting, since the field's values go with it. */
  onDelete: (field: FieldDefinition) => void;
}) {
  const move = (i: number, by: number) => {
    const ids = fields.map((f) => f.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    onReorder(ids);
  };
  return (
    <Stack gap={4}>
      {fields.map((field, i) => (
        <FieldRow
          // Saving bumps `updatedAt`, which resets the row to the stored field.
          key={`${field.id}:${field.updatedAt}`}
          field={field}
          thingTypes={thingTypes}
          locked={field.id === lockedId}
          onSave={(patch) => onUpdate(field.id, patch)}
          onDelete={() => onDelete(field)}
          onUp={i === 0 ? undefined : () => move(i, -1)}
          onDown={i === fields.length - 1 ? undefined : () => move(i, 1)}
        />
      ))}
      <NewFieldRow key={fields.length} thingTypes={thingTypes} onAdd={onAdd} />
    </Stack>
  );
}

function FieldRow({
  field,
  thingTypes,
  locked,
  onSave,
  onDelete,
  onUp,
  onDown,
}: {
  field: FieldDefinition;
  thingTypes: { id: string; name: string }[];
  locked: boolean;
  onSave: (patch: FieldPatch) => void;
  onDelete: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const { valueType, constraints } = field.shape;
  const isRef = valueType === "ref" || valueType === "multi_ref";
  const [name, setName] = useState(field.name);
  const [required, setRequired] = useState(field.required);
  const [text, setText] = useState(isRef ? "" : constraintsText(constraints));
  const save = (e: FormEvent) => {
    e.preventDefault();
    // Blank clears the constraints, unlike leaving them out of the patch.
    onSave({ name, required, ...(isRef ? {} : { constraints: parseConstraints(text) ?? {} }) });
  };
  const target = isRef
    ? thingTypes.find((t) => t.id === (constraints as { thingTypeId: string }).thingTypeId)
    : undefined;
  return (
    <form onSubmit={save}>
      <Group gap="xs" align="center">
        <TextInput
          size="xs"
          aria-label="Field name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Text size="sm" c="dimmed">
          {valueType}
          {isRef && ` → ${target?.name ?? "?"}`}
        </Text>
        <Checkbox
          size="xs"
          label="required"
          checked={required}
          disabled={locked}
          onChange={(e) => setRequired(e.currentTarget.checked)}
        />
        {!isRef && (
          <TextInput
            size="xs"
            aria-label="Constraints (JSON)"
            placeholder="Constraints (JSON)"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
        )}
        <Button type="submit" size="xs" variant="default">
          Save
        </Button>
        <Button size="xs" variant="default" disabled={!onUp} onClick={onUp}>
          ↑
        </Button>
        <Button size="xs" variant="default" disabled={!onDown} onClick={onDown}>
          ↓
        </Button>
        {!locked && (
          <Button size="xs" variant="light" color="red" onClick={onDelete}>
            Delete
          </Button>
        )}
      </Group>
    </form>
  );
}

function NewFieldRow({
  thingTypes,
  onAdd,
}: {
  thingTypes: { id: string; name: string }[];
  onAdd: (field: NewField) => void;
}) {
  const [field, setField] = useState<NewFieldDraft>(newFieldDraft);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd(toNewField(field));
    setField(newFieldDraft());
  };
  return (
    <form onSubmit={submit}>
      <Group gap="xs" align="center">
        <NewFieldInputs field={field} thingTypes={thingTypes} onChange={setField} />
        <Button type="submit" size="xs">
          Add field
        </Button>
      </Group>
    </form>
  );
}

/** A field being created: constraints as JSON text, or a reference's target. */
export interface NewFieldDraft {
  name: string;
  valueType: FieldValueType;
  required: boolean;
  constraints: string;
  thingTypeId: string;
}

export const newFieldDraft = (): NewFieldDraft => ({
  name: "",
  valueType: "text",
  required: false,
  constraints: "",
  thingTypeId: "",
});

export const toNewField = ({ constraints, thingTypeId, ...draft }: NewFieldDraft): NewField => ({
  ...draft,
  constraints:
    draft.valueType === "ref" || draft.valueType === "multi_ref"
      ? { thingTypeId }
      : parseConstraints(constraints),
});

/** The inputs for a new field: its name, value type, required flag, and constraints or target. */
export function NewFieldInputs({
  field,
  thingTypes,
  onChange,
}: {
  field: NewFieldDraft;
  thingTypes: { id: string; name: string }[];
  onChange: (field: NewFieldDraft) => void;
}) {
  const change = (patch: Partial<NewFieldDraft>) => onChange({ ...field, ...patch });
  return (
    <>
      <TextInput
        size="xs"
        value={field.name}
        onChange={(e) => change({ name: e.currentTarget.value })}
        placeholder="Field name"
        aria-label="Field name"
      />
      <Select
        size="xs"
        aria-label="Value type"
        allowDeselect={false}
        value={field.valueType}
        onChange={(v) => v && change({ valueType: v as FieldValueType, constraints: "" })}
        data={[...FIELD_VALUE_TYPES]}
      />
      <Checkbox
        size="xs"
        label="required"
        checked={field.required}
        onChange={(e) => change({ required: e.currentTarget.checked })}
      />
      {field.valueType === "ref" || field.valueType === "multi_ref" ? (
        <Select
          size="xs"
          aria-label="Refers to"
          allowDeselect={false}
          value={field.thingTypeId}
          onChange={(v) => change({ thingTypeId: v ?? "" })}
          data={[
            { value: "", label: "Refers to…" },
            ...thingTypes.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      ) : (
        <TextInput
          size="xs"
          value={field.constraints}
          onChange={(e) => change({ constraints: e.currentTarget.value })}
          aria-label="Constraints (JSON)"
          placeholder={
            field.valueType === "enum"
              ? '{"options":[{"key":"a","order":1}]}'
              : "Constraints (JSON)"
          }
        />
      )}
    </>
  );
}

const constraintsText = (constraints: unknown) => {
  const text = JSON.stringify(constraints);
  return text === "{}" ? "" : text;
};

/** Constraints typed as JSON; blank is none. Invalid JSON is left for core to refuse by name. */
function parseConstraints(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
