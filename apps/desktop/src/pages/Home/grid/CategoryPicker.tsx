import { Popover, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { TimelineCategory } from "@spoor/core";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import classes from "./CategoryPicker.module.css";
import { categoryColor } from "./gridLayout";

interface CategoryPickerProps {
  /** The ghost block the popover hangs off. */
  children: ReactNode;
  opened: boolean;
  /** The timeline's unarchived categories, by name. */
  categories: readonly TimelineCategory[];
  /** The last failed save's message. */
  error: string | null;
  saving: boolean;
  onPick: (category: { categoryId: string } | { newCategory: string }) => void;
  /** Esc or a click outside: nothing is written. */
  onCancel: () => void;
}

/**
 * The popover that asks a drawn block's category. Typing filters the list,
 * `1`–`9` picks from it while the filter is empty, Enter picks the first
 * match. "+ New category" creates one named by the filter.
 */
export function CategoryPicker({
  children,
  opened,
  categories,
  error,
  saving,
  onPick,
  onCancel,
}: CategoryPickerProps) {
  const [filter, setFilter] = useState("");
  const name = filter.trim();
  const shown = categories.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  const exact = categories.some((c) => c.name.toLowerCase() === name.toLowerCase());

  const pick = (choice: Parameters<typeof onPick>[0]) => {
    if (!saving) onPick(choice);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = shown[0];
      if (first) pick({ categoryId: first.id });
      else if (name) pick({ newCategory: name });
    } else if (filter === "" && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const chosen = shown[Number(event.key) - 1];
      if (chosen) pick({ categoryId: chosen.id });
    }
  };

  return (
    <Popover
      opened={opened}
      onClose={onCancel}
      position="right-start"
      withArrow
      shadow="md"
      width={240}
      trapFocus
    >
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={4}>
          <TextInput
            size="xs"
            placeholder="Category"
            aria-label="Filter categories"
            data-autofocus
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {shown.map((c, i) => (
            <UnstyledButton
              key={c.id}
              className={classes.option}
              disabled={saving}
              onClick={() => pick({ categoryId: c.id })}
            >
              <span
                className={classes.swatch}
                style={{ background: `var(--mantine-color-${categoryColor(c.id)}-filled)` }}
              />
              <span className={classes.name}>{c.name}</span>
              {filter === "" && i < 9 && <kbd className={classes.key}>{i + 1}</kbd>}
            </UnstyledButton>
          ))}
          {name !== "" && !exact && (
            <UnstyledButton
              className={classes.option}
              disabled={saving}
              onClick={() => pick({ newCategory: name })}
            >
              + New category “{name}”
            </UnstyledButton>
          )}
          {name === "" && (
            <Text size="xs" c="dimmed" px={6}>
              {categories.length === 0 ? "No categories yet. " : ""}Type a name to add a new
              category.
            </Text>
          )}
          {error && (
            <Text size="xs" c="red" px={6}>
              {error}
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
