import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Prisma's engine is a native binary; bundling it breaks the client at
  // runtime. Keep it external so it resolves from node_modules on the server.
  serverExternalPackages: ["@prisma/client", "@uptick/db"],
  typedRoutes: true,
};

export default config;
