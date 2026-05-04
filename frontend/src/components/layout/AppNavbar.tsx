import { Tag } from "@blueprintjs/core";
import { useTheme } from "../../context/ThemeContext";

type Props = {
  streamOnline: boolean;
  apiBase: string;
};

export function AppNavbar({ streamOnline, apiBase }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <nav className="app-navbar">
      <div className="app-title">
        <img
          className="brand-logo"
          src="https://aviofanatix.com/lovable-uploads/logo-dark.png"
          alt="Aviofanatix"
        />
        <div className="app-title-copy">
          <span className="eyebrow">FPV Ground View</span>
          <h1>Telemetry Console</h1>
        </div>
      </div>
      <div className="nav-status">
        <Tag intent={streamOnline ? "success" : "warning"} round large>
          {streamOnline ? "Stream online" : "Reconnecting"}
        </Tag>
        <Tag round large minimal>
          {apiBase}
        </Tag>
        <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
          {theme === "light" ? "🌙" : "☀️"}
        </button>
      </div>
    </nav>
  );
}
