let ctx: AudioContext | null = null;

/** Short alert tone. Must be called from a user gesture at least once first. */
export function beep(kind: "critical" | "warn" | "info" = "info") {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const freqs = kind === "critical" ? [880, 1320] : kind === "warn" ? [660] : [440];
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.14 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.12);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.14);
    });
  } catch {
    /* audio unavailable */
  }
}
