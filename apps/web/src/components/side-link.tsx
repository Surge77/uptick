"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar item that knows whether it is the current section.
 *
 * `exact` exists because the monitors tab lives at the org root, which is a
 * prefix of every other section and would otherwise always look active.
 */
export function SideLink({
  href,
  label,
  icon,
  exact = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className="side-link"
      data-active={active}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </Link>
  );
}
