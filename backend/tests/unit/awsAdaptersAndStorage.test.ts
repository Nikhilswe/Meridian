import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AwsSecretsManagerProvider } from "../../src/secrets/AwsSecretsManagerProvider";
import { S3AttachmentStorage } from "../../src/repositories/storage/S3AttachmentStorage";
import { LocalFsAttachmentStorage } from "../../src/repositories/storage/LocalFsAttachmentStorage";

/**
 * The AWS SDK clients are mocked at the module boundary: `send` is a
 * jest.fn and the Command classes just capture their input, so the tests
 * assert on exactly what would be sent without any credentials/network.
 */
const mockSecretsSend = jest.fn();
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => ({ input })),
}));

const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send, config: { region: async () => "ap-south-1" } })),
  PutObjectCommand: jest.fn((input: unknown) => ({ input })),
}));

describe("AwsSecretsManagerProvider", () => {
  beforeEach(() => mockSecretsSend.mockReset());

  it("fetches SecretString by name once and then serves it from cache", async () => {
    mockSecretsSend.mockResolvedValueOnce({ SecretString: "shh" });
    const provider = new AwsSecretsManagerProvider();
    await expect(provider.get("/scaler/prod/ANTHROPIC_API_KEY")).resolves.toBe("shh");
    await expect(provider.get("/scaler/prod/ANTHROPIC_API_KEY")).resolves.toBe("shh");
    expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    expect((mockSecretsSend.mock.calls[0]![0] as { input: unknown }).input).toEqual({ SecretId: "/scaler/prod/ANTHROPIC_API_KEY" });
  });

  it("returns undefined (and caches that) for a binary-only secret", async () => {
    mockSecretsSend.mockResolvedValueOnce({ SecretBinary: new Uint8Array([1]) });
    const provider = new AwsSecretsManagerProvider();
    await expect(provider.get("bin")).resolves.toBeUndefined();
    await expect(provider.get("bin")).resolves.toBeUndefined();
    expect(mockSecretsSend).toHaveBeenCalledTimes(1);
  });

  it("logs only the secret NAME + SDK error and returns undefined on failure (never throws into business logic)", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockSecretsSend.mockRejectedValueOnce(new Error("AccessDeniedException"));
    await expect(new AwsSecretsManagerProvider().get("missing")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to resolve secret "missing": AccessDeniedException'));
    errorSpy.mockRestore();
  });
});

describe("S3AttachmentStorage", () => {
  const originalBucket = process.env.DOCS_S3_BUCKET;
  beforeEach(() => {
    mockS3Send.mockReset();
    process.env.DOCS_S3_BUCKET = "scaler-docs";
  });
  afterAll(() => {
    if (originalBucket === undefined) delete process.env.DOCS_S3_BUCKET;
    else process.env.DOCS_S3_BUCKET = originalBucket;
  });

  it("put() sends a PutObject with bucket/key/body/content-type", async () => {
    mockS3Send.mockResolvedValueOnce({});
    const body = Buffer.from("pdf-bytes");
    await new S3AttachmentStorage().put("2026-09-18/t1/c1/INVOICE-a.pdf", body, "application/pdf");
    expect((mockS3Send.mock.calls[0]![0] as { input: unknown }).input).toEqual({
      Bucket: "scaler-docs",
      Key: "2026-09-18/t1/c1/INVOICE-a.pdf",
      Body: body,
      ContentType: "application/pdf",
    });
  });

  it("getUrl() builds a virtual-hosted-style URL from the client's resolved region", async () => {
    await expect(new S3AttachmentStorage().getUrl("k/f.pdf")).resolves.toBe("https://scaler-docs.s3.ap-south-1.amazonaws.com/k/f.pdf");
  });

  it("tolerates an unset bucket env (empty bucket name) rather than crashing at construction", async () => {
    delete process.env.DOCS_S3_BUCKET;
    await expect(new S3AttachmentStorage().getUrl("k")).resolves.toBe("https://.s3.ap-south-1.amazonaws.com/k");
  });
});

describe("LocalFsAttachmentStorage", () => {
  let tmp: string;
  const original = process.env.DOCS_LOCAL_PATH;
  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scaler-attachments-"));
    process.env.DOCS_LOCAL_PATH = tmp;
  });
  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    if (original === undefined) delete process.env.DOCS_LOCAL_PATH;
    else process.env.DOCS_LOCAL_PATH = original;
  });

  it("put() creates the nested key directories and writes the bytes; getUrl() returns a file:// URL to them", async () => {
    const storage = new LocalFsAttachmentStorage();
    const key = "2026-09-18/t1/c1/INVOICE-a.txt";
    await storage.put(key, Buffer.from("hello"), "text/plain");
    expect(await fs.promises.readFile(path.join(tmp, key), "utf-8")).toBe("hello");
    await expect(storage.getUrl(key)).resolves.toBe(`file://${path.resolve(tmp, key)}`);
  });

  it("defaults to ./.data/attachments when DOCS_LOCAL_PATH is unset", async () => {
    delete process.env.DOCS_LOCAL_PATH;
    await expect(new LocalFsAttachmentStorage().getUrl("x")).resolves.toBe(`file://${path.resolve("./.data/attachments", "x")}`);
  });
});
