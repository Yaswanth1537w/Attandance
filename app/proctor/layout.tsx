import type { ReactNode } from "react";
import { PortalShell } from "@/src/components/portal-shell";

export default function ProctorLayout({ children }: { children: ReactNode }) {
  return <PortalShell role="proctor">{children}</PortalShell>;
}
