import { FluidSplitter } from "@components/FluidSplitter";
import { Splitter, Stack, Text, Title } from "@mantine/core";

/**
 * Home: a timeline on the left (70%) and a side column on the right (at least
 * 30%), split evenly between the day's observations above and an entry point
 * for adding logs below. All placeholders for now.
 */
export function Home() {
  return (
    // Fill the whole area above the bottom bar.
    <FluidSplitter h="calc(100dvh - var(--app-shell-footer-height))">
      <Splitter.Pane defaultSize={70} max={70}>
        <Stack gap="xs" p="md">
          <Title order={2}>Timeline</Title>
          <Text c="dimmed">Today's timeline will live here.</Text>
        </Stack>
      </Splitter.Pane>

      <Splitter.Pane defaultSize={30} min={30}>
        {/* Observations above, logs below, split evenly. */}
        <FluidSplitter orientation="vertical" h="100%">
          <Splitter.Pane defaultSize={50}>
            <Stack gap="xs" p="md">
              <Title order={3}>Observations</Title>
              <Text c="dimmed">Today's observations will live here.</Text>
            </Stack>
          </Splitter.Pane>

          <Splitter.Pane defaultSize={50}>
            <Stack gap="xs" p="md">
              <Title order={3}>Add log</Title>
              <Text c="dimmed">The entry point for adding a log will live here.</Text>
            </Stack>
          </Splitter.Pane>
        </FluidSplitter>
      </Splitter.Pane>
    </FluidSplitter>
  );
}
