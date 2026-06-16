import "./AppHeader.css";
import { useState, useEffect, useCallback } from "react";
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
  Modal,
  List,
  ThemeIcon,
  Title,
  Badge,
  Loader,
  ActionIcon,
} from "@mantine/core";
import {
  IconSun,
  IconMoonStars,
  IconDatabase,
  IconDatabaseExport,
  IconSettings,
  IconBrain,
  IconHelpCircle,
  IconLayersIntersect,
  IconPhoto,
  IconKeyboard,
  IconHandClick,
  IconBrush,
  IconUsers,
  IconRefresh,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { fetchActivity } from "../../utils/api";

const BACKEND_BASE = (process.env.REACT_APP_STACK_BACKEND_URL || "http://localhost:5000/").replace(/\/$/, "");

const ACTIVITY_WINDOW_MIN = 5;

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
  const [helpOpen, setHelpOpen] = useState(false);

  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);

  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityError(false);
    fetchActivity(ACTIVITY_WINDOW_MIN)
      .then(setActivity)
      .catch(() => setActivityError(true))
      .finally(() => setActivityLoading(false));
  }, []);

  // Refresh the active-session list whenever the Options drawer is opened.
  useEffect(() => {
    if (optionsOpen) loadActivity();
  }, [optionsOpen, loadActivity]);

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
                component="a"
                leftIcon={<IconBrain size="1rem" />}
                variant="default"
                href="http://134.61.8.242:8000/"
                target="_blank"
              >
                MaskTerial Training
              </Button>
              <Button
                variant="default"
                leftIcon={<IconHelpCircle size="1rem" />}
                onClick={() => setHelpOpen(true)}
              >
                Help
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

      <Modal
        opened={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={<Title order={4}>How to use Stack Planning</Title>}
        size="lg"
        centered
      >
        <Stack spacing="lg">
          <Text size="sm" color="dimmed">
            Stack Planning lets you visually compose 2D-material heterostructures by
            overlaying microscope images of flakes from the 2DMatGMM catalogue.
          </Text>

          <div>
            <Group spacing={6} mb={4}>
              <ThemeIcon size="sm" variant="light" color="blue"><IconLayersIntersect size={14} /></ThemeIcon>
              <Text weight={600} size="sm">1. Create a stack</Text>
            </Group>
            <Text size="sm">
              On the home page click <b>New Stack</b>, give it a name and assign a user.
              Stacks are grouped by user in the sidebar.
            </Text>
          </div>

          <div>
            <Group spacing={6} mb={4}>
              <ThemeIcon size="sm" variant="light" color="blue"><IconPhoto size={14} /></ThemeIcon>
              <Text weight={600} size="sm">2. Add layers</Text>
            </Group>
            <List size="sm" spacing={2}>
              <List.Item>Open a stack and click <b>+</b> in the layer panel to pick a flake from the GMM database.</List.Item>
              <List.Item>Type a 6-digit <b>Flake ID</b> in the header to add a known flake directly.</List.Item>
              <List.Item>Use <b>Import Image</b> to upload your own microscope image as a layer.</List.Item>
              <List.Item>Draw rectangles or polygons via the shape tools on the canvas toolbar.</List.Item>
            </List>
          </div>

          <div>
            <Group spacing={6} mb={4}>
              <ThemeIcon size="sm" variant="light" color="blue"><IconHandClick size={14} /></ThemeIcon>
              <Text weight={600} size="sm">3. Position layers</Text>
            </Group>
            <List size="sm" spacing={2}>
              <List.Item>Click a layer on the canvas (or in the left panel) to select it.</List.Item>
              <List.Item>Drag to move; Ctrl/Cmd-click to multi-select and move several layers together.</List.Item>
              <List.Item>Use the layer panel to reorder, hide, rename, delete or adjust opacity / contrast.</List.Item>
            </List>
          </div>

          <div>
            <Group spacing={6} mb={4}>
              <ThemeIcon size="sm" variant="light" color="blue"><IconBrush size={14} /></ThemeIcon>
              <Text weight={600} size="sm">4. Refine masks</Text>
            </Group>
            <Text size="sm">
              Open a flake layer's mask editor to refine the segmentation with the watershed tool —
              useful when GMM's automatic mask isn't tight enough for stack planning.
            </Text>
          </div>

          <Divider />

          <div>
            <Group spacing={6} mb={4}>
              <ThemeIcon size="sm" variant="light" color="gray"><IconKeyboard size={14} /></ThemeIcon>
              <Text weight={600} size="sm">Keyboard shortcuts</Text>
            </Group>
            <Table fontSize="sm">
              <tbody>
                {KEYBOARD_SHORTCUTS.map(({ keys, action }) => (
                  <tr key={keys}>
                    <td style={{ width: "45%" }}>
                      <Text component="span" className="shortcutKey">{keys}</Text>
                    </td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <Text size="xs" color="dimmed">
            Need to back up your data or change appearance? Open <b>Options</b> in the header.
          </Text>
        </Stack>
      </Modal>

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
            <Group position="apart" mb="xs">
              <Group spacing={6}>
                <IconUsers size={16} />
                <Text weight={600} size="sm">Active sessions</Text>
                {activity && (
                  <Badge color={activity.active_count > 0 ? "green" : "gray"} variant="filled">
                    {activity.active_count}
                  </Badge>
                )}
              </Group>
              <ActionIcon variant="subtle" onClick={loadActivity} title="Refresh" loading={activityLoading}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Group>

            <Text size="xs" color="dimmed" mb="xs">
              Browsers active in the last {ACTIVITY_WINDOW_MIN} min. Check this is
              empty (only you) before rebuilding the container.
            </Text>

            {activityLoading && !activity ? (
              <Group spacing="xs"><Loader size="xs" /><Text size="xs" color="dimmed">Loading…</Text></Group>
            ) : activityError ? (
              <Text size="xs" color="red">Could not load activity.</Text>
            ) : activity && activity.sessions.length > 0 ? (
              <Table fontSize="xs" verticalSpacing={4}>
                <thead>
                  <tr><th>Client</th><th>Viewing</th><th>Last seen</th></tr>
                </thead>
                <tbody>
                  {activity.sessions.map((s) => (
                    <tr key={s.ip}>
                      <td>{s.ip}</td>
                      <td>{s.last_path || "—"}</td>
                      <td>{s.seconds_ago < 60 ? `${Math.round(s.seconds_ago)}s ago` : `${Math.round(s.seconds_ago / 60)}m ago`}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Text size="xs" color="dimmed">No active sessions.</Text>
            )}
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
