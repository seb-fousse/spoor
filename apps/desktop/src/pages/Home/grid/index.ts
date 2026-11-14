/**
 * Home's timeline grid, and what the rest of Home uses from it. Inside, by concern:
 * - `TimelineGrid`: the grid's frame (day headers, hour gutter, scroller) and its wiring
 * - `blocks/`: what the day columns draw: blocks, ghosts, the now line, the day badges
 * - `layout/`: where blocks go, and where the pointer is, in time and on screen
 * - `useGridData`: what the grid draws, from the time zone and `@data/timelines`' reads
 * - `edit/`: drawing, moving, resizing and splitting blocks, and a selected block's keys
 * - `clipboard/`: copying a block and pasting it elsewhere
 * - `menus/`: the right-click menus and the category picker
 * - `filter/`: which timelines the grid shows
 */
export { TimelineFilter } from "./filter/TimelineFilter";
export type { HiddenTimelines } from "./filter/timelineVisibility";
export { TimelineGrid } from "./TimelineGrid";
export { type GridData, useGridData } from "./useGridData";
