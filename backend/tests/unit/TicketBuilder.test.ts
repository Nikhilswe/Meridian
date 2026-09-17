import { TicketBuilder } from "../../src/domain/TicketBuilder";
import { ValidationError } from "../../src/domain/errors";

describe("TicketBuilder", () => {
  it("builds a valid CreateTicketInput with only required fields", () => {
    const input = new TicketBuilder().forCreator("agent-1").withOverview("Customer wants a refund").build();

    expect(input).toEqual({
      creatorId: "agent-1",
      ticketOverview: "Customer wants a refund",
    });
  });

  it("trims creatorId and ticketOverview", () => {
    const input = new TicketBuilder().forCreator("  agent-1  ").withOverview("  overview text  ").build();

    expect(input.creatorId).toBe("agent-1");
    expect(input.ticketOverview).toBe("overview text");
  });

  it("includes attachedDocuments when provided (repeatable calls)", () => {
    const input = new TicketBuilder()
      .forCreator("agent-1")
      .withOverview("Overview")
      .withAttachedDocument({ key: "k1", docType: "IMG", fileName: "a.png" })
      .withAttachedDocument({ key: "k2", docType: "PDF", fileName: "b.pdf" })
      .build();

    expect(input.attachedDocuments).toHaveLength(2);
    expect(input.attachedDocuments?.[0]?.fileName).toBe("a.png");
  });

  it("throws ValidationError when creatorId is missing", () => {
    expect(() => new TicketBuilder().withOverview("Overview").build()).toThrow(ValidationError);
  });

  it("throws ValidationError when creatorId is blank", () => {
    expect(() => new TicketBuilder().forCreator("   ").withOverview("Overview").build()).toThrow(ValidationError);
  });

  it("throws ValidationError when ticketOverview is missing", () => {
    expect(() => new TicketBuilder().forCreator("agent-1").build()).toThrow(ValidationError);
  });

  it("throws ValidationError when ticketOverview exceeds max length", () => {
    const tooLong = "x".repeat(5001);
    expect(() => new TicketBuilder().forCreator("agent-1").withOverview(tooLong).build()).toThrow(ValidationError);
  });

  it("throws ValidationError when an attached document is missing a key", () => {
    expect(() =>
      new TicketBuilder()
        .forCreator("agent-1")
        .withOverview("Overview")
        // @ts-expect-error intentionally missing key to test validation
        .withAttachedDocument({ docType: "IMG", fileName: "a.png" })
        .build(),
    ).toThrow(ValidationError);
  });

  it("collects multiple validation errors at once", () => {
    try {
      new TicketBuilder().build();
      fail("expected build() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationError = err as ValidationError;
      expect(validationError.details).toBeDefined();
      expect((validationError.details as string[]).length).toBeGreaterThanOrEqual(2);
    }
  });
});
