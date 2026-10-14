import type { NextConfig } from "next";
import { buildCsp } from "./lib/csp";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Solo informa (no bloquea) hasta revisar los informes de /api/csp-report; luego pasar a Content-Security-Policy, idealmente con nonces.
  { key: "Content-Security-Policy-Report-Only", value: buildCsp(process.env.NEXT_PUBLIC_SUPABASE_URL) },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
