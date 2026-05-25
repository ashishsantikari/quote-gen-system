import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import { StorageError } from "../../core/errors";
import { Logger } from "../../core/telemetry/logger";

const log = new Logger({ component: "S3FileStorage" });

export class S3FileStorage implements IFileStorage {
  private client: S3Client;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || "us-east-1";
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;

    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: !!endpoint,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });

    if (endpoint) {
      log.info("using custom endpoint", {
        endpoint,
        region,
        forcePathStyle: true,
      });
    }
  }

  async generatePresignedUrl(
    bucket: string,
    key: string,
    expiresIn: number,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(this.client, command, { expiresIn });
      return url;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new StorageError("generatePresignedUrl", err, {
        bucket,
        key,
        expiresIn,
      });
    }
  }

  async deleteFiles(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new StorageError("deleteFiles", err, {
        bucket,
        keyCount: keys.length,
      });
    }
  }

  async fileExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return true;
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.name === "NoSuchKey" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      throw new StorageError("fileExists", err, { bucket, key });
    }
  }
}

export default S3FileStorage;
