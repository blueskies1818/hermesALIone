import { useState, useEffect, useCallback } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./screens/Layout/Layout";
import Connect from "./screens/Connect/Connect";

type ConnectionState = "loading" | "connect" | "connected";

interface SavedConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
}

function App(): React.JSX.Element {
  const isMac = window.electron?.process?.platform === "darwin";
  const [connState, setConnState] = useState<ConnectionState>("loading");
  const [savedConfig, setSavedConfig] = useState<SavedConfig | null>(null);

  // Check connection on mount
  useEffect(() => {
    window.hermesAPI
      .getConnectionConfig()
      .then((config) => {
        if (config.mode === "local") {
          // For local mode, try probing the API server
          return window.hermesAPI
            .testRemoteConnection("http://127.0.0.1:9119")
            .then((ok) => {
              if (ok) {
                setConnState("connected");
              } else {
                setSavedConfig({ mode: "local", remoteUrl: "" });
                setConnState("connect");
              }
            })
            .catch(() => {
              setSavedConfig({ mode: "local", remoteUrl: "" });
              setConnState("connect");
            });
        }

        // For remote/SSH mode, check if we have saved config
        setSavedConfig({
          mode: config.mode,
          remoteUrl: config.remoteUrl || "",
        });
        setConnState("connect");
      })
      .catch(() => {
        setConnState("connect");
      });
  }, []);

  const handleConnected = useCallback(() => {
    setConnState("connected");
  }, []);

  if (connState === "loading") {
    return (
      <ThemeProvider>
        <div className="app">
          {isMac && <div className="drag-region" />}
          <div className="app-content">
            <div className="loading-screen screen">
              <div className="loading-spinner" />
            </div>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if (connState === "connect") {
    return (
      <ThemeProvider>
        <ErrorBoundary>
          <div className="app">
            {isMac && <div className="drag-region" />}
            <div className="app-content">
              <Connect
                savedMode={savedConfig?.mode}
                savedUrl={savedConfig?.remoteUrl}
                onConnected={handleConnected}
              />
            </div>
          </div>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div className="app">
          {isMac && <div className="drag-region" />}
          <div className="app-content">
            <Layout onDisconnect={() => setConnState("connect")} />
          </div>
        </div>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
