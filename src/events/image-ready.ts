import type { ImageResult } from "../images/validate.js";
import { EventWriter } from "./writer.js";

export class ImageReadyEmitter {
  private readonly emittedIds = new Set<string>();
  private readonly emittedHashes = new Set<string>();
  public constructor(private readonly writer: EventWriter) {}
  public emit(taskId: string, image: ImageResult, completed: number, target: number): boolean {
    if (this.emittedIds.has(image.resultId) || this.emittedHashes.has(image.sha256)) return false;
    this.emittedIds.add(image.resultId); this.emittedHashes.add(image.sha256);
    this.writer.write({ taskId, type: "image_ready", state: "validating", message: `图片 ${completed}/${target} 已就绪`, completed, target, recoverable: false, image });
    return true;
  }
}
