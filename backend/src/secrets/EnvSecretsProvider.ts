import { injectable } from "tsyringe";
import { ISecretsProvider } from "./ISecretsProvider";

/**
 * Default secrets provider for local/beta (offline) mode: reads from
 * process.env, which is populated from a git-ignored `.env` file (see
 * ../../.env.example at the repo root) -- never from a committed file.
 *
 * IMPORTANT: this class must NEVER console.log / console.error / JSON.stringify
 * the resolved secret value. Only log the secret *name*, never its value.
 */
@injectable()
export class EnvSecretsProvider implements ISecretsProvider {
  public async get(name: string): Promise<string | undefined> {
    const value = process.env[name];
    return value === "" ? undefined : value;
  }
}
