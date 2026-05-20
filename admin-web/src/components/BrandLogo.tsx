import darkModeLogo from "../assets/dark-mode-oneto-logo.jpg";
import lightModeLogo from "../assets/light-mode-oneto-logo.jpg";
import type { ThemeMode } from "./ThemeToggle";

type BrandLogoProps = {
  theme: ThemeMode;
  className?: string;
  alt?: string;
};

export function BrandLogo({
  theme,
  className = "brand-logo",
  alt = "Oneto logo",
}: BrandLogoProps) {
  const src = theme === "dark" ? darkModeLogo : lightModeLogo;

  return <img className={className} src={src} alt={alt} />;
}
