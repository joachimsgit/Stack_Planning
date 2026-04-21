import "./AppHeader.css";
import { useState } from "react";
import {
  Group,
  Header,
  Stack,
  Button,
  useMantineColorScheme,
  Drawer,
  Text,
  Divider,
  Table,
} from "@mantine/core";
import {
  IconSun,
  IconMoonStars,
  IconDatabase,
  IconDatabaseExport,
  IconSettings,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

const BACKEND_BASE = (process.env.REACT_APP_STACK_BACKEND_URL || "http://localhost:5000/").replace(/\/$/, "");

const KEYBOARD_SHORTCUTS = [
  { keys: "Z + Scroll wheel", action: "Zoom canvas in / out" },
  { keys: "R + Scroll wheel", action: "Rotate active layer" },
  { keys: "T + Scroll wheel", action: "Cycle through layers" },
  { keys: "Ctrl + J", action: "Toggle colour scheme" },
];

function AppHeader({ rightSection }) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <>
      <Header className="appHeader">
        <div className="appHeaderDiv">
          <Group position="apart">
            <Stack spacing="0" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
              <span className="appHeaderTextMain">Stack Planning</span>
              <span className="appHeaderTextSubtext">
                2D Material Heterostructure Planner
              </span>
            </Stack>
            <Group>
              {rightSection}
              <Button
                component="a"
                leftIcon={<IconDatabase size="1rem" />}
                variant="default"
                href="http://134.61.8.242/"
                target="_blank"
              >
                Flake Database
              </Button>
              <Button
                variant="default"
                leftIcon={<IconSettings size="1rem" />}
                onClick={() => setOptionsOpen(true)}
              >
                Options
              </Button>
            </Group>
          </Group>
        </div>
      </Header>

      <Drawer
        opened={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Options"
        position="right"
        padding="xl"
        size="md"
      >
        <Stack spacing="lg">
          <div>
            <Text weight={600} size="sm" mb="xs">Appearance</Text>
            <Button
              fullWidth
              variant="default"
              leftIcon={colorScheme === "dark" ? <IconSun size="1rem" /> : <IconMoonStars size="1rem" />}
              onClick={() => toggleColorScheme()}
            >
              Toggle colour scheme
              <Text size="xs" color="dimmed" ml="auto">Ctrl+J</Text>
            </Button>
          </div>

          <Divider />

          <div>
            <Text weight={600} size="sm" mb="xs">Database</Text>
            <Button
              component="a"
              fullWidth
              variant="default"
              leftIcon={<IconDatabaseExport size="1rem" />}
              href={`${BACKEND_BASE}/backup/download`}
              download
            >
              Backup DB
            </Button>
          </div>

          <Divider />

          <div>
            <Text weight={600} size="sm" mb="xs">Keyboard shortcuts</Text>
            <Table striped highlightOnHover fontSize="sm">
              <thead>
                <tr>
                  <th>Keys</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {KEYBOARD_SHORTCUTS.map(({ keys, action }) => (
                  <tr key={keys}>
                    <td>
                      <Text component="span" className="shortcutKey">{keys}</Text>
                    </td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Stack>
      </Drawer>
    </>
  );
}

export default AppHeader;
