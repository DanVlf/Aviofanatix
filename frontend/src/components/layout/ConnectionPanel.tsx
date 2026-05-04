import { Button, ButtonGroup, HTMLSelect } from "@blueprintjs/core";
import type { PortInfo } from "../../lib/types";

type Props = {
  ports: PortInfo[];
  selectedPort: string;
  baud: number;
  busy: boolean;
  onPortChange: (p: string) => void;
  onBaudChange: (b: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
};

export function ConnectionPanel({
  ports,
  selectedPort,
  baud,
  busy,
  onPortChange,
  onBaudChange,
  onConnect,
  onDisconnect,
  onRefresh,
}: Props) {
  return (
    <div className="connection-panel">
      <div className="connection-header">
        <span className="eyebrow">USB Connection</span>
        <h2>Serial Link</h2>
      </div>
      <div className="connection-controls">
        <div className="control-group">
          <label htmlFor="port-select">Port</label>
          <HTMLSelect
            id="port-select"
            fill
            value={selectedPort}
            onChange={(e) => onPortChange(e.target.value)}
            options={ports.map((p) => ({ label: p.label, value: p.device }))}
          />
        </div>
        <div className="control-group">
          <label htmlFor="baud-input">Baud rate</label>
          <input
            id="baud-input"
            className="bp6-input"
            type="number"
            value={baud}
            onChange={(e) => onBaudChange(Number(e.target.value))}
          />
        </div>
        <ButtonGroup>
          <Button intent="primary" loading={busy} onClick={onConnect}>
            Connect
          </Button>
          <Button intent="danger" outlined loading={busy} onClick={onDisconnect}>
            Disconnect
          </Button>
          <Button minimal onClick={onRefresh}>
            Refresh
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}
