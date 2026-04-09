import { useState, useEffect, type ReactNode } from "react";
import { AuthModule } from "./components/AuthModule";
import { ContactsModule } from "./components/ContactsModule";
import { MessagesModule } from "./components/MessagesModule";
import { ScheduleModule } from "./components/ScheduleModule";
import { LoginPage } from "./pages/LoginPage";
import { Button } from "./components/ui/Button";
import { CampaignSelect } from "./components/ui/CampaignSelect";
import { useAuthStore } from "./store/authStore";
import { useCampaignStore } from "./store/campaignStore";
import { useNumbers } from "./store/numbersStore";
import { useApi } from "./hooks/useApi";

// ── Ícones SVG ────────────────────────────────────────────────────────────────
const iconStyle: React.CSSProperties = {
  display: "block",
  transition: "transform 0.2s ease",
};

function IconNumbers() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={iconStyle}
    >
      <rect
        x="5"
        y="3"
        width="6"
        height="18"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M13 7h4M13 12h6M13 17h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 8h2M5 12h2M5 16h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconContacts() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={iconStyle}
    >
      <rect
        x="4"
        y="3"
        width="12"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="10" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.5 18c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17 7h3M17 12h3M17 17h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMessages() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={iconStyle}
    >
      <path
        d="M4 5h12a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 3V7a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M20 8h0a2 2 0 012 2v5a2 2 0 01-2 2h-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8 10h6M8 13h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconDispatch() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={iconStyle}
    >
      <path
        d="M20 4L3 11l7 3 3 7 7-17z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 14l4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogo() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={iconStyle}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6 12L18 7l-5 11-2.5-5L6 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface AppProps {
  embedMode?: boolean;
  hideModules?: string[];
  readOnly?: boolean;
}

export function App({
  embedMode = false,
  hideModules = [],
  readOnly = false,
}: AppProps) {
  const [tab, setTab] = useState<"auth" | "contacts" | "messages" | "schedule">(
    "auth"
  );
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const { user, setUser } = useAuthStore();
  const {
    campaigns,
    setCampaigns,
    activeCampaign,
    setActiveCampaign,
    addCampaign,
  } = useCampaignStore();
  const { setNumbers, setLoading } = useNumbers();
  const { get, post } = useApi();

  useEffect(() => {
    get("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setAuthed(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    get("/api/numbers")
      .then(setNumbers)
      .finally(() => setLoading(false));
    get("/api/campaigns").then(setCampaigns);
  }, [authed]);

  async function logout() {
    await post("/api/auth/logout", {});
    setUser(null);
    setAuthed(false);
  }

  async function createCampaign() {
    const name = prompt("Nome da campanha:");
    if (!name) return;
    const c = await post("/api/campaigns", { name });
    addCampaign(c);
    setActiveCampaign(c);
    setTab("contacts");
  }

  if (checking) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "var(--text-secondary)" }}>Carregando...</div>
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  type Tab = "auth" | "contacts" | "messages" | "schedule";
  const visibleTabs = (
    [
      { key: "auth" as Tab, label: "Números", icon: <IconNumbers /> },
      { key: "contacts" as Tab, label: "Contatos", icon: <IconContacts /> },
      { key: "messages" as Tab, label: "Mensagens", icon: <IconMessages /> },
      { key: "schedule" as Tab, label: "Disparo", icon: <IconDispatch /> },
    ] as { key: Tab; label: string; icon: ReactNode }[]
  ).filter((t) => !hideModules.includes(t.key));

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: embedMode ? "transparent" : "var(--bg-base)",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "0 20px",
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: "1px solid var(--glass-border)",
          background: "rgba(13,13,15,0.8)",
          backdropFilter: "blur(20px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "-0.01em",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <IconLogo /> RCS Dispatcher
        </span>

        {/* Segmented control de tabs */}
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--glass-bg)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {visibleTabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "6px 14px",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background:
                  tab === key ? "rgba(255,255,255,0.12)" : "transparent",
                color:
                  tab === key ? "var(--text-primary)" : "var(--text-secondary)",
                transition: "all var(--transition)",
              }}
              onMouseEnter={(e) => {
                const svg = (e.currentTarget as HTMLElement).querySelector(
                  "svg"
                );
                if (svg) svg.style.transform = "translateY(-1px) scale(1.1)";
              }}
              onMouseLeave={(e) => {
                const svg = (e.currentTarget as HTMLElement).querySelector(
                  "svg"
                );
                if (svg) svg.style.transform = "";
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Campanhas */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            overflow: "visible",
          }}
        >
          {campaigns.length > 0 && (
            <CampaignSelect
              campaigns={campaigns}
              value={activeCampaign?.id}
              onChange={(id) => {
                const c = id
                  ? (campaigns.find((x) => x.id === id) ?? null)
                  : null;
                setActiveCampaign(c);
              }}
            />
          )}

          {!readOnly && (
            <Button variant="secondary" size="sm" onClick={createCampaign}>
              + Nova campanha
            </Button>
          )}
        </div>

        {/* User */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {user?.email}
          </span>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={logout}>
              Sair
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          flex: 1,
          padding: "24px 20px",
          maxWidth: 1024,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {tab === "auth" && <AuthModule />}
        {tab === "contacts" && <ContactsModule />}
        {tab === "messages" && <MessagesModule />}
        {tab === "schedule" && <ScheduleModule />}
      </main>
    </div>
  );
}
