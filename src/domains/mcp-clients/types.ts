/**
 * Typen für die MCP-Client-Discovery (v1.5,
 * Cowork-OS-Integrationsplan Feature 1).
 *
 * "Client" meint hier den **Konsumenten** eines MCP-Servers (Claude
 * Desktop oder Claude Code), nicht zu verwechseln mit `claude-os` der
 * selbst ein MCP-**Server** ist (ADR-0016). Diese Domain entdeckt
 * welche MCP-Server der User in seinen MCP-Clients konfiguriert hat
 * und gibt einen Status pro Server.
 *
 * Quellen:
 *  - Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json`
 *    (Win) bzw. `~/Library/Application Support/Claude/...` (macOS)
 *    bzw. `~/.config/Claude/...` (Linux).
 *  - Claude Code: `~/.claude/mcp.json` ODER projekt-lokales
 *    `.claude/mcp.json`.
 *
 * @module @domains/mcp-clients/types
 */

/** Welche Anwendung den MCP-Server registriert hat. */
export type McpClientHost = 'claude-desktop' | 'claude-code-user' | 'claude-code-project';

/** Wie wir den MCP-Server vom Disk geladen haben. */
export interface McpServerEntry {
  /** Server-Name aus der jeweiligen Config-Datei. */
  readonly name: string;
  /** Welche App diesen Server konfiguriert hat. */
  readonly host: McpClientHost;
  /** Pfad zur Config-Datei aus der die Entry stammt. */
  readonly sourcePath: string;
  /** Command der laut Config ausgeführt würde, z. B. "node" oder "npx". */
  readonly command: string;
  /** Args zum Command. */
  readonly args: readonly string[];
  /** Environment-Variables die der Server-Process erbt. */
  readonly env?: Readonly<Record<string, string>>;
  /** Wenn `enabled: false`, ist der Server in der Config aber deaktiviert. */
  readonly enabled?: boolean;
}

/** Status-Bewertung pro Server (read-only Static-Check, kein Live-Spawn). */
export interface McpServerStatus {
  readonly entry: McpServerEntry;
  /** Ergebnis-Klasse — siehe `ServerStatusKind`-Konstanten. */
  readonly kind: ServerStatusKind;
  /** Menschlich lesbarer Grund. */
  readonly message: string;
  /** Wenn ein konkreter Pfad geprüft wurde, hier zurück. */
  readonly resolvedCommandPath?: string;
}

export type ServerStatusKind =
  | 'ok' // Command + Args sehen plausibel aus, alle Pfade existieren
  | 'disabled' // explizit als enabled:false markiert
  | 'command-missing' // Command nicht im PATH oder Datei fehlt
  | 'arg-path-missing' // Ein Pfad-Argument existiert nicht
  | 'env-missing' // Required env-var fehlt im laufenden Prozess
  | 'unknown'; // Fehler beim Auswerten (z. B. lese-Fehler)

export interface DiscoveryResult {
  readonly servers: readonly McpServerEntry[];
  /** Pfade die geprüft, aber nicht gefunden wurden. */
  readonly missingConfigPaths: readonly string[];
  /** Pfade die existierten aber Parse-Fehler hatten. */
  readonly malformedConfigs: readonly { readonly path: string; readonly reason: string }[];
}

export class McpClientDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientDiscoveryError';
  }
}
