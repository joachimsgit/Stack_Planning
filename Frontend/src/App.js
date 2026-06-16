import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import NotFound from "./pages/NotFound";
import HomePage from "./pages/HomePage";
import StackEditorPage from "./pages/StackEditorPage";
import { MantineProvider, ColorSchemeProvider } from "@mantine/core";
import { useHotkeys, useLocalStorage } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import { pingActivity } from "./utils/api";

const HEARTBEAT_MS = 30000;

function App() {
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: "mantine-color-scheme",
    defaultValue: "light",
    getInitialValueInEffect: true,
  });

  const toggleColorScheme = (value) =>
    setColorScheme(value || (colorScheme === "dark" ? "light" : "dark"));

  useHotkeys([["mod+J", () => toggleColorScheme()]]);

  // Presence heartbeat: ping on load, on a timer while the tab is visible, and
  // whenever the tab regains focus. Lets the /activity endpoint report who is
  // currently using the site (see the Options drawer) so the server can be
  // rebuilt without interrupting an active session.
  useEffect(() => {
    const ping = () => pingActivity(window.location.pathname);
    ping();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <ColorSchemeProvider
      colorScheme={colorScheme}
      toggleColorScheme={toggleColorScheme}
    >
      <MantineProvider
        theme={{
          colorScheme,
          focusRing: "never",
        }}
        withGlobalStyles
        withNormalizeCSS
        withCSSVariables
      >
        <Notifications />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/stack/:id" element={<StackEditorPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MantineProvider>
    </ColorSchemeProvider>
  );
}

export default App;
