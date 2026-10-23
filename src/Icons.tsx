import { GITHUB_MARK } from './brand';

export function GitHubMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={GITHUB_MARK} />
    </svg>
  );
}

/** The lamp: its lit ring with Mona's silhouette inside. */
export function LampMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="#0fbf3e" strokeWidth="3.6" />
      <path
        fill="#0fbf3e"
        d="M11.6 17.4c0-2.7 1.6-4.4 4.4-4.4s4.4 1.7 4.4 4.4c0 .9-.2 1.6-.6 2.3.2.4.4.7 1 .8-.7.7-1.7.6-2.3 0h-5c-.6.6-1.6.7-2.3-.1.6 0 .9-.4 1-.8-.4-.7-.6-1.4-.6-2.2Zm.9-4.9-.4-2.1 2 1.2Zm7 0 .4-2.1-2 1.2Z"
      />
    </svg>
  );
}
