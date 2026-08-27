"use client";

/**
 * A person's picture, or their initials when they have not set one.
 *
 * Initials are coloured from the account id rather than at random, so the same
 * account is always the same colour — a face people recognise in the corner
 * without having uploaded anything.
 */
export function Avatar({
  src, name, email, size = 28,
}: {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const label = (name ?? email ?? "").trim();
  const initials = label
    ? label.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
    : "?";

  // Stable hue per account, so the colour is an identity rather than decoration.
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) % 360;

  if (src) {
    return (
      // Data URL from the account's own upload; next/image would add a loader
      // for no benefit at this size.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-medium text-white"
      style={{
        width: size, height: size,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        background: `linear-gradient(140deg, hsl(${hash} 62% 52%), hsl(${(hash + 40) % 360} 62% 42%))`,
      }}
    >
      {initials}
    </span>
  );
}
