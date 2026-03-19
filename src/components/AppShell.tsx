"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/import/risk-alerts", label: "Alerts" },
  { href: "/import", label: "Import" },
  { href: "/import/uploads", label: "Uploads" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/import") return pathname === "/import";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="min-h-screen w-full">
        <main className="min-w-0">
          <div className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/90">
            <div className="flex items-center gap-3">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  aria-label="Open navigation menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  title="Open navigation menu"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M3 5.75A.75.75 0 0 1 3.75 5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.75Zm0 4.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10Zm.75 3.5a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H3.75Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {menuOpen && (
                  <div
                    className="absolute left-0 top-full z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
                    role="menu"
                  >

                    <nav className="mt-2 space-y-1">
                      {navItems.map((item) => {
                        const active = isActive(pathname, item.href);

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center rounded-xl px-3 py-2 text-sm font-medium transition ${
                              active
                                ? "bg-slate-900 text-white"
                                : "text-slate-700 hover:bg-slate-100"
                            }`}
                            role="menuitem"
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </nav>
                  </div>
                )}
              </div>

              <Link
                href="/dashboard"
                className="flex items-center shrink-0"
                aria-label="Go to dashboard"
              >
                <Image
                  src="/logo.png"
                  alt="Company logo"
                  width={36}
                  height={36}
                  className="h-9 w-auto object-contain"
                  priority
                />
              </Link>

              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900">{title}</div>
                {subtitle ? (
                  <div className="text-sm text-slate-500">{subtitle}</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}