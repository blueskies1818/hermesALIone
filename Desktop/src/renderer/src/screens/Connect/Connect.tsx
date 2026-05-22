import { useState } from "react";
import HermesLogo from "../../components/common/HermesLogo";
import { ArrowRight, Globe, KeyRound, Monitor, Check, Spinner } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

type ConnectMode = "local" | "remote" | "ssh";

interface ConnectProps {
  savedMode?: ConnectMode;
  savedUrl?: string;
  onConnected: () => void;
}

function Connect({ savedMode, savedUrl, onConnected }: ConnectProps): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<ConnectMode>(savedMode || "local");

  // Local
  const [localTesting, setLocalTesting] = useState(false);
  const [localError, setLocalError] = useState("");

  // Remote
  const [remoteUrl, setRemoteUrl] = useState(savedMode === "remote" ? savedUrl || "" : "");
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [remoteTesting, setRemoteTesting] = useState(false);
  const [remoteError, setRemoteError] = useState("");

  // SSH
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("9119");
  const [sshTesting, setSshTesting] = useState(false);
  const [sshError, setSshError] = useState("");

  async function handleLocalConnect(): Promise<void> {
    setLocalTesting(true);
    setLocalError("");
    try {
      const ok = await window.hermesAPI.testRemoteConnection("http://127.0.0.1:9119");
      if (ok) {
        await window.hermesAPI.setConnectionConfig("local", "", "");
        onConnected();
      } else {
        setLocalError(t("connect.localNotRunning"));
      }
    } catch {
      setLocalError(t("connect.localTestFailed"));
    } finally {
      setLocalTesting(false);
    }
  }

  async function handleRemoteConnect(): Promise<void> {
    const url = remoteUrl.trim();
    if (!url) {
      setRemoteError(t("connect.urlRequired"));
      return;
    }
    setRemoteTesting(true);
    setRemoteError("");
    try {
      const ok = await window.hermesAPI.testRemoteConnection(url, remoteApiKey.trim());
      if (ok) {
        await window.hermesAPI.setConnectionConfig("remote", url, remoteApiKey.trim());
        onConnected();
      } else {
        setRemoteError(t("connect.remoteFailed"));
      }
    } catch {
      setRemoteError(t("connect.remoteTestFailed"));
    } finally {
      setRemoteTesting(false);
    }
  }

  async function handleSshConnect(): Promise<void> {
    const host = sshHost.trim();
    const user = sshUser.trim();
    if (!host || !user) {
      setSshError(t("connect.sshRequired"));
      return;
    }
    const port = parseInt(sshPort, 10) || 22;
    const remotePort = parseInt(sshRemotePort, 10) || 9119;
    setSshTesting(true);
    setSshError("");
    try {
      const ok = await window.hermesAPI.testSshConnection(
        host, port, user, sshKeyPath.trim(), remotePort,
      );
      if (ok) {
        await window.hermesAPI.setSshConfig(
          host, port, user, sshKeyPath.trim(), remotePort, 19119,
        );
        onConnected();
      } else {
        setSshError(t("connect.sshFailed"));
      }
    } catch (e) {
      setSshError(`${t("connect.sshTestFailed")}: ${(e as Error).message}`);
    } finally {
      setSshTesting(false);
    }
  }

  function renderLocalPanel(): React.JSX.Element {
    return (
      <div className="connect-panel">
        <div className="connect-panel-icon"><Monitor size={32} /></div>
        <h2 className="connect-panel-title">{t("connect.localTitle")}</h2>
        <p className="connect-panel-desc">{t("connect.localDesc")}</p>

        <div className="connect-info-box">
          <p>The Hermes Agent runs on this machine. Make sure the gateway is
          running (<code>./start.sh</code> or <code>./start.bat</code>) and
          listening on port 9119. No additional setup needed.</p>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleLocalConnect}
          disabled={localTesting}
          style={{ marginTop: 16 }}
        >
          {localTesting ? (
            <><Spinner size={14} className="animate-spin" /> {t("connect.testing")}</>
          ) : (
            <><Check size={14} /> {t("connect.connectLocal")}</>
          )}
        </button>
        {localError && <p className="connect-error">{localError}</p>}
      </div>
    );
  }

  function renderRemotePanel(): React.JSX.Element {
    return (
      <div className="connect-panel">
        <div className="connect-panel-icon"><Globe size={32} /></div>
        <h2 className="connect-panel-title">{t("connect.remoteTitle")}</h2>
        <p className="connect-panel-desc">{t("connect.remoteDesc")}</p>

        <div className="connect-info-box">
          <p>Point the desktop at a remote Hermes gateway. The remote machine
          must be running the dashboard (port 9119) and the port must be
          reachable from this machine. Set an API key if the gateway requires
          one (<code>API_SERVER_KEY</code> in <code>.env</code>). Run
          <code>hermes connect</code> in the CLI for detailed help.</p>
        </div>

        <div className="connect-form">
          <label className="connect-label">{t("connect.serverUrl")}</label>
          <input
            type="url"
            className="input"
            placeholder="http://192.168.1.100:9119"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRemoteConnect(); }}
            autoFocus
          />

          <label className="connect-label">{t("connect.apiKey")}</label>
          <input
            type="password"
            className="input"
            placeholder={t("connect.apiKeyPlaceholder")}
            value={remoteApiKey}
            onChange={(e) => setRemoteApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRemoteConnect(); }}
          />

          <button
            className="btn btn-primary"
            onClick={handleRemoteConnect}
            disabled={remoteTesting || !remoteUrl.trim()}
            style={{ marginTop: 16 }}
          >
            {remoteTesting ? (
              <><Spinner size={14} className="animate-spin" /> {t("connect.testing")}</>
            ) : (
              <><ArrowRight size={14} /> {t("connect.connect")}</>
            )}
          </button>
          {remoteError && <pre className="connect-error">{remoteError}</pre>}
          <p className="connect-hint">{t("connect.remoteHint")}</p>
        </div>
      </div>
    );
  }

  function renderSshPanel(): React.JSX.Element {
    return (
      <div className="connect-panel">
        <div className="connect-panel-icon"><KeyRound size={32} /></div>
        <h2 className="connect-panel-title">{t("connect.sshTitle")}</h2>
        <p className="connect-panel-desc">{t("connect.sshDesc")}</p>

        <div className="connect-info-box">
          <p>Connect via SSH tunnel to a remote Hermes instance. First, run
          <code>hermes ssh-keygen</code> on this machine to generate a key. Then
          run the <code>ssh-copy-id</code> command it prints to authorize the key
          on the remote host. Run <code>hermes connect</code> for detailed field
          descriptions and setup help.</p>
        </div>

        <div className="connect-form">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 3 }}>
              <label className="connect-label">{t("connect.sshHost")}</label>
              <input
                type="text"
                className="input"
                placeholder="192.168.1.100"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="connect-label">{t("connect.sshPort")}</label>
              <input
                type="number"
                className="input"
                placeholder="22"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
              />
            </div>
          </div>

          <label className="connect-label">{t("connect.sshUser")}</label>
          <input
            type="text"
            className="input"
            placeholder="hermes"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
          />

          <label className="connect-label">{t("connect.sshKeyPath")}</label>
          <input
            type="text"
            className="input"
            placeholder="~/.ssh/id_rsa"
            value={sshKeyPath}
            onChange={(e) => setSshKeyPath(e.target.value)}
          />

          <label className="connect-label">{t("connect.sshRemotePort")}</label>
          <input
            type="number"
            className="input"
            placeholder="9119"
            value={sshRemotePort}
            onChange={(e) => setSshRemotePort(e.target.value)}
          />

          <button
            className="btn btn-primary"
            onClick={handleSshConnect}
            disabled={sshTesting || !sshHost.trim() || !sshUser.trim()}
            style={{ marginTop: 16 }}
          >
            {sshTesting ? (
              <><Spinner size={14} className="animate-spin" /> {t("connect.testing")}</>
            ) : (
              <><ArrowRight size={14} /> {t("connect.connectSsh")}</>
            )}
          </button>
          {sshError && <pre className="connect-error">{sshError}</pre>}
          <p className="connect-hint">{t("connect.sshHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="connect-logo">
          <HermesLogo size={36} />
        </div>

        <div className="connect-tabs">
          <button
            className={`connect-tab ${mode === "local" ? "active" : ""}`}
            onClick={() => setMode("local")}
          >
            <Monitor size={14} />
            {t("connect.tabLocal")}
          </button>
          <button
            className={`connect-tab ${mode === "remote" ? "active" : ""}`}
            onClick={() => setMode("remote")}
          >
            <Globe size={14} />
            {t("connect.tabRemote")}
          </button>
          <button
            className={`connect-tab ${mode === "ssh" ? "active" : ""}`}
            onClick={() => setMode("ssh")}
          >
            <KeyRound size={14} />
            {t("connect.tabSsh")}
          </button>
        </div>

        {mode === "local" && renderLocalPanel()}
        {mode === "remote" && renderRemotePanel()}
        {mode === "ssh" && renderSshPanel()}
      </div>
    </div>
  );
}

export default Connect;
