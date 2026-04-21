import { Center, Title, Text, Stack, Button } from "@mantine/core";
import { useNavigate } from "react-router-dom";

function NotFound() {
  const navigate = useNavigate();
  return (
    <Center style={{ height: "100vh" }}>
      <Stack align="center" spacing="md">
        <Title order={1}>404</Title>
        <Text>Page not found.</Text>
        <Button onClick={() => navigate("/")}>Go Home</Button>
      </Stack>
    </Center>
  );
}

export default NotFound;
