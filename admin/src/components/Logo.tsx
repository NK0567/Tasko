/** Pin de localisation Tasko (vert / jaune). */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M24 3C15.2 3 8 10 8 18.8 8 30.5 24 45 24 45s16-14.5 16-26.2C40 10 32.8 3 24 3z" fill="#1A9A50" />
      <path d="M24 3C15.2 3 8 10 8 18.8c0 3 1 6.2 2.6 9.3L24 3z" fill="#0F7A3D" />
      <circle cx="24" cy="19" r="8.5" fill="#F5B700" />
      <circle cx="24" cy="19" r="3.6" fill="#0B3D2E" />
    </svg>
  );
}
