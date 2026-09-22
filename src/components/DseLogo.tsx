/**
 * A DSE company's mark: its uploaded logo, or its initials until it has one.
 *
 * A plain <img> rather than next/image, because most logos are served from
 * our own API route and there is nothing for the image optimiser to add.
 */
export function DseLogo({ logo, symbol, size = 34, className = "" }: {
  logo: string | null | undefined; symbol: string; size?: number; className?: string;
}) {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" width={size} height={size}
        className={`shrink-0 rounded-full border hairline bg-white object-cover ${className}`}
        style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[#0B7D3E] font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.32) }}
    >
      {symbol.slice(0, 3)}
    </span>
  );
}
