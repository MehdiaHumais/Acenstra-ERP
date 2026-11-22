import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/admin-dashboard";

export const metadata: Metadata = {
  title: "Administration — User Management | Ascentra ERP",
  description:
    "Invite people by email or create accounts with a temporary password, track invitation status, and manage store/warehouse access — every action audited.",
};

export default function AdminPage() {
  return (
    <Suspense>
      <AdminDashboard />
    </Suspense>
  );
}
