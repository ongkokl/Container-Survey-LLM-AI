export interface StoredPhoto {
  key: string;
  contentType: string;
  size: number;
}

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic":
    case "image/heif": return "heic";
    default: return "jpg";
  }
}

export class PhotoStore {
  constructor(private readonly bucket: R2Bucket) {}

  private async put(key:string,bytes:ArrayBuffer,contentType:string,metadata:Record<string,string>):Promise<StoredPhoto>{
    await this.bucket.put(key,bytes,{httpMetadata:{contentType},customMetadata:metadata});
    return {key,contentType,size:bytes.byteLength};
  }

  async saveDoorIdentityPhoto(input:{attemptId:string;bytes:ArrayBuffer;contentType:string;}):Promise<StoredPhoto>{
    const now=new Date(), year=String(now.getUTCFullYear()), month=String(now.getUTCMonth()+1).padStart(2,"0");
    const key="door-identification/"+year+"/"+month+"/"+input.attemptId+"."+extensionFor(input.contentType);
    return this.put(key,input.bytes,input.contentType,{photoRole:"DOOR_IDENTITY",attemptId:input.attemptId});
  }

  async saveFindingPhoto(input:{surveyId:string;findingId:string;photoId:string;role:"FACE_OVERVIEW"|"COMPONENT_CLOSEUP"|"DAMAGE_CLOSEUP";bytes:ArrayBuffer;contentType:string;}):Promise<StoredPhoto>{
    const key="surveys/"+input.surveyId+"/findings/"+input.findingId+"/"+input.role.toLowerCase()+"-"+input.photoId+"."+extensionFor(input.contentType);
    return this.put(key,input.bytes,input.contentType,{photoRole:input.role,surveyId:input.surveyId,findingId:input.findingId});
  }
}
