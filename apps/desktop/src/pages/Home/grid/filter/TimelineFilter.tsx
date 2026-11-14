import { Icon } from "@components/Icon";
import { Checkbox, Popover, UnstyledButton } from "@mantine/core";
import type { Timeline } from "@spoor/core";
import { useId } from "react";
import classes from "./TimelineFilter.module.css";
import { type HiddenTimelines, toggleTimeline, visibleTimelines } from "./timelineVisibility";

interface TimelineFilterProps {
  /** Every timeline the grid could show, one checkbox each. */
  timelines: Timeline[];
  hidden: HiddenTimelines;
  onChange: (hidden: HiddenTimelines) => void;
}

/**
 * One cell in Home's left header, "Timelines 3/4", that opens a checklist of
 * which timelines the grid shows. It is a dropdown with a count, not a row of
 * options, so it reads as a different kind of control from the day range
 * beside it. While some timelines are hidden the count turns accent-coloured.
 */
export function TimelineFilter({ timelines, hidden, onChange }: TimelineFilterProps) {
  const shown = visibleTimelines(timelines, hidden).length;
  const everyShown = shown === timelines.length;
  const id = useId();

  return (
    <Popover
      position="bottom-start"
      // The bar's bottom line sits just under the 44px cell, which is where the dropdown
      // starts, so its top border is that line continued. It starts 1px left, so its left
      // border sits on the range toggle's divider.
      offset={{ mainAxis: 0, crossAxis: -1 }}
      radius={0}
      // At least as wide as the cell that opened it, wider if a name needs it. The extra
      // 1px makes up for the one it starts to the left, so the right edges line up.
      middlewares={{
        size: {
          apply({ rects, elements }) {
            elements.floating.style.minWidth = `${rects.reference.width + 1}px`;
          },
        },
      }}
      trapFocus
      returnFocus
      classNames={{ dropdown: classes.dropdown }}
    >
      <Popover.Target>
        <UnstyledButton
          className={classes.cell}
          aria-label={`Timelines, ${shown} of ${timelines.length} shown`}
        >
          {/* A funnel, 1em like the text. */}
          <Icon className={classes.icon}>
            <path d="M3 5h18l-7 8v6l-4 2v-8z" />
          </Icon>
          Timelines
          <span
            className={classes.count}
            data-filtered={everyShown ? undefined : true}
            aria-hidden="true"
          >
            {shown}/{timelines.length}
          </span>
        </UnstyledButton>
      </Popover.Target>

      <Popover.Dropdown>
        {/* Select all: on when every timeline is shown, dashed when only some are. */}
        <label htmlFor={`${id}-all`} className={`${classes.option} ${classes.selectAll}`}>
          <Checkbox
            id={`${id}-all`}
            size="xs"
            radius={0}
            checked={everyShown}
            indeterminate={!everyShown && shown > 0}
            // Show all, or hide all when every one is already shown.
            onChange={() => onChange(new Set(everyShown ? timelines.map((t) => t.id) : []))}
          />
          <span className={classes.optionName}>Select all</span>
        </label>

        <div className={classes.list}>
          {timelines.map((t) => (
            // The whole row is the label, so a click anywhere on it flips the box.
            <label key={t.id} htmlFor={`${id}-${t.id}`} className={classes.option} title={t.name}>
              <Checkbox
                id={`${id}-${t.id}`}
                size="xs"
                radius={0}
                checked={!hidden.has(t.id)}
                onChange={() => onChange(toggleTimeline(hidden, t.id))}
              />
              <span className={classes.optionName}>{t.name}</span>
            </label>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
