export interface StoredPhoto {
  key: string;
  contentType: string;
  size: number;
}

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "jpg";
  }
}

export class PhotoStore {
  constructor(private readonly bucket: R2Bucket) {}

  async saveDoorIdentityPhoto(input: {
    attemptId: string;
    bytes: ArrayBuffer;
    contentType: string;
  }): Promise<StoredPhoto> {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = extensionFor(input.contentType);
    const key =
      "door-identification/" +
      year +
      "/" +
      month +
      "/" +
      input.attemptId +
      "." +
      extension;

    await this.bucket.put(key, input.bytes, {
      httpMetadata: {
        contentType: input.contentType
      },
      customMetadata: {
        photoRole: "DOOR_IDENTITY",
        attemptId: input.attemptId
      }
    });

    return {
      key,
      contentType: input.contentType,
      size: input.bytes.byteLength
    };
  }
}
