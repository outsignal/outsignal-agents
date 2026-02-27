interface OutsignalLogoProps {
  /** Show just the icon mark, or icon + wordmark */
  variant?: "full" | "mark";
  className?: string;
  /** Color for the icon mark. Defaults to brand lime (#F0FF7A). Use "currentColor" to inherit text color. */
  iconColor?: string;
}

function LogoMark({ className, iconColor = "#F0FF7A" }: { className?: string; iconColor?: string }) {
  return (
    <svg
      viewBox="0 0 92 92"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M45.326 0c.492 0 .982.008 1.47.022 3.389.103 8.675.157 15.86.16h1.092c6.084-.002 13.46-.037 22.128-.107h.108c3.308.032 5.963 2.74 5.931 6.048l-.01.895c-.068 6.828-.104 12.949-.11 18.363v2.083c.005 7.049.068 12.814.188 17.295.011.412.016.825.016 1.24C92 71.405 71.103 92 45.326 92 23.088 92 4.694 76.604.004 56.083c-.094-.412 1.39-1.358 2.021-1.905 4.048-3.51 9.828-8.575 17.341-15.197-.905 2.673-1.396 5.537-1.396 8.517 0 14.653 11.879 26.532 26.532 26.532s26.533-11.879 26.533-26.532c0-14.654-11.88-26.533-26.533-26.533-7.36 0-14.019 2.997-18.826 7.836-4.923.023-9.02.036-12.289.038h-2.236c-3.018-.003-5.12-.016-6.305-.041-.537-.012-1.013-.018-1.429-.02h-.47c-.368.002-.675.009-.922.02C8.937 11.914 25.72 0 45.326 0Z"
        fill={iconColor}
      />
    </svg>
  );
}

/** Full logo: icon mark + "Outsignal" wordmark. Text uses currentColor so wrap in a text color class. */
function FullLogo({ className, iconColor = "#F0FF7A" }: { className?: string; iconColor?: string }) {
  return (
    <svg
      viewBox="0 0 628 126"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g transform="translate(26, 17)">
        <path
          d="M45.326 0c.492 0 .982.008 1.47.022 3.389.103 8.675.157 15.86.16h1.092c6.084-.002 13.46-.037 22.128-.107h.108c3.308.032 5.963 2.74 5.931 6.048l-.01.895c-.068 6.828-.104 12.949-.11 18.363v2.083c.005 7.049.068 12.814.188 17.295.011.412.016.825.016 1.24C92 71.405 71.103 92 45.326 92 23.088 92 4.694 76.604.004 56.083c-.094-.412 1.39-1.358 2.021-1.905 4.048-3.51 9.828-8.575 17.341-15.197-.905 2.673-1.396 5.537-1.396 8.517 0 14.653 11.879 26.532 26.532 26.532s26.533-11.879 26.533-26.532c0-14.654-11.88-26.533-26.533-26.533-7.36 0-14.019 2.997-18.826 7.836-4.923.023-9.02.036-12.289.038h-2.236c-3.018-.003-5.12-.016-6.305-.041-.537-.012-1.013-.018-1.429-.02h-.47c-.368.002-.675.009-.922.02C8.937 11.914 25.72 0 45.326 0Z"
          fill={iconColor}
        />
      </g>
      <text
        fontFamily="var(--font-montserrat), Montserrat, sans-serif"
        fontSize="89.85"
        fontWeight="800"
        letterSpacing="-3"
        fill="currentColor"
        x="172"
        y="98"
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
}: OutsignalLogoProps) {
  if (variant === "mark") {
    return <LogoMark className={className} iconColor={iconColor} />;
  }

  return <FullLogo className={className} iconColor={iconColor} />;
}
