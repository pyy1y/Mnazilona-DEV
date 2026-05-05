const nextConfig = {
  trailingSlash: false,
  assetPrefix: process.env.NODE_ENV === "production" ? "/landing-assets" : undefined,
};

export default nextConfig;
