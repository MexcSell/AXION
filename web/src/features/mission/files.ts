export interface LocalFile { id: string; name: string; size: number; type: string; url?: string; }
let fid = 1;
export function filesFrom(list: FileList | File[]): LocalFile[] {
  return Array.from(list).map((f) => ({ id: 'f' + fid++, name: f.name, size: f.size, type: f.type, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }));
}
