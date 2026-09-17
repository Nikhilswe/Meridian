import * as fs from "fs";
import * as path from "path";

/**
 * ConfigResolver resolves plain (non-secret) tunables -- rate limits, pagination
 * sizes, LLM provider choice, round-robin pool size, etc -- via a hierarchical
 * wildcard fallback lookup, so ops can override a single env/namespace/key
 * combination without duplicating every other value.
 *
 * Lookup order for (env, namespace, key), first match wins:
 *   1. `${env}.${namespace}.${key}`   e.g. prod.rateLimit.ticketCreateMax
 *   2. `${env}.*.${key}`              e.g. prod.*.ticketCreateMax
 *   3. `*.${namespace}.${key}`        e.g. *.rateLimit.ticketCreateMax
 *   4. `*.*.${key}`                   e.g. *.*.ticketCreateMax
 *
 * ConfigResolver itself does not read process.env for these values (it only
 * reads APP_ENV once, to pick which config layer is "current"). Secrets
 * (API keys, JWT signing secret, DB credentials) are a *separate* concern,
 * handled by the secrets/ISecretsProvider layer which overlays process.env /
 * a real secret store on top -- never mixed into this file-backed config.
 */

export class ConfigError extends Error {
  public readonly code = "CONFIG_NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type ConfigFile = Record<string, Record<string, unknown>>;

const KNOWN_ENV_FILES: Record<string, string> = {
  local: "local.json",
  beta: "beta.json",
  prod: "prod.json",
  "*": "wildcard.json",
};

export class ConfigResolver {
  /** Flat map keyed by `${env}.${namespace}.${key}` -> value. */
  private readonly merged = new Map<string, unknown>();
  private readonly currentEnv: string;

  constructor(dataDir: string = path.join(__dirname, "data"), appEnv: string = process.env.APP_ENV || "local") {
    this.currentEnv = appEnv;
    this.loadAll(dataDir);
  }

  private loadAll(dataDir: string): void {
    for (const [env, fileName] of Object.entries(KNOWN_ENV_FILES)) {
      const filePath = path.join(dataDir, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      let parsed: ConfigFile;
      try {
        parsed = JSON.parse(raw) as ConfigFile;
      } catch (err) {
        throw new ConfigError(`Failed to parse config file ${filePath}: ${(err as Error).message}`);
      }
      this.flattenInto(env, parsed);
    }
  }

  private flattenInto(env: string, parsed: ConfigFile): void {
    for (const [namespace, entries] of Object.entries(parsed)) {
      if (entries === null || typeof entries !== "object") {
        continue;
      }
      for (const [key, value] of Object.entries(entries)) {
        this.merged.set(`${env}.${namespace}.${key}`, value);
      }
    }
  }

  /** Exposed mainly for tests that want to check exact precedence. */
  public resolveRaw(env: string, namespace: string, key: string): { value: unknown; found: boolean } {
    const candidates = [`${env}.${namespace}.${key}`, `${env}.*.${key}`, `*.${namespace}.${key}`, `*.*.${key}`];

    for (const candidate of candidates) {
      if (this.merged.has(candidate)) {
        return { value: this.merged.get(candidate), found: true };
      }
    }
    return { value: undefined, found: false };
  }

  /**
   * Typed convenience getter. Throws ConfigError if nothing matches any of the
   * four fallback tiers and no `fallback` default was supplied.
   */
  public get<T>(namespace: string, key: string, fallback?: T): T {
    const { value, found } = this.resolveRaw(this.currentEnv, namespace, key);
    if (found) {
      return value as T;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new ConfigError(
      `No config value found for namespace="${namespace}" key="${key}" in env="${this.currentEnv}" ` +
        `(checked ${this.currentEnv}.${namespace}.${key}, ${this.currentEnv}.*.${key}, *.${namespace}.${key}, *.*.${key})`,
    );
  }

  public get env(): string {
    return this.currentEnv;
  }
}
