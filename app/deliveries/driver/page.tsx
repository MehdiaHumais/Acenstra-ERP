import type { Metadata } from "next";
import { DriverPwa } from "@/components/driver-pwa";

export const metadata: Metadata = {
  title: "Driver PWA | Ascentra ERP",
  description: "Mobile-first offline-capable delivery execution, vehicle inspections, cold chain logging & proof of delivery.",
};

export default function DriverPage() {
  return (
    <div className="min-h-screen bg-muted/20 py-4">
      <DriverPwa />
    </div>
  );
}
