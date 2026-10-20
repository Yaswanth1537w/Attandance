import type { ReactNode } from "react";
import { PortalShell } from "@/src/components/portal-shell";

export default function InchargeLayout({ children }: { children: ReactNode }) {
  return <PortalShell role="incharge">{children}</PortalShell>;
}
