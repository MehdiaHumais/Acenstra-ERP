import type { Metadata } from "next";
import { SettingsPlatformHub } from "@/components/settings-platform-hub";

export const metadata: Metadata = {
  title: "Platform Settings & Architecture | Ascentra ERP",
};

export default function SettingsPage() {
  return <SettingsPlatformHub defaultTab="settings" />;
}
