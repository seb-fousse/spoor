import { Popover, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { TimelineCategory } from "@spoor/core";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import classes from "./CategoryPicker.module.css";
import { categoryColor } from "./gridLayout";

interface CategoryPickerProps {
  /** The block the popover hangs off. */
  children: ReactNode;
  opened: boolean;
  /** The timeline's unarchived categories, by name. */
  categories: readonly TimelineCategory[];
  /** An existing block's category, marked in the list. Picking it again changes nothing. */
  currentId?: string;
  /** Categories the block can't take, because it would overlap their blocks. */
  disabledIds?: ReadonlySet<string>;
  /** The last failed save's message. */
  error: string | null;
  saving: boolean;
  onPick: (category: { categoryId: string } | { newCategory: string }) => void;
  /** Esc or a click outside: nothing is written. */
  onCancel: () => void;
}

/**
 * The popover that asks a block's category: a drawn block's, or an existing
 * one's (deleting one is in its right-click menu, `BlockMenu`). Typing filters the list, `1`–`9`
 * picks from it while the filter is empty, Enter picks the first match.
 * Categories the block can't take are shown but can't be picked, and get no
 * number. "+ New category" creates one named by the filter.
 */
export function CategoryPicker({
  children,
  opened,
  categories,
  currentId,
  disabledIds,
  error,
  saving,
  onPick,
  onCancel,
}: CategoryPickerProps) {
  const [filter, setFilter] = useState("");
  const name = filter.trim();
  const shown = categories.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  const exact = categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  const pickable = shown.filter((c) => !disabledIds?.has(c.id));

  const pick = (choice: Parameters<typeof onPick>[0]) => {
    if (saving) return;
    if ("categoryId" in choice && choice.categoryId === currentId) onCancel();
    else onPick(choice);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = pickable[0];
      if (first) pick({ categoryId: first.id });
      else if (name) pick({ newCategory: name });
    } else if (filter === "" && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const chosen = pickable[Number(event.key) - 1];
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
          {shown.map((c) => {
            const disabled = disabledIds?.has(c.id) ?? false;
            const key = pickable.indexOf(c);
            return (
              <UnstyledButton
                key={c.id}
                className={classes.option}
                disabled={saving || disabled}
                title={disabled ? `Overlaps another ${c.name} block` : undefined}
                aria-current={c.id === currentId || undefined}
                onClick={() => pick({ categoryId: c.id })}
              >
                <span
                  className={classes.swatch}
                  style={{ background: `var(--mantine-color-${categoryColor(c.id)}-filled)` }}
                />
                <span className={classes.name}>{c.name}</span>
                {c.id === currentId && (
                  <span className={classes.current} aria-hidden="true">
                    ✓
                  </span>
                )}
                {filter === "" && key !== -1 && key < 9 && (
                  <kbd className={classes.key}>{key + 1}</kbd>
                )}
              </UnstyledButton>
            );
          })}
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
