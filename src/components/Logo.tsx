export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="All With PDF">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#001645" /><stop offset="1" stopColor="#039aa0" /></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill="url(#pg)" />
      <path d="M14 16.5V50a3.5 3.5 0 0 0 3.5 3.5H40" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
      <path d="M21 9h19.5L52 20.5V51a3 3 0 0 1-3 3H24a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M40.5 9v8.5a3 3 0 0 0 3 3H52z" fill="#8fe3e6" />
      <rect x="27" y="29" width="19" height="3.6" rx="1.8" fill="#0a5a85" />
      <rect x="27" y="36.5" width="19" height="3.6" rx="1.8" fill="#0a5a85" />
      <rect x="27" y="44" width="11" height="3.6" rx="1.8" fill="#0a5a85" />
    </svg>
  );
}
