import { Policy } from "@meridian/shared-types";

/**
 * Deliberately naive keyword/substring retrieval, used to pick a handful of
 * policies to ground the summarisation prompt. This is NOT real RAG -- no
 * embeddings, no vector search, just word-overlap scoring against
 * category/title. It's good enough for a stub reference table of a few
 * dozen policies.
 *
 * To swap in real retrieval later: replace the body of `findRelevantPolicies`
 * with a call to a vector-search-backed IPolicyRepository method (e.g.
 * `searchByEmbedding(overviewEmbedding, topK)`), keeping the same signature
 * so SummarisationService doesn't need to change.
 */
export function findRelevantPolicies(ticketOverview: string, allPolicies: Policy[], maxResults = 3): Policy[] {
  const overviewWords = tokenize(ticketOverview);

  const scored = allPolicies
    .map((policy) => ({
      policy,
      score: score(overviewWords, tokenize(`${policy.category} ${policy.title}`)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map((entry) => entry.policy);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );
}

function score(overviewWords: Set<string>, candidateWords: Set<string>): number {
  let overlap = 0;
  for (const word of candidateWords) {
    if (overviewWords.has(word)) {
      overlap += 1;
    }
  }
  return overlap;
}
