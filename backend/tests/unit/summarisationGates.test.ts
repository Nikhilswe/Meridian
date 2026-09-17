import { Order } from "@meridian/shared-types";
import {
  CHECK_CUSTOMER_IDENTIFIED,
  CHECK_DELIVERY_DATE_PRESENT,
  CHECK_NO_RESOLUTION_CLAIM,
  CHECK_ORDER_BELONGS_TO_CUSTOMER,
  containsResolutionClaim,
  runPostModelChecks,
  runPreModelGate,
} from "../../src/domain/summarisationGates";

const delivered: Order = {
  orderId: "order-1",
  customerId: "cust-1",
  itemSummary: "Jacket",
  orderDate: "2026-09-10T00:00:00.000Z",
  amount: 80,
  currency: "USD",
  status: "DELIVERED",
  deliveredDate: "2026-09-16T00:00:00.000Z",
};

describe("runPreModelGate (deterministic, before any model call)", () => {
  it("passes when the customer is identified and no order is referenced", () => {
    const result = runPreModelGate({ customerId: "cust-1" }, undefined);
    expect(result.missingInformation).toEqual([]);
    expect(result.checks.map((c) => [c.id, c.passed])).toEqual([[CHECK_CUSTOMER_IDENTIFIED, true]]);
  });

  it("asks for the customer when the ticket has none", () => {
    const result = runPreModelGate({}, undefined);
    expect(result.missingInformation).toHaveLength(1);
    expect(result.missingInformation[0]).toMatch(/Customer ID/);
    expect(result.checks.find((c) => c.id === CHECK_CUSTOMER_IDENTIFIED)?.passed).toBe(false);
  });

  it("C2: a delivered order with no delivery date stops the flow and asks for the date", () => {
    const result = runPreModelGate({ customerId: "cust-1", orderId: "order-1" }, { ...delivered, deliveredDate: undefined });
    expect(result.missingInformation).toHaveLength(1);
    expect(result.missingInformation[0]).toMatch(/Delivery date for order order-1/);
    expect(result.checks.find((c) => c.id === CHECK_DELIVERY_DATE_PRESENT)?.passed).toBe(false);
  });

  it("C1: a delivered order with a delivery date passes both order checks", () => {
    const result = runPreModelGate({ customerId: "cust-1", orderId: "order-1" }, delivered);
    expect(result.missingInformation).toEqual([]);
    expect(result.checks.find((c) => c.id === CHECK_ORDER_BELONGS_TO_CUSTOMER)?.passed).toBe(true);
    expect(result.checks.find((c) => c.id === CHECK_DELIVERY_DATE_PRESENT)?.passed).toBe(true);
  });

  it("a shipped (not yet delivered) order does not require a delivery date", () => {
    const result = runPreModelGate({ customerId: "cust-1", orderId: "order-1" }, { ...delivered, status: "SHIPPED", deliveredDate: undefined });
    expect(result.missingInformation).toEqual([]);
    expect(result.checks.find((c) => c.id === CHECK_DELIVERY_DATE_PRESENT)).toBeUndefined();
  });

  it("a referenced order the caller could not match to the customer is reported as missing", () => {
    const result = runPreModelGate({ customerId: "cust-1", orderId: "order-999" }, undefined);
    expect(result.missingInformation[0]).toMatch(/order-999 could not be matched/);
    expect(result.checks.find((c) => c.id === CHECK_ORDER_BELONGS_TO_CUSTOMER)?.passed).toBe(false);
  });
});

describe("containsResolutionClaim", () => {
  it.each([
    "Good news -- your issue has been resolved.",
    "The problem is now fixed and you should see the refund shortly.",
    "We have resolved your complaint about the jacket.",
    "Please consider this matter closed.",
    "Your ticket has been marked as resolved.",
    "I can confirm the issue was sorted out yesterday.",
  ])("detects: %s", (text) => {
    expect(containsResolutionClaim(text)).toBe(true);
  });

  it.each([
    "Thank you for reaching out. I've referred your case for a return review.",
    "We are looking into this and will confirm once it is resolved.",
    "Once we receive the delivery date we can check eligibility for a refund.",
    "The zip on the jacket is reported as broken; I'm sorry about that.",
    "test",
  ])("does not flag: %s", (text) => {
    expect(containsResolutionClaim(text)).toBe(false);
  });
});

describe("runPostModelChecks (source of truth beats wording)", () => {
  it("C3: fails when the record is open but the draft claims resolution", () => {
    const checks = runPostModelChecks({ ticketStatus: "IN_REVIEW" }, "Your issue has been resolved.");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe(CHECK_NO_RESOLUTION_CLAIM);
    expect(checks[0]?.passed).toBe(false);
  });

  it("passes when the record is open and the draft makes no such claim", () => {
    const checks = runPostModelChecks({ ticketStatus: "ASSIGNED" }, "We are reviewing your case.");
    expect(checks[0]?.passed).toBe(true);
  });

  it("allows a resolution statement only when the record itself says RESOLVED", () => {
    const checks = runPostModelChecks({ ticketStatus: "RESOLVED" }, "Your issue has been resolved.");
    expect(checks[0]?.passed).toBe(true);
  });
});
