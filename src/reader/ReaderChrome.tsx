// Shared frame of the reading screen: top bar, tap zones for turning pages, bottom status line.
import type { ReactNode } from "react";
import type { Settings } from "../api";
import { t } from "../i18n";
import type { FrameStats } from "./frame-meter";

interface Props {
  title: string;
  status: string;
  loading: boolean;
  error: string | null;
  turnStats: FrameStats | null;
  settings: Settings;
  showFontSize?: boolean;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onTurn: (dir: 1 | -1) => void;
  children: ReactNode;
}

export function ReaderChrome(p: Props) {
  const fontSize = p.settings.fontSize ?? 18;
  return (
    <div className="reader">
      <header className="reader-bar">
        <button onClick={p.onBack}>{t("reader.back")}</button>
        <span className="reader-title">{p.title}</span>
        {p.showFontSize !== false && (
          <>
            <button onClick={() => p.onSettingsChange({ fontSize: Math.max(12, fontSize - 2) })}>{t("reader.fontSmaller")}</button>
            <button onClick={() => p.onSettingsChange({ fontSize: Math.min(40, fontSize + 2) })}>{t("reader.fontBigger")}</button>
          </>
        )}
        <label className="reader-toggle">
          <input
            type="checkbox"
            checked={p.settings.animated !== false}
            onChange={(e) => p.onSettingsChange({ animated: e.target.checked })}
          />
          {t("reader.animation")}
        </label>
      </header>
      <main className="reader-main">
        {p.children}
        <button className="tap-zone tap-prev" aria-label={t("reader.prev")} onClick={() => p.onTurn(-1)} />
        <button className="tap-zone tap-next" aria-label={t("reader.next")} onClick={() => p.onTurn(1)} />
        {p.loading && <div className="reader-overlay">{t("reader.loading")}</div>}
        {p.error && <div className="reader-overlay reader-error">{p.error}</div>}
      </main>
      <footer className="reader-status">
        <span>{p.status}</span>
        {p.turnStats && (
          <span>{t("reader.lastTurn", { fps: p.turnStats.fps, worst: p.turnStats.worstFrameMs })}</span>
        )}
      </footer>
    </div>
  );
}
