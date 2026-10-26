// Measures how smooth a page turn is: frames per second and the longest gap between frames.
// A gap above ~50 ms is a visible jerk. Results go to the screen and to perf.log (docs/PERF.md).

export interface FrameStats {
  fps: number;
  worstFrameMs: number;
  frames: number;
}

export function measureFrames(durationMs: number): Promise<FrameStats> {
  return new Promise((resolve) => {
    const times: number[] = [];
    const step = (now: number) => {
      times.push(now);
      if (now - times[0] < durationMs) requestAnimationFrame(step);
      else resolve(summarize(times));
    };
    requestAnimationFrame(step);
  });
}

export function summarize(times: number[]): FrameStats {
  if (times.length < 2) return { fps: 0, worstFrameMs: 0, frames: times.length };
  let worst = 0;
  for (let i = 1; i < times.length; i++) worst = Math.max(worst, times[i] - times[i - 1]);
  const span = times[times.length - 1] - times[0];
  return {
    fps: Math.round(((times.length - 1) * 1000) / span),
    worstFrameMs: Math.round(worst),
    frames: times.length,
  };
}
