import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DownloadOriginalOptions {
  destinationPath: string;
  downloadEvent?: () => Promise<Buffer>;
  exposedResource?: () => Promise<Buffer>;
}
export interface DownloadResult { path: string; method: "download_event" | "exposed_resource"; byteLength: number; }

export async function downloadOriginal(options: DownloadOriginalOptions): Promise<DownloadResult> {
  if (!options.downloadEvent && !options.exposedResource) throw new Error("没有可用的原图下载来源；截图不允许作为结果");
  const partial = `${options.destinationPath}.${process.pid}.${Date.now()}.partial`;
  await mkdir(dirname(options.destinationPath), { recursive: true });
  try {
    let data: Buffer;
    let method: DownloadResult["method"];
    try {
      if (!options.downloadEvent) throw new Error("download event unavailable");
      data = await options.downloadEvent(); method = "download_event";
    } catch (eventError) {
      if (!options.exposedResource) throw eventError;
      data = await options.exposedResource(); method = "exposed_resource";
    }
    if (data.byteLength === 0) throw new Error("下载结果为空");
    await writeFile(partial, data, { flag: "wx" });
    await rename(partial, options.destinationPath);
    return { path: options.destinationPath, method, byteLength: data.byteLength };
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}
