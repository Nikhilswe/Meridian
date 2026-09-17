import * as fs from "fs";
import * as path from "path";
import { injectable } from "tsyringe";
import { IAttachmentStorage } from "../IAttachmentStorage";

/**
 * Offline attachment storage: writes under DOCS_LOCAL_PATH. Key pattern is
 * expected to already follow `<date>/<ticketId>/<creatorId>/<docType>-<fileName>`
 * (built by the caller per the AttachedDocument.key contract in shared-types)
 * -- this class just persists bytes at that key, it doesn't invent the key.
 */
@injectable()
export class LocalFsAttachmentStorage implements IAttachmentStorage {
  // Read directly from process.env (not a secret) rather than via a
  // constructor parameter, so tsyringe never has to resolve a primitive
  // `string` DI token when auto-constructing this class.
  private readonly basePath: string = process.env.DOCS_LOCAL_PATH || "./.data/attachments";

  public async put(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    const fullPath = path.join(this.basePath, key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }

  public async getUrl(key: string): Promise<string> {
    // Offline mode has no real HTTP file server for attachments; a file://
    // URL is enough for local dev/demo purposes.
    return `file://${path.resolve(this.basePath, key)}`;
  }
}
