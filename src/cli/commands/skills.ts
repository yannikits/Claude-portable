/**
 * `claude-os skills` — list/show/match SKILL.md from the active workspace.
 *
 * Subcommands:
 *   list                       Tabular listing of all skills in the workspace
 *   show <name>                Print SKILL.md frontmatter + body
 *   match <query...>           BM25-match skills by name+description
 *
 * @module @cli/commands/skills
 */
import type { Command } from 'commander';
import {
  listSkills,
  matchSkills,
  readSkillByName,
  type Skill,
  SkillsError,
} from '../../domains/skills/index.js';
import {
  readActiveWorkspace,
  resolveVaultRoot,
  WorkspaceError,
} from '../../domains/workspace/index.js';
import type { GlobalOpts } from '../output.js';

interface SkillsCmdOpts {
  readonly workspace?: string;
  readonly topK?: string;
}

function printAndExit(output: string, code: number): never {
  // biome-ignore lint/suspicious/noConsole: CLI presenter output by design
  console.log(output);
  process.exit(code);
}

function printErr(line: string): void {
  console.error(line);
}

function resolveContext(globalOpts: GlobalOpts, cmdOpts: SkillsCmdOpts) {
  const vault = resolveVaultRoot(
    globalOpts.vault === undefined ? {} : { explicit: globalOpts.vault },
  );
  const workspaceId = cmdOpts.workspace ?? readActiveWorkspace().active;
  return { vault, workspaceId };
}

function renderListText(skills: readonly Skill[]): string {
  if (skills.length === 0) return '(no skills in this workspace)';
  const lines = ['NAME                            VERSION  DESCRIPTION'];
  for (const s of skills) {
    const name = s.frontmatter.name.padEnd(30, ' ');
    const version = String(s.frontmatter.version).padEnd(8, ' ');
    lines.push(`${name}  ${version} ${s.frontmatter.description}`);
  }
  return lines.join('\n');
}

export function registerSkillsCommand(program: Command): void {
  const sk = program
    .command('skills')
    .description('List/show/match SKILL.md skills in the active workspace')
    .option('--workspace <id>', 'Override the active workspace');

  sk.command('list')
    .description('List all skills with their description')
    .action(function (this: Command) {
      const globalOpts = program.opts<GlobalOpts>();
      const cmdOpts = sk.opts<SkillsCmdOpts>();
      const json = globalOpts.json === true;
      try {
        const { vault, workspaceId } = resolveContext(globalOpts, cmdOpts);
        const issues: { path: string; message: string }[] = [];
        const skills = listSkills(vault, workspaceId, (path, err) =>
          issues.push({ path, message: err.message }),
        );
        const out = json
          ? JSON.stringify(
              {
                ok: true,
                workspace: workspaceId,
                count: skills.length,
                skills: skills.map((s) => ({
                  name: s.frontmatter.name,
                  version: s.frontmatter.version,
                  description: s.frontmatter.description,
                  path: s.path,
                })),
                malformed: issues,
              },
              null,
              2,
            )
          : renderListText(skills);
        printAndExit(out, 0);
      } catch (err) {
        if (err instanceof WorkspaceError || err instanceof SkillsError) {
          printErr(`skills list: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  sk.command('show <name>')
    .description('Print a skill (frontmatter + body)')
    .action(function (this: Command, name: string) {
      const globalOpts = program.opts<GlobalOpts>();
      const cmdOpts = sk.opts<SkillsCmdOpts>();
      const json = globalOpts.json === true;
      try {
        const { vault, workspaceId } = resolveContext(globalOpts, cmdOpts);
        const skill = readSkillByName(vault, workspaceId, name);
        const out = json
          ? JSON.stringify(
              {
                ok: true,
                name: skill.frontmatter.name,
                version: skill.frontmatter.version,
                description: skill.frontmatter.description,
                path: skill.path,
                body: skill.body,
              },
              null,
              2,
            )
          : `${skill.path}\n\n${skill.rawFrontmatter}\n\n${skill.body}`;
        printAndExit(out, 0);
      } catch (err) {
        if (err instanceof WorkspaceError || err instanceof SkillsError) {
          printErr(`skills show: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  sk.command('match <query...>')
    .description('Find skills whose description/name best matches a query (BM25)')
    .option('--top-k <n>', 'Top-K result count (default 5)', '5')
    .action(function (this: Command, queryParts: string[], localOpts: { topK?: string }) {
      const globalOpts = program.opts<GlobalOpts>();
      const cmdOpts = sk.opts<SkillsCmdOpts>();
      const json = globalOpts.json === true;
      const query = queryParts.join(' ').trim();
      if (query.length === 0) {
        printErr('skills match: empty query');
        process.exit(2);
      }
      const topKRaw = localOpts.topK ?? '5';
      const topK = Number.parseInt(topKRaw, 10);
      if (!Number.isInteger(topK) || topK < 1) {
        printErr(`skills match: --top-k must be a positive integer, got "${topKRaw}"`);
        process.exit(2);
      }
      try {
        const { vault, workspaceId } = resolveContext(globalOpts, cmdOpts);
        const skills = listSkills(vault, workspaceId);
        const matches = matchSkills(skills, query, { topK });
        const out = json
          ? JSON.stringify(
              {
                ok: true,
                workspace: workspaceId,
                query,
                count: matches.length,
                matches: matches.map((m) => ({
                  name: m.skill.frontmatter.name,
                  score: m.score,
                  matchedTerms: m.matchedTerms,
                  description: m.skill.frontmatter.description,
                  path: m.skill.path,
                })),
              },
              null,
              2,
            )
          : matches
              .map(
                (m) =>
                  `${m.score.toFixed(3)}  ${m.skill.frontmatter.name.padEnd(28, ' ')} ${m.skill.frontmatter.description}`,
              )
              .join('\n') || '(no matches)';
        printAndExit(out, 0);
      } catch (err) {
        if (err instanceof WorkspaceError || err instanceof SkillsError) {
          printErr(`skills match: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });
}
