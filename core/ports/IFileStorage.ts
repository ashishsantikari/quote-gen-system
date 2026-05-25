export interface IFileStorage {
  generatePresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string>;
  deleteFiles(bucket: string, keys: string[]): Promise<void>;
  fileExists(bucket: string, key: string): Promise<boolean>;
}
