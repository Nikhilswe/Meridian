import * as path from "path";
import { ConfigError, ConfigResolver } from "../../src/config/ConfigResolver";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "config-resolver");

describe("ConfigResolver wildcard fallback precedence", () => {
  it("prefers exact env.namespace.key over every other tier", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(resolver.get<string>("ns1", "sharedKey")).toBe("local-ns1-sharedKey");
  });

  it("falls back to env.*.key when env.namespace.key is absent", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(resolver.get<string>("ns1", "onlyInLocalStar")).toBe("L2");
  });

  it("falls back to *.namespace.key when env.namespace.key and env.*.key are both absent", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(resolver.get<string>("ns1", "onlyInWildcardNs1")).toBe("W1");
  });

  it("falls back to *.*.key as the last resort", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(resolver.get<string>("ns1", "onlyInWildcardStar")).toBe("W2");
  });

  it("uses a different env's exact tier independently (beta has no overrides here)", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "beta");
    // beta.json is empty, so beta.ns1.sharedKey falls all the way through to *.ns1.sharedKey
    expect(resolver.get<string>("ns1", "sharedKey")).toBe("wildcard-ns1-sharedKey");
  });

  it("throws a ConfigError when no tier has the key and no fallback is given", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(() => resolver.get<string>("ns1", "totallyMissingKey")).toThrow(ConfigError);
  });

  it("returns the supplied fallback instead of throwing when nothing matches", () => {
    const resolver = new ConfigResolver(FIXTURE_DIR, "local");
    expect(resolver.get<string>("ns1", "totallyMissingKey", "the-default")).toBe("the-default");
  });

  it("defaults to APP_ENV=local when no env argument is given", () => {
    const originalAppEnv = process.env.APP_ENV;
    delete process.env.APP_ENV;
    try {
      const resolver = new ConfigResolver(FIXTURE_DIR);
      expect(resolver.env).toBe("local");
    } finally {
      if (originalAppEnv !== undefined) process.env.APP_ENV = originalAppEnv;
    }
  });
});
