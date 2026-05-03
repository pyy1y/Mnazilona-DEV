const nextConfig = {
  trailingSlash: false,
  async redirects() {
    return [
      {
        source: "/login",
        destination: "/admin/login",
        permanent: false,
        basePath: false,
      },
      {
        source: "/dashboard",
        destination: "/admin",
        permanent: false,
        basePath: false,
      },
      {
        source: "/dashboard/:path*",
        destination: "/admin/:path*",
        permanent: false,
        basePath: false,
      },
      {
        source: "/admin/dashboard",
        destination: "/admin",
        permanent: false,
        basePath: false,
      },
      {
        source: "/admin/dashboard/:path*",
        destination: "/admin/:path*",
        permanent: false,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
