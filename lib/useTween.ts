import { useEffect, useRef, useState } from 'react';

/**
 * JS-thread tween for values that can only be applied through React props
 * (e.g. map overlay fill colours, which native maps can't animate).
 * Eases toward `target` over `duration` ms with an ease-out cubic.
 */
export function useTween(target: number, duration = 240, initial = target) {
  const [value, setValue] = useState(initial);
  const from = useRef(initial);
  const current = useRef(initial);

  useEffect(() => {
    from.current = current.current;
    const start = Date.now();
    let frame: number;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = from.current + (target - from.current) * eased;
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** "#D70015" + 0.14 → "rgba(215,0,21,0.14)" */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
