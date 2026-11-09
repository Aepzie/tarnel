/** Ultra-subtle accent aurora + film grain. One static paint; nothing animates, nothing is composited. */
export function Aurora() {
  return (
    <>
      <div className="vt-aurora" aria-hidden="true" />
      <div className="vt-noise" aria-hidden="true" />
    </>
  );
}
