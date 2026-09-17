/**
 * Storage seam for ticket attachments. Offline: LocalFsAttachmentStorage
 * (repositories/storage/LocalFsAttachmentStorage.ts). AWS mode: S3
 * (repositories/storage/S3AttachmentStorage.ts). Same interface either way.
 */
export interface IAttachmentStorage {
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}
