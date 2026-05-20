/**
 * Migration-Runner — orchestriert den `claude-os migrate --from-portable`-
 * Flow.
 *
 * Phase 1 (plan): discoverPortable() + scanEnvFiles() + Plan-Bau, keine
 * FS-Mutationen. Output: `MigrationPlan` + Notes.
 *
 * Phase 2 (execute): geht die Plan-Steps sequenziell durch, ruft pro
 * `copy-tree`-Step `copyTree()` auf, bei `collect-secrets` werden die
 * Keys nur ausgegeben (User-Action: `claude-os secrets set <key>`),
 * `migrate-git-metadata` ist eine Pointer-Notification (echte
 * Migration läuft via separates `doctor --migrate-git-metadata`).
 *
 * Idempotenz: wenn das Ziel bereits eine valide claude-os-Installation
 * ist (Marker-File `.claude-os-root` vorhanden), markiert der Plan-
 * Builder das mit `targetAlreadyMigrated: true`. Der CLI-Layer
 * entscheidet ob er den Lauf abbricht oder ob `--force` weitermacht.
 *
 * Unbekannte Felder aus .env-Parsing landen in `unknownFields` der
 * Result-Struktur — NIE verworfen.
 *
 * @module @domains/migration/runner
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type CopyTreeStats, copyTree } from './copy-tree.js';
import { discoverPortable } from './portable-discovery.js';
import { scanEnvFiles } from './secrets-collector.js';
import {
  MigrationError,
  type MigrationPlan,
  type MigrationResult,
  type PlanStep,
  type StepResult,
} from './types.js';

const CONFIG_EXCLUDE: readonly string[] = [
  'cache',
  'cache/**',
  'downloads',
  'downloads/**',
  'file-history',
  'file-history/**',
  'metrics',
  'metrics/**',
  'mcp-health-cache.json',
  'mcp-needs-auth-cache.json',
  'settings.local.json',
  'plugins/cache',
  'plugins/cache/**',
];

const VAULT_EXCLUDE: readonly string[] = ['.git', '.git/**'];

const ROOT_MARKER = '.claude-os-root';

export interface BuildPlanOpts {
  readonly sourceRoot: string;
  readonly targetRoot: string;
}

export function buildMigrationPlan(opts: BuildPlanOpts): MigrationPlan {
  const source = discoverPortable(opts.sourceRoot);
  const targetAlreadyMigrated = existsSync(join(opts.targetRoot, ROOT_MARKER));
  const steps: PlanStep[] = [];
  const notes: string[] = [];

  for (const w of source.warnings) notes.push(`(discovery) ${w}`);

  if (source.vaultDir !== null) {
    steps.push({
      kind: 'copy-tree',
      source: source.vaultDir,
      destination: join(opts.targetRoot, 'vault'),
      exclude: VAULT_EXCLUDE,
      label: 'vault/',
    });
  }
  if (source.configDir !== null) {
    steps.push({
      kind: 'copy-tree',
      source: source.configDir,
      destination: join(opts.targetRoot, 'config'),
      exclude: CONFIG_EXCLUDE,
      label: 'config/',
    });
  }

  if (source.vaultDir !== null) {
    steps.push({ kind: 'migrate-git-metadata', target: opts.targetRoot });
    notes.push(
      'Nach Execute: `claude-os doctor --migrate-git-metadata` ausführen — verschiebt vault/.git nach %APPDATA%/claude-os.',
    );
  }

  const envScan = scanEnvFiles(source.root, source.envFiles);
  if (envScan.keys.length > 0) {
    steps.push({
      kind: 'collect-secrets',
      keys: envScan.keys,
      sources: source.envFiles,
    });
    notes.push(
      `${envScan.keys.length} Secret-Key(s) in ${source.envFiles.length} .env-File(s) gefunden — Values niemals automatisch übertragen. Anschließend mit \`claude-os secrets set <key>\` einspeisen.`,
    );
  }
  for (const unknown of envScan.unknownLines) {
    notes.push(
      `(env-parse) unbekannte Zeile in ${unknown.source}: ${unknown.line.slice(0, 80)}${unknown.line.length > 80 ? '...' : ''}`,
    );
  }

  if (targetAlreadyMigrated) {
    notes.push(
      `Ziel ${opts.targetRoot} hat bereits einen .claude-os-root-Marker — Migration wäre re-run. Mit --force ausführen falls absichtlich.`,
    );
  }

  return {
    source,
    target: opts.targetRoot,
    steps,
    notes,
    targetAlreadyMigrated,
  };
}

export interface ExecutePlanOpts {
  readonly plan: MigrationPlan;
  /** Wenn `true`, wird auch dann ausgeführt wenn Target bereits einen Marker hat. */
  readonly force?: boolean;
  /** Wenn `true`, werden die Plan-Steps nur durchlaufen aber nicht ausgeführt. */
  readonly dryRun?: boolean;
}

export async function executePlan(opts: ExecutePlanOpts): Promise<MigrationResult> {
  const { plan, force = false, dryRun = false } = opts;
  if (plan.targetAlreadyMigrated && !force) {
    throw new MigrationError(
      `Ziel ${plan.target} ist bereits migriert (.claude-os-root vorhanden). --force erforderlich für Re-Migration.`,
    );
  }
  const results: StepResult[] = [];
  for (const step of plan.steps) {
    results.push(await runStep(step, dryRun));
  }
  const success = results.every((r) => r.status !== 'failed');
  return {
    plan,
    results,
    unknownFields: [],
    success,
  };
}

async function runStep(step: PlanStep, dryRun: boolean): Promise<StepResult> {
  if (dryRun) {
    return {
      step,
      status: 'skipped',
      message: `dry-run — würde ausgeführt: ${describeStep(step)}`,
    };
  }
  switch (step.kind) {
    case 'copy-tree': {
      try {
        const stats = await copyTree({
          source: step.source,
          destination: step.destination,
          exclude: step.exclude,
        });
        return {
          step,
          status: 'success',
          message: `${step.label} → ${step.destination} (${stats.filesCopied} Files, ${formatBytes(stats.bytesCopied)})`,
          filesCopied: stats.filesCopied,
          bytesCopied: stats.bytesCopied,
        };
      } catch (err) {
        return {
          step,
          status: 'failed',
          message: `copy-tree fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    case 'migrate-git-metadata':
      return {
        step,
        status: 'skipped',
        message: `Hinweis: manuell ausführen — claude-os doctor --migrate-git-metadata (Target: ${step.target})`,
      };
    case 'collect-secrets':
      return {
        step,
        status: 'skipped',
        message: `${step.keys.length} Secret-Key(s) gefunden: ${step.keys.join(', ')}. Mit \`claude-os secrets set <key>\` interaktiv übertragen.`,
      };
  }
}

function describeStep(step: PlanStep): string {
  switch (step.kind) {
    case 'copy-tree':
      return `copy ${step.source} → ${step.destination} (exclude ${step.exclude.length} Patterns)`;
    case 'migrate-git-metadata':
      return `doctor --migrate-git-metadata in ${step.target}`;
    case 'collect-secrets':
      return `secrets prompt für ${step.keys.length} Keys aus ${step.sources.length} .env-Files`;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Helper für Tests + CLI — re-export für externe Verifikation.
export type { CopyTreeStats };
export type ExecutedPlanOpts = ExecutePlanOpts;
