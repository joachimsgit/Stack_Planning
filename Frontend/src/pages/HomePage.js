import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppShell,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Navbar,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  ActionIcon,
  UnstyledButton,
} from "@mantine/core";
import { IconPlus, IconTrash, IconLayersIntersect, IconUser } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import AppHeader from "../components/AppHeader/AppHeader";
import { fetchStacks, createStack, deleteStack, fetchUsers, createUser } from "../utils/api";

function formatDate(unixTs) {
  if (!unixTs) return "";
  return new Date(unixTs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function UserNavItem({ label, count, active, onClick }) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "6px 8px",
        borderRadius: 4,
        marginBottom: 2,
        background: active ? "var(--mantine-color-blue-light, #e7f5ff)" : "transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      <Text size="sm" lineClamp={1} style={{ flex: 1 }}>{label}</Text>
      <Badge size="xs" variant="filled" color={active ? "blue" : "gray"} ml={4}>
        {count}
      </Badge>
    </UnstyledButton>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [stacks, setStacks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("all"); // "all" | "unassigned" | number id as string
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUserId, setNewUserId] = useState(null); // string id or "new:name"
  const [userSelectData, setUserSelectData] = useState([]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    Promise.all([fetchStacks(), fetchUsers()])
      .then(([stacksData, usersData]) => {
        setStacks(stacksData);
        setUsers(usersData);
        setUserSelectData(usersData.map((u) => ({ value: String(u.id), label: u.name })));
      })
      .catch(() =>
        notifications.show({ color: "red", message: "Could not load data" })
      )
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      let resolvedUserId = null;
      if (newUserId) {
        if (newUserId.startsWith("new:")) {
          const name = newUserId.slice(4);
          const user = await createUser(name);
          resolvedUserId = user.id;
          // Add to local user list if truly new
          setUsers((prev) =>
            prev.find((u) => u.id === user.id) ? prev : [...prev, user]
          );
          setUserSelectData((prev) =>
            prev.find((u) => u.value === String(user.id))
              ? prev
              : [...prev, { value: String(user.id), label: user.name }]
          );
        } else {
          resolvedUserId = parseInt(newUserId, 10);
        }
      }
      const stack = await createStack(newName.trim(), "", resolvedUserId);
      navigate(`/stack/${stack.id}`);
    } catch {
      notifications.show({ color: "red", message: "Failed to create stack" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteStack(deleteTarget.id);
      setStacks((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    } catch {
      notifications.show({ color: "red", message: "Failed to delete stack" });
    } finally {
      setDeleteTarget(null);
    }
  };

  // Derive filtered stacks
  const visibleStacks =
    selectedUserId === "all"
      ? stacks
      : selectedUserId === "unassigned"
      ? stacks.filter((s) => s.user_id == null)
      : stacks.filter((s) => String(s.user_id) === selectedUserId);

  const unassignedCount = stacks.filter((s) => s.user_id == null).length;

  const userNav = (
    <Navbar
      width={{ base: 200 }}
      height="calc(100vh - 5rem)"
      p="xs"
      style={{
        top: "5rem",
        borderRight: "1px solid var(--mantine-color-gray-3, #dee2e6)",
      }}
    >
      <Navbar.Section grow component={ScrollArea}>
        <Text size="xs" weight={600} color="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Users
        </Text>

        <UserNavItem
          label="All stacks"
          count={stacks.length}
          active={selectedUserId === "all"}
          onClick={() => setSelectedUserId("all")}
        />

        {users.map((u) => (
          <UserNavItem
            key={u.id}
            label={u.name}
            count={stacks.filter((s) => s.user_id === u.id).length}
            active={selectedUserId === String(u.id)}
            onClick={() => setSelectedUserId(String(u.id))}
          />
        ))}

        {unassignedCount > 0 && (
          <UserNavItem
            label="Unassigned"
            count={unassignedCount}
            active={selectedUserId === "unassigned"}
            onClick={() => setSelectedUserId("unassigned")}
          />
        )}
      </Navbar.Section>
    </Navbar>
  );

  return (
    <AppShell
      header={
        <AppHeader
          rightSection={
            <Button
              leftIcon={<IconPlus size="1rem" />}
              onClick={() => {
                setNewName("");
                setNewUserId(null);
                setCreateOpen(true);
              }}
            >
              New Stack
            </Button>
          }
        />
      }
      navbar={userNav}
      styles={(theme) => ({
        main: {
          backgroundColor:
            theme.colorScheme === "dark"
              ? theme.colors.dark[8]
              : theme.colors.gray[0],
          height: "calc(100vh - 5rem)",
          overflowY: "auto",
          paddingTop: "1.5rem",
        },
      })}
    >
      {loading ? (
        <Center style={{ height: "60vh" }}>
          <Loader />
        </Center>
      ) : visibleStacks.length === 0 ? (
        <Center style={{ height: "60vh" }}>
          <Stack align="center" spacing="md">
            <IconLayersIntersect size={64} opacity={0.3} />
            <Title order={3} color="dimmed">
              No stacks
            </Title>
            <Text color="dimmed">
              {selectedUserId === "all"
                ? <>Click <b>New Stack</b> to start planning your first heterostructure.</>
                : "No stacks for this selection."}
            </Text>
          </Stack>
        </Center>
      ) : (
        <div style={{ padding: "0 5%", paddingBottom: "2rem" }}>
          {selectedUserId === "all" ? (
            // Group by user when showing all
            [
              ...users.filter((u) => stacks.some((s) => s.user_id === u.id)),
              ...(unassignedCount > 0 ? [{ id: null, name: "Unassigned" }] : []),
            ].map((u) => {
              const group = stacks.filter((s) =>
                u.id === null ? s.user_id == null : s.user_id === u.id
              );
              if (group.length === 0) return null;
              return (
                <div key={u.id ?? "unassigned"} style={{ marginBottom: "2rem" }}>
                  <Group spacing={6} mb="sm">
                    <IconUser size={14} style={{ opacity: 0.5 }} />
                    <Text weight={600} size="sm">{u.name}</Text>
                    <Badge size="xs" variant="light">{group.length}</Badge>
                  </Group>
                  <StackGrid
                    stacks={group}
                    onNavigate={(id) => navigate(`/stack/${id}`)}
                    onDelete={setDeleteTarget}
                  />
                </div>
              );
            })
          ) : (
            <StackGrid
              stacks={visibleStacks}
              onNavigate={(id) => navigate(`/stack/${id}`)}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
      )}

      {/* Create Stack Modal */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Stack"
        centered
      >
        <Stack spacing="md">
          <TextInput
            label="Stack name"
            placeholder="e.g. WSe2/Graphene/hBN"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <Select
            label="User"
            placeholder="Select or type to create"
            data={userSelectData}
            value={newUserId}
            onChange={setNewUserId}
            searchable
            clearable
            creatable
            getCreateLabel={(query) => `+ Add "${query}"`}
            onCreate={(query) => {
              const item = { value: `new:${query}`, label: query };
              setUserSelectData((prev) => [...prev, item]);
              return item;
            }}
          />
          <Group position="right">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={creating}
              disabled={!newName.trim()}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Stack"
        centered
      >
        <Stack spacing="md">
          <Text>
            Delete <b>{deleteTarget?.name}</b>? This cannot be undone.
          </Text>
          <Group position="right">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AppShell>
  );
}

function StackGrid({ stacks, onNavigate, onDelete }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "1rem",
      }}
    >
      {stacks.map((stack) => (
        <Card
          key={stack.id}
          shadow="sm"
          padding="lg"
          radius="md"
          withBorder
          style={{ cursor: "pointer" }}
          onClick={() => onNavigate(stack.id)}
        >
          <Group position="apart" mb="xs">
            <Text weight={600} size="md" lineClamp={1} style={{ flex: 1 }}>
              {stack.name}
            </Text>
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(stack);
              }}
            >
              <IconTrash size="1rem" />
            </ActionIcon>
          </Group>
          <Group spacing="xs">
            <Badge color="blue" variant="light">
              {stack.layer_count} layer{stack.layer_count !== 1 ? "s" : ""}
            </Badge>
            <Text size="xs" color="dimmed">
              {formatDate(stack.created_at)}
            </Text>
          </Group>
          {stack.username && (
            <Group spacing={4} mt={6}>
              <IconUser size={11} style={{ opacity: 0.4 }} />
              <Text size="xs" color="dimmed">{stack.username}</Text>
            </Group>
          )}
        </Card>
      ))}
    </div>
  );
}

export default HomePage;
