import type { Metadata } from "next";
import { SettingsPlatformHub } from "@/components/settings-platform-hub";

export const metadata: Metadata = {
  title: "System Architecture & Scope | Ascentra ERP",
};

export default function ProposalPage() {
  return <SettingsPlatformHub defaultTab="architecture" />;
}
