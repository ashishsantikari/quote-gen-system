import type { IFileStorage } from "../../core/ports/IFileStorage";

export class S3FileStorage implements IFileStorage {
  async generatePresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    throw new Error("Not implemented");
  }

  async deleteFiles(bucket: string, keys: string[]): Promise<void> {
    throw new Error("Not implemented");
  }

  async fileExists(bucket: string, key: string): Promise<boolean> {
    throw new Error("Not implemented");
  }
}

export default S3FileStorage;
