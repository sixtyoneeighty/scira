// https://env.t3.gg/docs/nextjs#validate-schema-on-build-(recommended)
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import withPWA from 'next-pwa'
const jiti = createJiti(fileURLToPath(import.meta.url))

// Import env here to validate during build. Using jiti we can import .ts files :)
jiti.import('./env/server')
jiti.import('./env/client')

/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ["geist"],
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff',
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY',
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin',
                    },
                ],
            },
        ]
    },
    async redirects() {
        return [
            {
                source: '/ph',
                destination: 'https://www.producthunt.com/posts/scira',
                permanent: true,
            },
        ]
    },
    images: {
        dangerouslyAllowSVG: true,
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'www.google.com',
                port: '',
                pathname: '/s2/favicons',
            },
           
            {
                protocol: 'https',
                hostname: 'metwm7frkvew6tn1.public.blob.vercel-storage.com',
                port: '',
                pathname: "**"
            },
            // upload.wikimedia.org
            {
                protocol: 'https',
                hostname: 'upload.wikimedia.org',
                port: '',
                pathname: '**'
            },
            // media.theresanaiforthat.com
            {
                protocol: 'https',
                hostname: 'media.theresanaiforthat.com',
                port: '',
                pathname: '**'
            },
            // www.uneed.best
            {
                protocol: 'https',
                hostname: 'www.uneed.best',
                port: '',
                pathname: '**'
            },
            // image.tmdb.org
            {
                protocol: 'https',
                hostname: 'image.tmdb.org',
                port: '',
                pathname: '/t/p/original/**'
            },
            // image.tmdb.org
            {
                protocol: 'https',
                hostname: 'image.tmdb.org',
                port: '',
                pathname: '/**'
            },
        ]
    },
    productionBrowserSourceMaps: true,
    webpack: (config, { dev, isServer }) => {
        // Enable better error logging in production
        if (!dev && !isServer) {
            // Use 'source-map' for better debugging but larger bundle size
            config.devtool = 'source-map'
            
            // Optimize source maps
            config.optimization = {
                ...config.optimization,
                minimize: true,
                splitChunks: {
                    chunks: 'all',
                    minSize: 20000,
                    maxSize: 244000,
                    minChunks: 1,
                    maxAsyncRequests: 30,
                    maxInitialRequests: 30,
                    cacheGroups: {
                        defaultVendors: {
                            test: /[\\/]node_modules[\\/]/,
                            priority: -10,
                            reuseExistingChunk: true,
                        },
                        default: {
                            minChunks: 2,
                            priority: -20,
                            reuseExistingChunk: true,
                        },
                    },
                },
            }
        }
        return config
    }
};

export default withPWA({
    dest: 'public',
    register: true,
    skipWaiting: true,
    disable: process.env.NODE_ENV === 'development'
})(nextConfig);
