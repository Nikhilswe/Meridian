/**
 * Secrets (API keys, JWT signing secret, DB credentials, etc) are never
 * hardcoded and never logged. This interface is the single seam between
 * "where a secret's value lives" and everything that needs one, so swapping
 * from local env vars to a real secret store (AWS Secrets Manager) touches
 * only the DI registration in src/di/container.ts, nothing else.
 */
export interface ISecretsProvider {
  /**
   * Resolves a secret by logical name (e.g. "OPENAI_API_KEY", "JWT_SECRET").
   * Returns undefined if not configured -- callers decide whether that's
   * fatal for their code path.
   */
  get(name: string): Promise<string | undefined>;
}
