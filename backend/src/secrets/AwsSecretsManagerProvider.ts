import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { injectable } from "tsyringe";
import { ISecretsProvider } from "./ISecretsProvider";

/**
 * AWS-mode secrets provider. Same ISecretsProvider contract as
 * EnvSecretsProvider, so the rest of the app (LLM providers, auth provider,
 * etc) never has to know which backing store is in play.
 *
 * Written correctly but not exercised in offline tests/demos -- wired in only
 * when the DI container is configured for AWS mode (see src/di/container.ts).
 *
 * IMPORTANT: never console.log / log the resolved secret value, only the
 * secret name, and never log the raw SecretsManager response body.
 */
@injectable()
export class AwsSecretsManagerProvider implements ISecretsProvider {
  // Read directly from process.env rather than via a constructor parameter,
  // so tsyringe never has to resolve a primitive `string` DI token when
  // auto-constructing this class.
  private readonly client: SecretsManagerClient = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  private readonly cache = new Map<string, string | undefined>();

  public async get(name: string): Promise<string | undefined> {
    if (this.cache.has(name)) {
      return this.cache.get(name);
    }

    try {
      const response = await this.client.send(new GetSecretValueCommand({ SecretId: name }));
      const value = response.SecretString ?? undefined;
      this.cache.set(name, value);
      return value;
    } catch (err) {
      // Never include the secret name+value together in a way that could leak
      // sensitive data; the SDK error message here only ever contains the
      // secret's *name* and an AWS error code, never a resolved value.
      console.error(`AwsSecretsManagerProvider: failed to resolve secret "${name}": ${(err as Error).message}`);
      return undefined;
    }
  }
}
