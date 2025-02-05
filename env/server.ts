// https://env.t3.gg/docs/nextjs#create-your-schema
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const serverEnv = createEnv({
  server: {
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    KV_REST_REST_URL: z.string().min(1).url(),
    KV_REST_REST_TOKEN: z.string().min(1),
    ELEVENLABS_API_KEY: z.string().min(1),
    TAVILY_API_KEY: z.string().min(1),
    EXA_API_KEY: z.string().min(1),
    TMDB_API_KEY: z.string().min(1),
    YT_ENDPOINT: z.string().min(1),
    FIRECRAWL_API_KEY: z.string().min(1),
    OPENWEATHER_API_KEY: z.string().min(1),
    SANDBOX_TEMPLATE_ID: z.string().min(1),
    GOOGLE_MAPS_API_KEY: z.string().min(1),
    MAPBOX_ACCESS_TOKEN: z.string().min(1),
    TRIPADVISOR_API_KEY: z.string().min(1),
    AVIATION_STACK_API_KEY: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    YELP_API_KEY: z.string().min(1),
    PERPLEXITY_API_KEY: z.string().min(1),
  },
  experimental__runtimeEnv: process.env,
})
