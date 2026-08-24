/**
 * Wallet brand marks, drawn as inline SVG so they need no network request and
 * stay crisp at every size. Colours follow each brand's published palette.
 */

export function CoinbaseIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <circle cx="512" cy="512" r="512" fill="#0052FF" />
      <path
        fill="#fff"
        d="M516.3 361.8c56 0 100.4 34.4 117.2 86.4h115c-20.4-113.8-114-192.4-231.4-192.4-134.4 0-241.2 102.8-241.2 256.4s104.4 256.4 241.2 256.4c114.8 0 210-78.6 230.4-192.8h-114c-16.4 52-61.2 86.8-116.4 86.8-77.2 0-131.2-59.6-131.2-150.4.4-91.2 53.6-150.4 130.4-150.4Z"
      />
    </svg>
  );
}

export function PhantomIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
      <rect width="128" height="128" rx="28" fill="#AB9FF2" />
      {/* Dome body with three rounded feet along the base. */}
      <path
        fill="#FFFDF8"
        d="M20 66a44 44 0 0 1 88 0v22a13.5 13.5 0 0 1-27 0 13.5 13.5 0 0 1-27 0 13.5 13.5 0 0 1-27 0V66Z"
      />
      <ellipse cx="60" cy="60" rx="6.6" ry="10.5" fill="#AB9FF2" />
      <ellipse cx="85" cy="60" rx="6.6" ry="10.5" fill="#AB9FF2" />
    </svg>
  );
}

export function MetaMaskIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 38" className={className} aria-hidden="true">
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.5}>
        {/* horns */}
        <path d="M37.4 1 22.3 12.2l2.8-6.6L37.4 1Z" fill="#E2761B" stroke="#E2761B" />
        <path d="M2.6 1 17.5 12.3l-2.6-6.7L2.6 1Z" fill="#E4761B" stroke="#E4761B" />
        {/* upper cheeks */}
        <path d="M32 27.2l-4 6.2 8.6 2.4 2.4-8.4L32 27.2Z" fill="#E4761B" stroke="#E4761B" />
        <path d="M1 27.4l2.4 8.4 8.6-2.4-4-6.2-7 .2Z" fill="#E4761B" stroke="#E4761B" />
        {/* eyes row */}
        <path d="M11.5 16.5 9.2 20l8.5.4-.3-9.2-5.9 5.3Z" fill="#E4761B" stroke="#E4761B" />
        <path d="M28.5 16.5l-6-5.4-.2 9.3 8.5-.4-2.3-3.5Z" fill="#E4761B" stroke="#E4761B" />
        <path d="M12 33.4l5.2-2.5-4.5-3.5-.7 6Z" fill="#E4761B" stroke="#E4761B" />
        <path d="M22.8 30.9l5.2 2.5-.7-6-4.5 3.5Z" fill="#E4761B" stroke="#E4761B" />
        {/* snout */}
        <path d="M28 33.4l-5.2-2.5.4 3.4-.04 1.4 4.84-2.3Z" fill="#D7C1B3" stroke="#D7C1B3" />
        <path d="M12 33.4l4.84 2.3-.03-1.4.4-3.4-5.21 2.5Z" fill="#D7C1B3" stroke="#D7C1B3" />
        {/* mouth */}
        <path d="M16.9 25.9l-4.3-1.3 3.05-1.4 1.25 2.7Z" fill="#233447" stroke="#233447" />
        <path d="M23.1 25.9l1.25-2.7 3.07 1.4-4.32 1.3Z" fill="#233447" stroke="#233447" />
        {/* inner shadows */}
        <path d="M12 33.4l.74-6.2-4.74.14L12 33.4Z" fill="#CD6116" stroke="#CD6116" />
        <path d="M27.27 27.2l.73 6.2 4-6.06-4.73-.14Z" fill="#CD6116" stroke="#CD6116" />
        <path d="M30.8 20l-8.5.4.79 4.37 1.25-2.7 3.07 1.4L30.8 20Z" fill="#CD6116" stroke="#CD6116" />
        <path d="M12.6 24.6l3.05-1.4 1.25 2.7.79-4.37-8.5-.4 3.41 3.47Z" fill="#CD6116" stroke="#CD6116" />
        {/* brow highlights */}
        <path d="M9.2 20l3.56 6.94-.12-3.47L9.2 20Z" fill="#E4751F" stroke="#E4751F" />
        <path d="M27.37 23.47l-.14 3.47L30.8 20l-3.43 3.47Z" fill="#E4751F" stroke="#E4751F" />
        <path d="M17.7 20.4l-.79 4.37.99 5.1.22-6.72-.42-2.75Z" fill="#E4751F" stroke="#E4751F" />
        <path d="M22.3 20.4l-.41 2.74.21 6.73.99-5.1-.79-4.37Z" fill="#E4751F" stroke="#E4751F" />
        {/* muzzle */}
        <path d="M23.1 24.77l-.99 5.1.71.49 4.5-3.5.14-3.47-4.36 1.38Z" fill="#F6851B" stroke="#F6851B" />
        <path d="M12.6 23.39l.12 3.47 4.5 3.5.71-.49-.99-5.1-4.34-1.38Z" fill="#F6851B" stroke="#F6851B" />
        {/* chin */}
        <path d="M23.19 35.7l.04-1.4-.38-.33h-5.7l-.35.33.03 1.4-4.84-2.3 1.69 1.39 3.43 2.37h5.78l3.44-2.37 1.69-1.39-4.83 2.3Z" fill="#C0AD9E" stroke="#C0AD9E" />
        <path d="M22.82 30.36l-.71-.49h-4.22l-.71.49-.4 3.4.35-.33h5.7l.38.33-.39-3.4Z" fill="#161616" stroke="#161616" />
        {/* forehead */}
        <path d="M38.05 12.93 39.32 6.8 37.4 1 22.82 11.82l5.68 4.68 8.02 2.35 1.77-2.07-.77-.55 1.23-1.12-.95-.73 1.23-.94-.98-.71Z" fill="#763E1A" stroke="#763E1A" />
        <path d="M.68 6.8l1.28 6.13-.82.61 1.24.94-.94.73 1.22 1.12-.77.55 1.77 2.07 8.02-2.35 5.68-4.68L2.6 1 .68 6.8Z" fill="#763E1A" stroke="#763E1A" />
        <path d="m36.52 18.85-8.02-2.35 2.3 3.5-3.43 6.94 4.63-.06h6.05l-1.53-8.03Z" fill="#F6851B" stroke="#F6851B" />
        <path d="m11.5 16.5-8.02 2.35L1.96 26.88h6.04l4.62.06L9.2 20l2.3-3.5Z" fill="#F6851B" stroke="#F6851B" />
        <path d="m22.3 20.4.51-8.73 2.3-6.07H14.89l2.28 6.07.53 8.73.19 2.76.02 6.71h4.22l.02-6.71.15-2.76Z" fill="#F6851B" stroke="#F6851B" />
      </g>
    </svg>
  );
}
