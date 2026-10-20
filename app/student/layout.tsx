import type { ReactNode } from "react";
import { PortalShell } from "@/src/components/portal-shell";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <PortalShell role="student">{children}</PortalShell>;
}
