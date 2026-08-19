// Cliente do protocolo do relay próprio (não é mais o protocolo do ttyd —
// ver docs/11-decisao-pivo-stream-json.md e docs/12-prototipo-relay.md).

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { command?: string; description?: string; [key: string]: unknown };
  content?: unknown;
  is_error?: boolean;
  tool_use_id?: string;
  [key: string]: unknown;
}

export interface ClaudeMessage {
  role?: string;
  content?: ClaudeContentBlock[];
}

export interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: ClaudeMessage;
  session_id?: string;
  result?: string;
  status?: string;
  [key: string]: unknown;
}

type RelayMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete" }
  | { type: "turn_error"; message: string };

function isRelayMessage(value: unknown): value is RelayMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

export interface RelayClientCallbacks {
  onEvent: (event: ClaudeEvent) => void;
  onTurnComplete: () => void;
  onTurnError: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class RelayClient {
  private socket?: WebSocket;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly callbacks: RelayClientCallbacks,
  ) {}

  connect(): void {
    const socket = new WebSocket(`ws://${this.host}:${this.port}`);
    this.socket = socket;

    socket.addEventListener("open", () => this.callbacks.onConnectionChange?.(true));
    socket.addEventListener("close", () => this.callbacks.onConnectionChange?.(false));
    socket.addEventListener("message", (event) => {
      const parsed: unknown = JSON.parse(event.data as string);
      if (!isRelayMessage(parsed)) return;

      if (parsed.type === "claude_event") {
        this.callbacks.onEvent(parsed.event);
      } else if (parsed.type === "turn_complete") {
        this.callbacks.onTurnComplete();
      } else if (parsed.type === "turn_error") {
        this.callbacks.onTurnError(parsed.message);
      }
    });
  }

  sendMessage(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "user_message", text }));
  }
}
