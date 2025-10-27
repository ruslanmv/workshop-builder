import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

const base = "stroke-current";

export const IconUpload = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

export const IconGlobe = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <circle cx="12" cy="12" r="9" strokeWidth="1.8"/>
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" strokeWidth="1.5"/>
  </svg>
);

export const IconGithub = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="currentColor" {...p}>
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.1c-3.2.7-3.88-1.39-3.88-1.39-.53-1.35-1.3-1.71-1.3-1.71-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.21 1.78 1.21 1.04 1.78 2.73 1.27 3.4.97.11-.76.41-1.27.75-1.56-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.2-3.07-.12-.3-.52-1.52.11-3.17 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.83 0c2.22-1.49 3.2-1.18 3.2-1.18.63 1.65.23 2.87.11 3.17.76.8 1.2 1.82 1.2 3.07 0 4.4-2.69 5.36-5.25 5.64.42.37.8 1.1.8 2.23v3.3c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/>
  </svg>
);

export const IconBook = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13a1 1 0 0 1-1.5.87L12 16l-4.5 2.87A1 1 0 0 1 6 18V5z" strokeWidth="1.8"/>
  </svg>
);

export const IconHat = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <path d="M2 11l10-5 10 5-10 5-10-5z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 13v3c3 2 9 2 12 0v-3" strokeWidth="1.5" />
  </svg>
);

export const IconNewspaper = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <rect x="3" y="4" width="14" height="16" rx="2" strokeWidth="1.8"/>
    <path d="M7 8h6M7 12h10M7 16h10" strokeWidth="1.5"/>
  </svg>
);

export const IconPdf = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" strokeWidth="1.8"/>
    <path d="M14 2v4h4" strokeWidth="1.5"/>
    <text x="8" y="16" fontSize="6" fill="currentColor">PDF</text>
  </svg>
);

export const IconZip = ({ size = 20, className = "", ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={`${base} ${className}`} fill="none" {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth="1.8"/>
    <path d="M10 6h4M10 8h4M10 10h4M12 12v6" strokeWidth="1.5"/>
  </svg>
);
