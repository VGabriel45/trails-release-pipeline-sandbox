const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

/** Parse @patch/@minor/@major/@skip-changeset from title + body. */
export function parseBumpToken(title = "", body = "") {
  const text = `${title}\n${body}`;
  if (/@skip-changeset\b/i.test(text) || /\bskip-changeset\b/i.test(text)) {
    return { skip: true, bump: null };
  }

  const tokens = [...text.matchAll(/@(patch|minor|major)\b/gi)].map((m) =>
    m[1].toLowerCase(),
  );
  if (tokens.length === 0) return { skip: false, bump: null };

  const bump = tokens.reduce((best, t) =>
    BUMP_RANK[t] > BUMP_RANK[best] ? t : best,
  );
  return { skip: false, bump };
}

/** Strip bump tokens from text for LLM input. */
export function stripBumpTokens(text = "") {
  return text
    .replace(/@(patch|minor|major|skip-changeset)\b/gi, "")
    .replace(/\bskip-changeset\b/gi, "")
    .trim();
}
