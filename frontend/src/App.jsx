import { useState } from "react";
import { AppShell, Burger, Group, NavLink, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChartLine, IconScan } from "@tabler/icons-react";
import BackendStatus from "./components/BackendStatus.jsx";
import DetectionView from "./pages/DetectionView.jsx";
import HistoryView from "./pages/HistoryView.jsx";

const PAGES = {
  detect: { label: "Detect", Icon: IconScan },
  history: { label: "History", Icon: IconChartLine },
};

// Two pages don't justify a router dependency; plain state is enough. If deep links
// are ever needed, swap this for react-router without touching the pages.
export default function App() {
  const [page, setPage] = useState("detect");
  const [navOpen, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  return (
    <AppShell
      // The header only exists below sm (burger); reserving its height on desktop left an
      // empty 56px band above the sidebar and the page.
      header={{ height: { base: 56, sm: 0 } }}
      navbar={{ width: 248, breakpoint: "sm", collapsed: { mobile: !navOpen } }}
      padding="lg"
    >
      {/* Header only shows on small screens, where the sidebar collapses. */}
      <AppShell.Header hiddenFrom="sm" px="md">
        <Group h="100%" gap="sm">
          <Burger
            opened={navOpen}
            onClick={toggleNav}
            size="sm"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
          />
          <Text fw={700}>Detecto</Text>
        </Group>
      </AppShell.Header>

      {/* An aside, not Mantine's default <nav>: the labelled "Pages" nav inside it should
          be the only navigation landmark. */}
      <AppShell.Navbar p="md" component="aside" id="app-sidebar">
        <Stack gap="lg" h="100%">
          <Group gap="sm" px={8} pt={4} wrap="nowrap">
            <ThemeIcon variant="light" size={34} radius="md" aria-hidden>
              <IconScan size={19} stroke={2} />
            </ThemeIcon>
            <div>
              <Title order={1} size="h4" lh={1.2}>
                Detecto
              </Title>
              <Text size="xs" c="dimmed">
                People detection
              </Text>
            </div>
          </Group>

          <nav aria-label="Pages">
            <Stack gap={4}>
              {Object.entries(PAGES).map(([key, { label, Icon }]) => (
                <NavLink
                  key={key}
                  component="button"
                  type="button"
                  label={label}
                  leftSection={<Icon size={18} stroke={2} />}
                  active={page === key}
                  aria-current={page === key ? "page" : undefined}
                  onClick={() => {
                    setPage(key);
                    closeNav();
                  }}
                  styles={{ root: { borderRadius: "var(--mantine-radius-md)", minHeight: 44 } }}
                  fw={page === key ? 600 : 500}
                />
              ))}
            </Stack>
          </nav>

          <div style={{ marginTop: "auto" }}>
            <BackendStatus />
          </div>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--detecto-ground)">
        {/* Detect stays mounted (just hidden) so its result — or a detection still in
            flight — survives a visit to History. History mounts per visit, so it
            always shows fresh data. */}
        <div hidden={page !== "detect"}>
          <DetectionView />
        </div>
        {page === "history" && <HistoryView onNavigate={setPage} />}
      </AppShell.Main>
    </AppShell>
  );
}
