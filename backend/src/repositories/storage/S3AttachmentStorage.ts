import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { injectable } from "tsyringe";
import { IAttachmentStorage } from "../IAttachmentStorage";

/**
 * AWS-mode attachment storage. Same IAttachmentStorage contract as
 * LocalFsAttachmentStorage -- written correctly, only wired in when
 * DOCS_STORAGE_MODE=s3 (see src/di/container.ts).
 */
@injectable()
export class S3AttachmentStorage implements IAttachmentStorage {
  // Read directly from process.env rather than via constructor parameters,
  // so tsyringe never has to resolve a primitive `string` DI token when
  // auto-constructing this class.
  private readonly bucket: string = process.env.DOCS_S3_BUCKET || "";
  private readonly client: S3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

  public async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  public async getUrl(key: string): Promise<string> {
    // A real deployment would presign this (via @aws-sdk/s3-request-presigner)
    // for time-limited access; kept as a plain virtual-hosted-style URL here
    // to avoid pulling in an extra AWS SDK package this project never
    // exercises offline. Swap this method's body when wiring real S3 access.
    const region = await this.client.config.region();
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}
