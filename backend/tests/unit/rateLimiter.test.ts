import { buildRateLimiter } from "../../src/middleware/rateLimiter";
import { ConfigResolver } from "../../src/config/ConfigResolver";

describe("buildRateLimiter config wiring", () => {
  it("reads ticketCreateMax/ticketCreateWindowMs from ConfigResolver, not literals", () => {
    const getSpy = jest.spyOn(ConfigResolver.prototype, "get");
    const configResolver = new ConfigResolver();

    buildRateLimiter(configResolver, "ticketCreate");

    expect(getSpy).toHaveBeenCalledWith("rateLimit", "ticketCreateMax");
    expect(getSpy).toHaveBeenCalledWith("rateLimit", "ticketCreateWindowMs");
    getSpy.mockRestore();
  });

  it("reads summariseMax/summariseWindowMs from ConfigResolver for the summarise namespace", () => {
    const getSpy = jest.spyOn(ConfigResolver.prototype, "get");
    const configResolver = new ConfigResolver();

    buildRateLimiter(configResolver, "summarise");

    expect(getSpy).toHaveBeenCalledWith("rateLimit", "summariseMax");
    expect(getSpy).toHaveBeenCalledWith("rateLimit", "summariseWindowMs");
    getSpy.mockRestore();
  });

  it("produces a middleware function", () => {
    const configResolver = new ConfigResolver();
    const middleware = buildRateLimiter(configResolver, "ticketCreate");
    expect(typeof middleware).toBe("function");
  });
});
