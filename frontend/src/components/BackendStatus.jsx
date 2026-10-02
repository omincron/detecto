import { useEffect, useState } from "react";
import { Box, Group, Paper, Text } from "@mantine/core";
import { API_BASE_URL, checkHealth } from "../api/client.js";

const POLL_MS = 30_000;

const STATES = {
  checking: { color: "#9aa3b2", label: "Checking backend…", hint: "Contacting the detection server" },
  online: { color: "#2f9e6b", label: "Backend online", hint: "Ready to detect" },
  offline: { color: "#d4622e", label: "Backend offline", hint: `Can't reach ${API_BASE_URL}` },
};

/** Sidebar card showing whether /health answers; re-checks every 30 s. */
export default function BackendStatus() {
  const [state, setState] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await checkHealth();
      if (!cancelled) setState(ok ? "online" : "offline");
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const { color, label, hint } = STATES[state];
  return (
    // aria-live (not role="status") announces changes without competing with the page's
    // own "Detecting people…" status region.
    <Paper withBorder p="sm" radius="md" aria-live="polite" data-testid="backend-status">
      <Group gap={8} wrap="nowrap">
        <Box w={8} h={8} style={{ borderRadius: "50%", background: color, flexShrink: 0 }} />
        <Text size="sm" fw={600}>
          {label}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {hint}
      </Text>
    </Paper>
  );
}
