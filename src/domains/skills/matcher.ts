/**
 * Skill description-matcher (Phase 4).
 *
 * Reuses the Phase-2c BM25 scorer over each skill's `description` +
 * `name`. Returns top-K matches in descending score order.
 *
 * Indexable text per skill = `name` + ' ' + `description`. The body is
 * **not** indexed for the matcher — bodies are prompt-material claude
 * sees AFTER selection, not retrieval-keys. Tags or other frontmatter
 * extras are ignored at v1; users wanting tag-based discovery can
 * encode them in the description.
 *
 * @module @domains/skills/matcher
 */
import { bm25Score, buildCorpusStats, buildDocStats, tokenize } from '../retrieval/index.js';
import type { Skill } from './types.js';

export interface SkillMatch {
  readonly skill: Skill;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface MatchOpts {
  readonly topK?: number;
}

const DEFAULT_TOP_K = 5;

function indexableText(skill: Skill): string {
  return `${skill.frontmatter.name} ${skill.frontmatter.description}`;
}

/**
 * Ranks `skills` against `query` using BM25 over their description+name.
 * Empty query (or no-token-after-tokenise) → `[]`. Empty skill-list →
 * `[]`. Score = 0 entries are dropped.
 */
export function matchSkills(
  skills: readonly Skill[],
  query: string,
  opts: MatchOpts = {},
): SkillMatch[] {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || skills.length === 0) return [];

  const tokenisedDocs = skills.map((s) => tokenize(indexableText(s)));
  const corpus = buildCorpusStats(tokenisedDocs);
  const docStats = tokenisedDocs.map(buildDocStats);

  const matches: SkillMatch[] = [];
  for (let i = 0; i < skills.length; i++) {
    const stats = docStats[i];
    const skill = skills[i];
    if (stats === undefined || skill === undefined) continue;
    const { score, matchedTerms } = bm25Score(stats, queryTokens, corpus);
    if (score <= 0) continue;
    matches.push({ skill, score, matchedTerms });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topK);
}
