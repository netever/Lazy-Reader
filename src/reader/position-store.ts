// Keeps the reading state of one book and writes it to disk shortly after each change,
// and right away when the app goes to the background (Android may kill it there).
import { deviceId, loadState, saveState } from "../api";
import { emptyState, withPosition, type Locator, type StateFile } from "./locator";

const SAVE_DELAY_MS = 800;

export class PositionStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private onHidden = () => {
    if (document.visibilityState === "hidden") void this.flush();
  };

  private constructor(
    private bookId: string,
    private state: StateFile,
    private onError: (error: unknown) => void,
  ) {
    document.addEventListener("visibilitychange", this.onHidden);
    window.addEventListener("pagehide", this.onHidden);
  }

  static async open(bookId: string, onError: (error: unknown) => void): Promise<PositionStore> {
    const [device, saved] = await Promise.all([deviceId(), loadState(bookId)]);
    return new PositionStore(bookId, saved ?? emptyState(bookId, device), onError);
  }

  get locator(): Locator | undefined {
    return this.state.position?.locator;
  }

  update(locator: Locator): void {
    this.state = withPosition(this.state, locator, Date.now());
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await saveState(this.bookId, this.state);
    } catch (e) {
      this.dirty = true;
      this.onError(e);
    }
  }

  async dispose(): Promise<void> {
    document.removeEventListener("visibilitychange", this.onHidden);
    window.removeEventListener("pagehide", this.onHidden);
    await this.flush();
  }
}
