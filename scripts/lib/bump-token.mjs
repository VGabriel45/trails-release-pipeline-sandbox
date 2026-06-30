const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

// Prefer bracket form [patch]/[minor]/[major] in PR titles. The legacy @-prefixed
// form is still accepted, but avoid documenting it: "@patch" in a title is
// auto-linked by GitHub as a mention of the user "patch" in PR lists and release notes.
const BUMP_RE = /[@[](patch|minor|major)\b\]?/gi;
const SKIP_RE = /[@[]?skip-changeset\b\]?/i;

/** Parse [patch]/[minor]/[major]/[skip-changeset] (also @-prefixed) from title + body. */
export function parseBumpToken(title = "", body = "") {
  const text = `${title}\n${body}`;
  if (SKIP_RE.test(text)) {
    return { skip: true, bump: null };
  }

  const tokens = [...text.matchAll(BUMP_RE)].map((m) => m[1].toLowerCase());
  if (tokens.length === 0) return { skip: false, bump: null };

  const bump = tokens.reduce((best, t) =>
    BUMP_RANK[t] > BUMP_RANK[best] ? t : best,
  );
  return { skip: false, bump };
}

/** Strip bump tokens from text for LLM input. */
export function stripBumpTokens(text = "") {
  return text
    .replace(/[@[](patch|minor|major|skip-changeset)\b\]?/gi, "")
    .replace(/\bskip-changeset\b/gi, "")
    .trim();
}
