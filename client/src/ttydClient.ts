// Cliente do protocolo WebSocket do ttyd, reimplementado a partir da fonte
// oficial (tsl0922/ttyd, html/src/components/terminal/xterm/index.ts) —
// versão mínima: sem zmodem/sixel/renderer switching, só input/output/resize.
//
// AuthToken sempre vai vazio: o endpoint /token não manda CORS header (fetch
// cross-origin falharia dentro do webview do Tauri), e nossas instâncias de
// ttyd não usam `-c` (credential), então o token real também é sempre "".
// Se algum dia configurarmos auth no ttyd, isso precisa de outra abordagem
// (ex: proxy pelo lado Rust do Tauri, que não sofre CORS).

const ServerCommand = {
  Output: "0",
  SetWindowTitle: "1",
  SetPreferences: "2",
} as const;

const ClientCommand = {
  Input: "0",
  ResizeTerminal: "1",
} as const;

export interface TtydClientCallbacks {
  onOutput: (data: Uint8Array) => void;
  onTitleChange?: (title: string) => void;
  onClose?: (event: CloseEvent) => void;
}

export class TtydClient {
  private socket?: WebSocket;
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly callbacks: TtydClientCallbacks,
  ) {}

  private get wsUrl(): string {
    return `ws://${this.host}:${this.port}/ws`;
  }

  connect(columns: number, rows: number): void {
    const socket = new WebSocket(this.wsUrl, ["tty"]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      const handshake = JSON.stringify({ AuthToken: "", columns, rows });
      socket.send(this.textEncoder.encode(handshake));
    });
    socket.addEventListener("message", (event) => {
      this.handleMessage(event as MessageEvent<ArrayBuffer>);
    });
    socket.addEventListener("close", (event) => this.callbacks.onClose?.(event));
  }

  private handleMessage(event: MessageEvent<ArrayBuffer>): void {
    const raw = new Uint8Array(event.data);
    const command = String.fromCharCode(raw[0]);
    const payload = raw.slice(1);

    switch (command) {
      case ServerCommand.Output:
        this.callbacks.onOutput(payload);
        break;
      case ServerCommand.SetWindowTitle:
        this.callbacks.onTitleChange?.(this.textDecoder.decode(payload));
        break;
      case ServerCommand.SetPreferences:
        // Preferências do servidor (fonte/tema) ignoradas por enquanto —
        // o cliente define as próprias no terminalView.
        break;
      default:
        console.warn(`[ultron] comando desconhecido do ttyd: ${command}`);
    }
  }

  sendInput(data: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const encoded = this.textEncoder.encode(data);
    const payload = new Uint8Array(encoded.length + 1);
    payload[0] = ClientCommand.Input.charCodeAt(0);
    payload.set(encoded, 1);
    this.socket.send(payload);
  }

  sendResize(columns: number, rows: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const message = ClientCommand.ResizeTerminal + JSON.stringify({ columns, rows });
    this.socket.send(this.textEncoder.encode(message));
  }

  dispose(): void {
    this.socket?.close(1000);
  }
}
