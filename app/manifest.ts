import type { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mojo - AI-powered Search Engine",
    short_name: "Mojo",
    description: "A minimalistic AI-powered search engine that helps you find information on the internet using advanced AI models like GPT-4, Claude, and Grok",
    start_url: "/",
    display: "standalone",
    categories: ["search", "ai", "productivity"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon"
      },
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ],
    screenshots: [
      {
        src: "/opengraph-image.png",
        type: "image/png",
        sizes: "1200x630",
      }
    ]
  }
}