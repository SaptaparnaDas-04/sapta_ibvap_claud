import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="label-hud">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <p className="label-hud">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold leading-none">{value}</p>
      {hint && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "warning" | "danger" | "accent" }) {
  const tones: Record<string, string> = {
    muted: "border-border bg-secondary text-muted-foreground",
    primary: "border-primary/40 bg-primary/10 text-primary",
    warning: "border-warning/40 bg-warning/10 text-warning",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
    accent: "border-accent/40 bg-accent/10 text-accent",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function ThemeToggle() {
  // Starts "dark" to match the inline head script's default (see __root.tsx)
  // and syncs to the real stored value once mounted, so SSR and the first
  // client render agree and React doesn't complain about a mismatch.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rounded-sm border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </TooltipTrigger>
      <TooltipContent>Switch to {theme === "dark" ? "light" : "dark"} mode</TooltipContent>
    </Tooltip>
  );
}

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/dashboard", label: "Command Grid" },
  { to: "/live", label: "Live Analytics" },
  { to: "/capture", label: "Field Capture" },
  { to: "/architecture", label: "Architecture" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-primary/50 bg-primary/10 font-display text-sm font-bold text-primary">
            IB
          </span>
          <span className="font-display text-lg font-bold tracking-wide">
            IBVAP
            <span className="ml-2 hidden font-mono text-[10px] font-normal uppercase tracking-widest text-muted-foreground sm:inline">
              Intelligent Border Video Analytics
            </span>
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary text-primary" }}
            >
              {n.label}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          IBVAP — software-defined surveillance for existing CCTV
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          Prototype build · demonstration data
        </p>
      </div>
    </footer>
  );
}
