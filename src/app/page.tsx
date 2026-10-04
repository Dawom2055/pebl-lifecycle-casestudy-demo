"use client";

import { AdminView } from "@/components/admin/AdminView";
import { AiAgentView } from "@/components/AiAgentView";
import { EmployeeView } from "@/components/employee/EmployeeView";
import { HrView } from "@/components/hr/HrView";
import { DemoProvider, useDemo } from "@/lib/store";

export default function Page() {
  return (
    <DemoProvider>
      <Views />
    </DemoProvider>
  );
}

function Views() {
  const demo = useDemo();
  if (!demo.ready) return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading demo…</div>;
  if (demo.aiPage) return <AiAgentView />;
  if (demo.role === "admin") return <AdminView />;
  if (demo.role === "hr") return <HrView />;
  return <EmployeeView />;
}
