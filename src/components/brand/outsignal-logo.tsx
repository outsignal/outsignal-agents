import { useId } from "react";

interface OutsignalLogoProps {
  /** Show just the icon mark, icon + wordmark, or wordmark only */
  variant?: "full" | "mark" | "wordmark";
  className?: string;
  /** Color for the icon mark purple top half. Defaults to brand purple (#635BFF). */
  iconColor?: string;
  /** When true, uses lighter bottom half (#454545) suited for dark backgrounds. */
  darkBg?: boolean;
}

function LogoMark({
  className,
  iconColor = "#635BFF",
  darkBg = false,
}: {
  className?: string;
  iconColor?: string;
  darkBg?: boolean;
}) {
  const id = useId();
  const clipId = `logo-clip-${id}`;
  const bottomColor = darkBg ? "#454545" : "#2F2F2F";
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="100" cy="100" r="96" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M0,0 H200 V86 C160,114 130,84 100,74 C70,64 40,118 0,94 V0 Z"
          fill={iconColor}
        />
        <path
          d="M0,112 C40,136 70,82 100,92 C130,102 160,132 200,104 V200 H0 Z"
          fill={bottomColor}
        />
      </g>
    </svg>
  );
}

/** Full logo: icon mark + "Outsignal" wordmark. Text uses currentColor so wrap in a text color class. */
function FullLogo({
  className,
  iconColor = "#635BFF",
  darkBg = false,
}: {
  className?: string;
  iconColor?: string;
  darkBg?: boolean;
}) {
  const id = useId();
  const clipId = `full-logo-clip-${id}`;
  const bottomColor = darkBg ? "#454545" : "#2F2F2F";
  return (
    <svg
      viewBox="0 0 628 126"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="100" cy="100" r="96" />
        </clipPath>
      </defs>
      <g transform="translate(5, 5) scale(0.58)">
        <g clipPath={`url(#${clipId})`}>
          <path
            d="M0,0 H200 V86 C160,114 130,84 100,74 C70,64 40,118 0,94 V0 Z"
            fill={iconColor}
          />
          <path
            d="M0,112 C40,136 70,82 100,92 C130,102 160,132 200,104 V200 H0 Z"
            fill={bottomColor}
          />
        </g>
      </g>
      <text
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
        fontSize="89.85"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="currentColor"
        x="170"
        y="98"
      >
        Outsignal
      </text>
    </svg>
  );
}

/** Wordmark only: "Outsignal" text without icon mark. */
function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 456 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <text
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
        fontSize="89.85"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="currentColor"
        x="0"
        y="80"
      >
        Outsignal
      </text>
    </svg>
  );
}

export function OutsignalLogo({
  variant = "full",
  className,
  iconColor,
  darkBg,
}: OutsignalLogoProps) {
  if (variant === "mark") {
    return <LogoMark className={className} iconColor={iconColor} darkBg={darkBg} />;
  }
  if (variant === "wordmark") {
    return <Wordmark className={className} />;
  }

  return <FullLogo className={className} iconColor={iconColor} darkBg={darkBg} />;
}
