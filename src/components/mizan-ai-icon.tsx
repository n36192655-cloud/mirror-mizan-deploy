interface Props {
  className?: string;
  size?: number;
}

export function MizanAiIcon({ className, size = 24 }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mizan-ai-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--water, #0ea5e9)" />
          <stop offset="100%" stopColor="var(--electric-2, #6366f1)" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#mizan-ai-grad)" opacity="0.12" />
      {/* Beam */}
      <path d="M8 16 L40 16" stroke="url(#mizan-ai-grad)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Pillar */}
      <path d="M24 16 L24 36" stroke="url(#mizan-ai-grad)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Base */}
      <path d="M17 36 L31 36" stroke="url(#mizan-ai-grad)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Left pan */}
      <path d="M8 16 L4 24 Q4 27 8 27 Q12 27 12 24 L8 16 Z" fill="url(#mizan-ai-grad)" opacity="0.85" />
      {/* Right pan */}
      <path d="M40 16 L36 24 Q36 27 40 27 Q44 27 44 24 L40 16 Z" fill="url(#mizan-ai-grad)" opacity="0.85" />
      {/* Circuit dots */}
      <circle cx="8" cy="16" r="1.6" fill="white" />
      <circle cx="40" cy="16" r="1.6" fill="white" />
      <circle cx="24" cy="16" r="1.8" fill="white" />
      <circle cx="24" cy="36" r="1.6" fill="white" />
    </svg>
  );
}
