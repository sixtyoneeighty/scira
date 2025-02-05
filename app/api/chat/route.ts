// /app/api/chat/route.ts
import { getGroupConfig } from '@/app/actions';
import { serverEnv } from '@/env/server';
import { google } from '@ai-sdk/google';
import CodeInterpreter from '@e2b/code-interpreter';
import FirecrawlApp from '@mendable/firecrawl-js';
import { tavily } from '@tavily/core';
import { convertToCoreMessages, smoothStream, streamText, tool } from 'ai';
import Exa from 'exa-js';
import { z } from 'zod';

// Allow streaming responses up to 60 seconds
export const maxDuration = 120;

interface MapboxFeature {
    id: string;
    name: string;
    formatted_address: string;
    geometry: {
        type: string;
        coordinates: number[];
    };
    feature_type: string;
    context: string;
    coordinates: number[];
    bbox: number[];
    source: string;
}

interface GoogleResult {
    place_id: string;
    formatted_address: string;
    geometry: {
        location: {
            lat: number;
            lng: number;
        };
        viewport: {
            northeast: {
                lat: number;
                lng: number;
            };
            southwest: {
                lat: number;
                lng: number;
            };
        };
    };
    types: string[];
    address_components: Array<{
        long_name: string;
        short_name: string;
        types: string[];
    }>;
}

interface VideoDetails {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    type?: string;
    provider_name?: string;
    provider_url?: string;
}

interface VideoResult {
    videoId: string;
    url: string;
    details?: VideoDetails;
    captions?: string;
    timestamps?: string[];
    views?: string;
    likes?: string;
    summary?: string;
}

function sanitizeUrl(url: string): string {
    return url.replace(/\s+/g, '%20');
}

async function isValidImageUrl(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
        });

        clearTimeout(timeout);

        return response.ok && (response.headers.get('content-type')?.startsWith('image/') ?? false);
    } catch {
        return false;
    }
}

function errorHandler(error: unknown) {
    if (error == null) {
        return 'unknown error';
    }

    if (typeof error === 'string') {
        return error;
    }

    if (error instanceof Error) {
        // Log the entire error object to your server logs for debugging
        console.error("[API] Error details:", {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause
        });
        return error.message; // Return only the message to the client
    }

    return JSON.stringify(error);
}

function mode(arr: any[]): any {
    return arr.reduce((a, b, i, arr) =>
        (arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b), arr[0]);
}

const formatters = {
    temperature: (temp: number) => `${Math.round(temp)}°F`,
    distance: (meters: number) => `${(meters / 1609.34).toFixed(1)} miles`,
    price: (level: string) => level || 'Price not available',
    rating: (rating: number) => `${rating} ★`,
    percentage: (value: number) => `${Math.round(value)}%`,
    date: (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString(),
    time: (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString(),
};

interface ResponseTemplate {
    summary: string;
    details: Record<string, any>;
    markdown?: string;
}

function createMarkdownResponse(template: ResponseTemplate): string {
    let markdown = `## ${template.summary}\n\n`;
    
    if (template.details) {
        Object.entries(template.details).forEach(([section, data]) => {
            markdown += `### ${section}\n`;
            if (Array.isArray(data)) {
                data.forEach((item: any) => {
                    markdown += `- ${item}\n`;
                });
            } else if (typeof data === 'object') {
                Object.entries(data).forEach(([key, value]) => {
                    markdown += `- **${key}**: ${value}\n`;
                });
            } else {
                markdown += `${data}\n`;
            }
            markdown += '\n';
        });
    }

    if (template.markdown) {
        markdown += template.markdown;
    }

    return markdown;
}

export async function POST(req: Request) {
    try {
        // Log request details
        console.log("[API] Request headers:", Object.fromEntries(req.headers.entries()));
        
        if (!req.body) {
            throw new Error('Request body is empty');
        }

        const { messages, group } = await req.json().catch(() => {
            throw new Error('Failed to parse request body as JSON');
        });

        console.log("[API] Received messages:", messages);
        console.log("[API] Selected group:", group);

        if (!messages || !Array.isArray(messages)) {
            throw new Error('Invalid messages format');
        }

        if (!group) {
            throw new Error('Group parameter is required');
        }

        const { tools: activeTools, systemPrompt } = await getGroupConfig(group).catch((error) => {
            console.error('[API] Failed to get group config:', error);
            throw new Error('Failed to load configuration');
        });

        if (!serverEnv.GOOGLE_GENERATIVE_AI_API_KEY) {
            throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured');
        }

        const model = google('gemini-2.0-flash-exp', {
            safetySettings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
            ],
        });

        console.log("[API] Model initialized");

        const result = streamText({
            model,
            messages: convertToCoreMessages(messages),
            experimental_transform: smoothStream({
                chunking: 'word',
                delayInMs: 25,        // Slightly increased delay for better readability
            }),
            temperature: 0.7,  // Increase creativity while maintaining coherence
            experimental_activeTools: [...activeTools],
            system: systemPrompt + `\n\nImportant Response Guidelines:
- Always provide detailed analysis of tool results
- Use natural, conversational language
- Include specific examples and details
- Organize information in clear sections
- Explain your reasoning and insights
- Make connections between different pieces of information
- Offer relevant suggestions or recommendations
- Use markdown formatting for better readability`,
            tools: {
                stock_chart: tool({
                    description: 'Write and execute Python code to find stock data and generate a stock chart.',
                    parameters: z.object({
                        title: z.string().describe('The title of the chart.'),
                        code: z.string().describe('The Python code to execute.'),
                        icon: z
                            .enum(['stock', 'date', 'calculation', 'default'])
                            .describe('The icon to display for the chart.'),
                    }),
                    execute: async ({ code, title, icon }: { code: string; title: string; icon: string }) => {
                        console.log('Code:', code);
                        console.log('Title:', title);
                        console.log('Icon:', icon);

                        const sandbox = await CodeInterpreter.create(serverEnv.SANDBOX_TEMPLATE_ID!);
                        const execution = await sandbox.runCode(code);
                        let message = '';

                        if (execution.results.length > 0) {
                            for (const result of execution.results) {
                                if (result.isMainResult) {
                                    message += `${result.text}\n`;
                                } else {
                                    message += `${result.text}\n`;
                                }
                            }
                        }

                        if (execution.logs.stdout.length > 0 || execution.logs.stderr.length > 0) {
                            if (execution.logs.stdout.length > 0) {
                                message += `${execution.logs.stdout.join('\n')}\n`;
                            }
                            if (execution.logs.stderr.length > 0) {
                                message += `${execution.logs.stderr.join('\n')}\n`;
                            }
                        }

                        if (execution.error) {
                            message += `Error: ${execution.error}\n`;
                            console.log('Error: ', execution.error);
                        }

                        console.log(execution.results);
                        if (execution.results[0].chart) {
                            execution.results[0].chart.elements.map((element: any) => {
                                console.log(element.points);
                            });
                        }

                        return {
                            message: message.trim(),
                            chart: execution.results[0].chart ?? '',
                        };
                    },
                }),
                currency_converter: tool({
                    description: 'Convert currency from one to another using yfinance',
                    parameters: z.object({
                        from: z.string().describe('The source currency code.'),
                        to: z.string().describe('The target currency code.'),
                        amount: z.number().default(1).describe('The amount to convert.'),
                    }),
                    execute: async ({ from, to }: { from: string; to: string }) => {
                        const code = `
  import yfinance as yf
  from_currency = '${from}'
  to_currency = '${to}'
  currency_pair = f'{from_currency}{to_currency}=X'
  data = yf.Ticker(currency_pair).history(period='1d')
  latest_rate = data['Close'].iloc[-1]
  latest_rate
  `;
                        console.log('Currency pair:', from, to);

                        const sandbox = await CodeInterpreter.create(serverEnv.SANDBOX_TEMPLATE_ID!);
                        const execution = await sandbox.runCode(code);
                        let message = '';

                        if (execution.results.length > 0) {
                            for (const result of execution.results) {
                                if (result.isMainResult) {
                                    message += `${result.text}\n`;
                                } else {
                                    message += `${result.text}\n`;
                                }
                            }
                        }

                        if (execution.logs.stdout.length > 0 || execution.logs.stderr.length > 0) {
                            if (execution.logs.stdout.length > 0) {
                                message += `${execution.logs.stdout.join('\n')}\n`;
                            }
                            if (execution.logs.stderr.length > 0) {
                                message += `${execution.logs.stderr.join('\n')}\n`;
                            }
                        }

                        if (execution.error) {
                            message += `Error: ${execution.error}\n`;
                            console.log('Error: ', execution.error);
                        }

                        return { rate: message.trim() };
                    },
                }),
                web_search: tool({
                    description: 'Search the web using Perplexity API for detailed, contextual information.',
                    parameters: z.object({
                        query: z.string().describe('The search query'),
                        focus: z.enum(['writing', 'analysis', 'coding', 'math', 'general']).optional()
                            .describe('Focus area for the search').default('general'),
                        mode: z.enum(['concise', 'detailed']).optional()
                            .describe('Response detail level').default('detailed'),
                    }),
                    execute: async ({ query, focus = 'general', mode = 'detailed' }) => {
                        try {
                            if (!serverEnv.PERPLEXITY_API_KEY) {
                                throw new Error('PERPLEXITY_API_KEY is not configured');
                            }

                            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                                method: 'POST',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${serverEnv.PERPLEXITY_API_KEY}`
                                },
                                body: JSON.stringify({
                                    model: mode === 'detailed' ? 'sonar-medium-online' : 'sonar-small-online',
                                    messages: [
                                        {
                                            role: 'system',
                                            content: `You are a web search assistant focused on ${focus}. 
                                            Provide ${mode} responses with accurate, up-to-date information.
                                            Include sources and citations when available.
                                            Focus on extracting key insights and making connections between different pieces of information.`
                                        },
                                        {
                                            role: 'user',
                                            content: query
                                        }
                                    ],
                                    options: {
                                        search_queries: true,
                                        follow_up_questions: true
                                    }
                                })
                            });

                            if (!response.ok) {
                                throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
                            }

                            const data = await response.json();

                            // Process and structure the response
                            const result = {
                                answer: data.choices[0].message.content,
                                search_queries: data.search_queries || [],
                                sources: data.sources || [],
                                follow_up_questions: data.follow_up_questions || [],
                                metadata: {
                                    model: data.model,
                                    focus,
                                    mode,
                                    timestamp: new Date().toISOString()
                                }
                            };

                            // Create a markdown-formatted response
                            const markdown = createMarkdownResponse({
                                summary: 'Search Results',
                                details: {
                                    'Main Answer': result.answer,
                                    'Sources': result.sources.map((source: any) => `- [${source.title}](${source.url})`),
                                    'Related Questions': result.follow_up_questions,
                                    'Search Context': `Focus: ${focus}, Mode: ${mode}`
                                }
                            });

                            return {
                                ...result,
                                markdown
                            };
                        } catch (error) {
                            console.error('Perplexity search error:', error);
                            throw error;
                        }
                    },
                }),
                tmdb_search: tool({
                    description: 'Search for a movie or TV show using TMDB API',
                    parameters: z.object({
                        query: z.string().describe('The search query for movies/TV shows'),
                    }),
                    execute: async ({ query }: { query: string }) => {
                        const TMDB_API_KEY = serverEnv.TMDB_API_KEY;
                        const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

                        try {
                            // First do a multi-search to get the top result
                            const searchResponse = await fetch(
                                `${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(
                                    query,
                                )}&include_adult=true&language=en-US&page=1`,
                                {
                                    headers: {
                                        Authorization: `Bearer ${TMDB_API_KEY}`,
                                        accept: 'application/json',
                                    },
                                },
                            );

                            const searchResults = await searchResponse.json();

                            // Get the first movie or TV show result
                            const firstResult = searchResults.results.find(
                                (result: any) => result.media_type === 'movie' || result.media_type === 'tv',
                            );

                            if (!firstResult) {
                                return { result: null };
                            }

                            // Get detailed information for the media
                            const detailsResponse = await fetch(
                                `${TMDB_BASE_URL}/${firstResult.media_type}/${firstResult.id}?language=en-US`,
                                {
                                    headers: {
                                        Authorization: `Bearer ${TMDB_API_KEY}`,
                                        accept: 'application/json',
                                    },
                                },
                            );

                            const details = await detailsResponse.json();

                            // Get additional credits information
                            const creditsResponse = await fetch(
                                `${TMDB_BASE_URL}/${firstResult.media_type}/${firstResult.id}/credits?language=en-US`,
                                {
                                    headers: {
                                        Authorization: `Bearer ${TMDB_API_KEY}`,
                                        accept: 'application/json',
                                    },
                                },
                            );

                            const credits = await creditsResponse.json();

                            // Format the result
                            const result = {
                                ...details,
                                media_type: firstResult.media_type,
                                credits: {
                                    cast:
                                        credits.cast?.slice(0, 5).map((person: any) => ({
                                            ...person,
                                            profile_path: person.profile_path
                                                ? `https://image.tmdb.org/t/p/original${person.profile_path}`
                                                : null,
                                        })) || [],
                                    director: credits.crew?.find((person: any) => person.job === 'Director')?.name,
                                    writer: credits.crew?.find(
                                        (person: any) => person.job === 'Screenplay' || person.job === 'Writer',
                                    )?.name,
                                },
                                poster_path: details.poster_path
                                    ? `https://image.tmdb.org/t/p/original${details.poster_path}`
                                    : null,
                                backdrop_path: details.backdrop_path
                                    ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
                                    : null,
                            };

                            return { result };
                        } catch (error) {
                            console.error('TMDB search error:', error);
                            throw error;
                        }
                    },
                }),
                trending_movies: tool({
                    description: 'Get trending movies from TMDB',
                    parameters: z.object({}),
                    execute: async () => {
                        const TMDB_API_KEY = serverEnv.TMDB_API_KEY;
                        const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

                        try {
                            const response = await fetch(`${TMDB_BASE_URL}/trending/movie/day?language=en-US`, {
                                headers: {
                                    Authorization: `Bearer ${TMDB_API_KEY}`,
                                    accept: 'application/json',
                                },
                            });

                            const data = await response.json();
                            const results = data.results.map((movie: any) => ({
                                ...movie,
                                poster_path: movie.poster_path
                                    ? `https://image.tmdb.org/t/p/original${movie.poster_path}`
                                    : null,
                                backdrop_path: movie.backdrop_path
                                    ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
                                    : null,
                            }));

                            return { results };
                        } catch (error) {
                            console.error('Trending movies error:', error);
                            throw error;
                        }
                    },
                }),
                trending_tv: tool({
                    description: 'Get trending TV shows from TMDB',
                    parameters: z.object({}),
                    execute: async () => {
                        const TMDB_API_KEY = serverEnv.TMDB_API_KEY;
                        const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

                        try {
                            const response = await fetch(`${TMDB_BASE_URL}/trending/tv/day?language=en-US`, {
                                headers: {
                                    Authorization: `Bearer ${TMDB_API_KEY}`,
                                    accept: 'application/json',
                                },
                            });

                            const data = await response.json();
                            const results = data.results.map((show: any) => ({
                                ...show,
                                poster_path: show.poster_path
                                    ? `https://image.tmdb.org/t/p/original${show.poster_path}`
                                    : null,
                                backdrop_path: show.backdrop_path
                                    ? `https://image.tmdb.org/t/p/original${show.backdrop_path}`
                                    : null,
                            }));

                            return { results };
                        } catch (error) {
                            console.error('Trending TV shows error:', error);
                            throw error;
                        }
                    },
                }),
                academic_search: tool({
                    description: 'Search academic papers and research.',
                    parameters: z.object({
                        query: z.string().describe('The search query'),
                    }),
                    execute: async ({ query }: { query: string }) => {
                        try {
                            const exa = new Exa(serverEnv.EXA_API_KEY as string);

                            // Search academic papers with content summary
                            const result = await exa.searchAndContents(query, {
                                type: 'auto',
                                numResults: 20,
                                category: 'research paper',
                                summary: {
                                    query: 'Abstract of the Paper',
                                },
                            });

                            // Process and clean results
                            const processedResults = result.results.reduce<typeof result.results>((acc, paper) => {
                                // Skip if URL already exists or if no summary available
                                if (acc.some((p) => p.url === paper.url) || !paper.summary) return acc;

                                // Clean up summary (remove "Summary:" prefix if exists)
                                const cleanSummary = paper.summary.replace(/^Summary:\s*/i, '');

                                // Clean up title (remove [...] suffixes)
                                const cleanTitle = paper.title?.replace(/\s\[.*?\]$/, '');

                                acc.push({
                                    ...paper,
                                    title: cleanTitle || '',
                                    summary: cleanSummary,
                                });

                                return acc;
                            }, []);

                            // Take only the first 10 unique, valid results
                            const limitedResults = processedResults.slice(0, 10);

                            return {
                                results: limitedResults,
                            };
                        } catch (error) {
                            console.error('Academic search error:', error);
                            throw error;
                        }
                    },
                }),
                youtube_search: tool({
                    description: 'Search YouTube videos using Exa AI and get detailed video information.',
                    parameters: z.object({
                        query: z.string().describe('The search query for YouTube videos'),
                        no_of_results: z.number().default(5).describe('The number of results to return'),
                    }),
                    execute: async ({ query, no_of_results }: { query: string; no_of_results: number }) => {
                        try {
                            const exa = new Exa(serverEnv.EXA_API_KEY as string);

                            // Simple search to get YouTube URLs only
                            const searchResult = await exa.search(query, {
                                type: 'keyword',
                                numResults: no_of_results,
                                includeDomains: ['youtube.com'],
                            });

                            // Process results
                            const processedResults = await Promise.all(
                                searchResult.results.map(async (result): Promise<VideoResult | null> => {
                                    const videoIdMatch = result.url.match(
                                        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
                                    );
                                    const videoId = videoIdMatch?.[1];

                                    if (!videoId) return null;

                                    // Base result
                                    const baseResult: VideoResult = {
                                        videoId,
                                        url: result.url,
                                    };

                                    try {
                                        // Fetch detailed info from our endpoints
                                        const [detailsResponse, captionsResponse, timestampsResponse] = await Promise.all([
                                            fetch(`${serverEnv.YT_ENDPOINT}/video-data`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                    url: result.url,
                                                }),
                                            }).then((res) => (res.ok ? res.json() : null)),
                                            fetch(`${serverEnv.YT_ENDPOINT}/video-captions`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                    url: result.url,
                                                }),
                                            }).then((res) => (res.ok ? res.text() : null)),
                                            fetch(`${serverEnv.YT_ENDPOINT}/video-timestamps`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                    url: result.url,
                                                }),
                                            }).then((res) => (res.ok ? res.json() : null)),
                                        ]);

                                        // Return combined data
                                        return {
                                            ...baseResult,
                                            details: detailsResponse || undefined,
                                            captions: captionsResponse || undefined,
                                            timestamps: timestampsResponse || undefined,
                                        };
                                    } catch (error) {
                                        console.error(`Error fetching details for video ${videoId}:`, error);
                                        return baseResult;
                                    }
                                }),
                            );

                            // Filter out null results
                            const validResults = processedResults.filter(
                                (result): result is VideoResult => result !== null,
                            );

                            return {
                                results: validResults,
                            };
                        } catch (error) {
                            console.error('YouTube search error:', error);
                            throw error;
                        }
                    },
                }),
                retrieve: tool({
                    description: 'Retrieve the information from a URL using Firecrawl.',
                    parameters: z.object({
                        url: z.string().describe('The URL to retrieve the information from.'),
                    }),
                    execute: async ({ url }: { url: string }) => {
                        const app = new FirecrawlApp({
                            apiKey: serverEnv.FIRECRAWL_API_KEY,
                        });
                        try {
                            const content = await app.scrapeUrl(url);
                            if (!content.success || !content.metadata) {
                                return { error: 'Failed to retrieve content' };
                            }
                            return {
                                results: [
                                    {
                                        title: content.metadata.title,
                                        content: content.markdown,
                                        url: content.metadata.sourceURL,
                                        description: content.metadata.description,
                                        language: content.metadata.language,
                                    },
                                ],
                            };
                        } catch (error) {
                            console.error('Firecrawl API error:', error);
                            return { error: 'Failed to retrieve content' };
                        }
                    },
                }),
                get_weather_data: tool({
                    description: 'Get the weather data for a city.',
                    parameters: z.object({
                        city: z.string().describe('The name of the city to get weather data for.'),
                    }),
                    execute: async ({ city }: { city: string }) => {
                        const apiKey = serverEnv.OPENWEATHER_API_KEY;
                        
                        // First, get coordinates from city name using geocoding API
                        const geoResponse = await fetch(
                            `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`
                        );
                        const geoData = await geoResponse.json();
                        
                        if (!geoData || geoData.length === 0) {
                            throw new Error('City not found');
                        }
                        
                        const { lat, lon } = geoData[0];
                        
                        // Get current weather
                        const currentWeatherResponse = await fetch(
                            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`
                        );
                        const currentWeather = await currentWeatherResponse.json();
                        
                        // Get forecast data
                        const forecastResponse = await fetch(
                            `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`
                        );
                        const forecastData = await forecastResponse.json();

                        // Process current weather
                        const current = {
                            temperature: Math.round(currentWeather.main.temp),
                            feels_like: Math.round(currentWeather.main.feels_like),
                            conditions: currentWeather.weather[0].main,
                            description: currentWeather.weather[0].description,
                            humidity: currentWeather.main.humidity,
                            wind_speed: Math.round(currentWeather.wind.speed),
                            wind_direction: currentWeather.wind.deg,
                            sunrise: new Date(currentWeather.sys.sunrise * 1000).toLocaleTimeString(),
                            sunset: new Date(currentWeather.sys.sunset * 1000).toLocaleTimeString(),
                        };

                        // Process forecast data
                        const forecast = forecastData.list.reduce((acc: any[], item: any) => {
                            const date = new Date(item.dt * 1000);
                            const day = date.toLocaleDateString('en-US', { weekday: 'long' });
                            const time = date.toLocaleTimeString('en-US', { hour: 'numeric' });
                            
                            acc.push({
                                day,
                                time,
                                temperature: Math.round(item.main.temp),
                                feels_like: Math.round(item.main.feels_like),
                                conditions: item.weather[0].main,
                                description: item.weather[0].description,
                                humidity: item.main.humidity,
                                wind_speed: Math.round(item.wind.speed),
                                precipitation_chance: Math.round(item.pop * 100),
                            });
                            
                            return acc;
                        }, []);

                        // Group forecast by day
                        const dailyForecasts = forecast.reduce((acc: any, item: any) => {
                            if (!acc[item.day]) {
                                acc[item.day] = {
                                    temperatures: [],
                                    conditions: [],
                                    precipitation_chances: [],
                                };
                            }
                            acc[item.day].temperatures.push(item.temperature);
                            acc[item.day].conditions.push(item.conditions);
                            acc[item.day].precipitation_chances.push(item.precipitation_chance);
                            return acc;
                        }, {});

                        // Calculate daily summaries
                        const dailySummaries = Object.entries(dailyForecasts).map(([day, data]: [string, any]) => ({
                            day,
                            high: Math.max(...data.temperatures),
                            low: Math.min(...data.temperatures),
                            dominant_conditions: mode(data.conditions),
                            max_precipitation_chance: Math.max(...data.precipitation_chances),
                        }));

                        // Create natural language summaries
                        const currentSummary = `Currently ${current.temperature}°F, feels like ${current.feels_like}°F, with ${current.description}. Humidity is ${current.humidity}% with wind speed of ${current.wind_speed} mph.`;
                        
                        const forecastSummary = `5-day forecast shows temperatures ranging from ${Math.min(...dailySummaries.map(d => d.low))}°F to ${Math.max(...dailySummaries.map(d => d.high))}°F, with ${dailySummaries[0].dominant_conditions.toLowerCase()} conditions expected for ${dailySummaries[0].day}.`;

                        return {
                            location: {
                                name: geoData[0].name,
                                country: geoData[0].country,
                                state: geoData[0].state,
                                coordinates: { lat, lon },
                            },
                            current: {
                                ...current,
                                summary: currentSummary,
                            },
                            forecast: {
                                hourly: forecast,
                                daily: dailySummaries,
                                summary: forecastSummary,
                            },
                            units: {
                                temperature: "Fahrenheit",
                                wind_speed: "mph",
                                precipitation: "percentage"
                            }
                        };
                    },
                }),
                restaurant_finder: tool({
                    description: 'Find restaurants and businesses using Yelp, with detailed filters and sorting options.',
                    parameters: z.object({
                        location: z.string().describe('Location to search in (city, address, or zip code)'),
                        term: z.string().optional().describe('Search term (e.g., "sushi", "pizza", "coffee")'),
                        price: z.string().optional().describe('Price level (1-4, can be combined like "1,2,3")'),
                        categories: z.string().optional().describe('Category filter (e.g., "japanese,sushi")'),
                        sort_by: z.enum(['best_match', 'rating', 'review_count', 'distance']).optional(),
                        open_now: z.boolean().optional(),
                        radius: z.number().optional().describe('Search radius in meters (max 40000)'),
                        limit: z.number().min(1).max(50).default(20).describe('Number of results to return'),
                    }),
                    execute: async ({ 
                        location, 
                        term, 
                        price, 
                        categories,
                        sort_by = 'best_match',
                        open_now,
                        radius,
                        limit = 20
                    }) => {
                        try {
                            if (!serverEnv.YELP_API_KEY) {
                                throw new Error('YELP_API_KEY is not configured');
                            }

                            // Build query parameters
                            const params = new URLSearchParams({
                                location,
                                limit: limit.toString(),
                                sort_by: sort_by || 'best_match'
                            });

                            // Add optional parameters
                            if (term) params.append('term', term);
                            if (price) params.append('price', price);
                            if (categories) params.append('categories', categories);
                            if (open_now !== undefined) params.append('open_now', open_now.toString());
                            if (radius) params.append('radius', Math.min(radius, 40000).toString());

                            // Make request to Yelp API
                            const response = await fetch(
                                `https://api.yelp.com/v3/businesses/search?${params.toString()}`,
                                {
                                    headers: {
                                        'Authorization': `Bearer ${serverEnv.YELP_API_KEY}`,
                                        'Accept': 'application/json',
                                    },
                                }
                            );

                            if (!response.ok) {
                                throw new Error(`Yelp API error: ${response.status} ${response.statusText}`);
                            }

                            const data = await response.json();

                            // Process and enhance the results
                            const enhancedResults = await Promise.all(data.businesses.map(async (business: any) => {
                                try {
                                    // Get additional business details
                                    const detailsResponse = await fetch(
                                        `https://api.yelp.com/v3/businesses/${business.id}`,
                                        {
                                            headers: {
                                                'Authorization': `Bearer ${serverEnv.YELP_API_KEY}`,
                                                'Accept': 'application/json',
                                            },
                                        }
                                    );

                                    const details = await detailsResponse.json();

                                    // Get reviews
                                    const reviewsResponse = await fetch(
                                        `https://api.yelp.com/v3/businesses/${business.id}/reviews`,
                                        {
                                            headers: {
                                                'Authorization': `Bearer ${serverEnv.YELP_API_KEY}`,
                                                'Accept': 'application/json',
                                            },
                                        }
                                    );

                                    const reviews = await reviewsResponse.json();

                                    // Format price level for readability
                                    const priceText = business.price ? business.price : 'Price not available';
                                    
                                    // Format categories
                                    const categoryText = business.categories
                                        ?.map((cat: any) => cat.title)
                                        .join(', ') || 'Categories not available';

                                    // Format address
                                    const address = business.location?.display_address?.join(', ') || 'Address not available';

                                    // Format distance
                                    const distance = business.distance 
                                        ? `${(business.distance / 1609.34).toFixed(1)} miles away`
                                        : 'Distance not available';

                                    // Format hours
                                    const currentDay = new Date().getDay();
                                    const todayHours = details.hours?.[0]?.open
                                        ?.find((day: any) => day.day === currentDay);
                                    
                                    const formatTime = (time: string) => {
                                        const hour = parseInt(time.slice(0, 2));
                                        const minute = time.slice(2);
                                        return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
                                    };

                                    const hoursText = todayHours
                                        ? `Open today ${formatTime(todayHours.start)} - ${formatTime(todayHours.end)}`
                                        : business.is_closed
                                            ? 'Closed now'
                                            : 'Hours not available';

                                    // Format top review
                                    const topReview = reviews.reviews?.[0] ? {
                                        text: reviews.reviews[0].text,
                                        rating: reviews.reviews[0].rating,
                                        time_created: reviews.reviews[0].time_created,
                                        username: reviews.reviews[0].user.name
                                    } : null;

                                    // Create a natural language summary
                                    const summary = `${business.name} is a ${categoryText} establishment ${distance}. ${
                                        business.rating
                                    } stars from ${business.review_count} reviews. ${priceText}. ${hoursText}. Located at ${address}.`;

                                    // Return formatted data
                                    return {
                                        basic_info: {
                                            id: business.id,
                                            name: business.name,
                                            summary,
                                            rating: business.rating,
                                            review_count: business.review_count,
                                            price: priceText,
                                            categories: categoryText,
                                            distance,
                                            is_closed: business.is_closed,
                                        },
                                        location: {
                                            address,
                                            coordinates: business.coordinates,
                                            neighborhood: business.location?.neighborhood,
                                        },
                                        contact: {
                                            phone: business.phone,
                                            url: business.url,
                                        },
                                        hours: {
                                            status: hoursText,
                                            full_hours: details.hours?.[0]?.open || [],
                                            special_hours: details.special_hours || [],
                                        },
                                        photos: details.photos || [],
                                        featured_review: topReview,
                                        additional_info: {
                                            transactions: business.transactions,
                                            attributes: details.business_attributes || {},
                                        }
                                    };
                                } catch (error) {
                                    console.error(`Error fetching details for ${business.id}:`, error);
                                    // Return basic formatted information if details fetch fails
                                    return {
                                        basic_info: {
                                            id: business.id,
                                            name: business.name,
                                            summary: `${business.name} is a ${business.categories?.map((cat: any) => cat.title).join(', ') || 'business'} with ${business.rating} stars from ${business.review_count} reviews.`,
                                            rating: business.rating,
                                            review_count: business.review_count,
                                            price: business.price || 'Price not available',
                                            categories: business.categories?.map((cat: any) => cat.title).join(', ') || 'Categories not available',
                                            distance: business.distance ? `${(business.distance / 1609.34).toFixed(1)} miles away` : 'Distance not available',
                                            is_closed: business.is_closed,
                                        },
                                        location: {
                                            address: business.location?.display_address?.join(', ') || 'Address not available',
                                            coordinates: business.coordinates,
                                        },
                                        contact: {
                                            phone: business.phone,
                                            url: business.url,
                                        }
                                    };
                                }
                            }));

                            // Create a summary of the search results
                            const searchSummary = `Found ${data.total} ${term || 'restaurants/businesses'} in ${location}${
                                price ? ` with price level ${price}` : ''
                            }${categories ? ` in categories: ${categories}` : ''
                            }${open_now ? ', currently open' : ''
                            }${radius ? `, within ${(radius / 1609.34).toFixed(1)} miles` : ''}.`;

                            // Group results by rating for better organization
                            const groupedResults = {
                                excellent: enhancedResults.filter(r => r.basic_info.rating >= 4.5),
                                veryGood: enhancedResults.filter(r => r.basic_info.rating >= 4 && r.basic_info.rating < 4.5),
                                good: enhancedResults.filter(r => r.basic_info.rating >= 3.5 && r.basic_info.rating < 4),
                                other: enhancedResults.filter(r => r.basic_info.rating < 3.5),
                            };

                            return {
                                search_summary: searchSummary,
                                total_results: data.total,
                                region: data.region,
                                grouped_results: groupedResults,
                                all_results: enhancedResults,
                            };
                        } catch (error) {
                            console.error('Restaurant finder error:', error);
                            throw error;
                        }
                    },
                }),
                code_interpreter: tool({
                    description: 'Write and execute Python code.',
                    parameters: z.object({
                        title: z.string().describe('The title of the code snippet.'),
                        code: z
                            .string()
                            .describe(
                                'The Python code to execute. put the variables in the end of the code to print them. do not use the print function.',
                            ),
                        icon: z
                            .enum(['stock', 'date', 'calculation', 'default'])
                            .describe('The icon to display for the code snippet.'),
                    }),
                    execute: async ({ code, title, icon }: { code: string; title: string; icon: string }) => {
                        console.log('Code:', code);
                        console.log('Title:', title);
                        console.log('Icon:', icon);

                        const sandbox = await CodeInterpreter.create(serverEnv.SANDBOX_TEMPLATE_ID!);
                        const execution = await sandbox.runCode(code);
                        let message = '';

                        if (execution.results.length > 0) {
                            for (const result of execution.results) {
                                if (result.isMainResult) {
                                    message += `${result.text}\n`;
                                } else {
                                    message += `${result.text}\n`;
                                }
                            }
                        }

                        if (execution.logs.stdout.length > 0 || execution.logs.stderr.length > 0) {
                            if (execution.logs.stdout.length > 0) {
                                message += `${execution.logs.stdout.join('\n')}\n`;
                            }
                            if (execution.logs.stderr.length > 0) {
                                message += `${execution.logs.stderr.join('\n')}\n`;
                            }
                        }

                        if (execution.error) {
                            message += `Error: ${execution.error}\n`;
                            console.log('Error: ', execution.error);
                        }

                        console.log(execution.results);
                        if (execution.results[0].chart) {
                            execution.results[0].chart.elements.map((element: any) => {
                                console.log(element.points);
                            });
                        }

                        return {
                            message: message.trim(),
                            chart: execution.results[0].chart ?? '',
                        };
                    },
                }),
                find_place: tool({
                    description:
                        'Find a place using Google Maps API for forward geocoding and Mapbox for reverse geocoding.',
                    parameters: z.object({
                        query: z.string().describe('The search query for forward geocoding'),
                        coordinates: z.array(z.number()).describe('Array of [latitude, longitude] for reverse geocoding'),
                    }),
                    execute: async ({ query, coordinates }: { query: string; coordinates: number[] }) => {
                        try {
                            // Forward geocoding with Google Maps API
                            const googleApiKey = serverEnv.GOOGLE_MAPS_API_KEY;
                            const googleResponse = await fetch(
                                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
                                    query,
                                )}&key=${googleApiKey}`,
                            );
                            const googleData = await googleResponse.json();

                            // Reverse geocoding with Mapbox
                            const mapboxToken = serverEnv.MAPBOX_ACCESS_TOKEN;
                            const [lat, lng] = coordinates;
                            const mapboxResponse = await fetch(
                                `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${mapboxToken}`,
                            );
                            const mapboxData = await mapboxResponse.json();

                            // Process and combine results
                            const features = [];

                            // Process Google results
                            if (googleData.status === 'OK' && googleData.results.length > 0) {
                                features.push(
                                    ...googleData.results.map((result: GoogleResult) => ({
                                        id: result.place_id,
                                        name: result.formatted_address.split(',')[0],
                                        formatted_address: result.formatted_address,
                                        geometry: {
                                            type: 'Point',
                                            coordinates: [result.geometry.location.lng, result.geometry.location.lat],
                                        },
                                        feature_type: result.types[0],
                                        address_components: result.address_components,
                                        viewport: result.geometry.viewport,
                                        place_id: result.place_id,
                                        source: 'google',
                                    })),
                                );
                            }

                            // Process Mapbox results
                            if (mapboxData.features && mapboxData.features.length > 0) {
                                features.push(
                                    ...mapboxData.features.map(
                                        (feature: any): MapboxFeature => ({
                                            id: feature.id,
                                            name: feature.properties.name_preferred || feature.properties.name,
                                            formatted_address: feature.properties.full_address,
                                            geometry: feature.geometry,
                                            feature_type: feature.properties.feature_type,
                                            context: feature.properties.context,
                                            coordinates: feature.properties.coordinates,
                                            bbox: feature.properties.bbox,
                                            source: 'mapbox',
                                        }),
                                    ),
                                );
                            }

                            return {
                                features,
                                google_attribution: 'Powered by Google Maps Platform',
                                mapbox_attribution: 'Powered by Mapbox',
                            };
                        } catch (error) {
                            console.error('Geocoding error:', error);
                            throw error;
                        }
                    },
                }),
                text_search: tool({
                    description: 'Perform a text-based search for places using Mapbox API.',
                    parameters: z.object({
                        query: z.string().describe("The search query (e.g., '123 main street')."),
                        location: z.string().describe("The location to center the search (e.g., '42.3675294,-71.186966')."),
                        radius: z.number().describe('The radius of the search area in meters (max 50000).'),
                    }),
                    execute: async ({ query, location, radius }: { query: string; location?: string; radius?: number }) => {
                        const mapboxToken = serverEnv.MAPBOX_ACCESS_TOKEN;

                        let proximity = '';
                        if (location) {
                            const [lng, lat] = location.split(',').map(Number);
                            proximity = `&proximity=${lng},${lat}`;
                        }

                        const response = await fetch(
                            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
                                query,
                            )}.json?types=poi${proximity}&access_token=${mapboxToken}`,
                        );
                        const data = await response.json();

                        // If location and radius provided, filter results by distance
                        let results = data.features;
                        if (location && radius) {
                            const [centerLng, centerLat] = location.split(',').map(Number);
                            const radiusInDegrees = radius / 111320;
                            results = results.filter((feature: any) => {
                                const [placeLng, placeLat] = feature.center;
                                const distance = Math.sqrt(
                                    Math.pow(placeLng - centerLng, 2) + Math.pow(placeLat - centerLat, 2),
                                );
                                return distance <= radiusInDegrees;
                            });
                        }

                        return {
                            results: results.map((feature: any) => ({
                                name: feature.text,
                                formatted_address: feature.place_name,
                                geometry: {
                                    location: {
                                        lat: feature.center[1],
                                        lng: feature.center[0],
                                    },
                                },
                            })),
                        };
                    },
                }),
                nearby_search: tool({
                    description: 'Search for nearby places, such as restaurants or hotels based on the details given.',
                    parameters: z.object({
                        location: z.string().describe('The location name given by user.'),
                        latitude: z.number().describe('The latitude of the location.'),
                        longitude: z.number().describe('The longitude of the location.'),
                        type: z
                            .string()
                            .describe('The type of place to search for (restaurants, hotels, attractions, geos).'),
                        radius: z.number().default(6000).describe('The radius in meters (max 50000, default 6000).'),
                    }),
                    execute: async ({
                        location,
                        latitude,
                        longitude,
                        type,
                        radius,
                    }: {
                        latitude: number;
                        longitude: number;
                        location: string;
                        type: string;
                        radius: number;
                    }) => {
                        const apiKey = serverEnv.TRIPADVISOR_API_KEY;
                        let finalLat = latitude;
                        let finalLng = longitude;

                        try {
                            // Try geocoding first
                            const geocodingData = await fetch(
                                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
                                    location,
                                )}&key=${serverEnv.GOOGLE_MAPS_API_KEY}`,
                            );

                            const geocoding = await geocodingData.json();

                            if (geocoding.results?.[0]?.geometry?.location) {
                                let trimmedLat = geocoding.results[0].geometry.location.lat.toString().split('.');
                                finalLat = parseFloat(trimmedLat[0] + '.' + trimmedLat[1].slice(0, 6));
                                let trimmedLng = geocoding.results[0].geometry.location.lng.toString().split('.');
                                finalLng = parseFloat(trimmedLng[0] + '.' + trimmedLng[1].slice(0, 6));
                                console.log('Using geocoded coordinates:', finalLat, finalLng);
                            } else {
                                console.log('Using provided coordinates:', finalLat, finalLng);
                            }

                            // Get nearby places
                            const nearbyResponse = await fetch(
                                `https://api.content.tripadvisor.com/api/v1/location/nearby_search?latLong=${finalLat},${finalLng}&category=${type}&radius=${radius}&language=en&key=${apiKey}`,
                                {
                                    method: 'GET',
                                    headers: {
                                        Accept: 'application/json',
                                        origin: 'https://mplx.local',
                                        referer: 'https://mplx.local',
                                    },
                                },
                            );

                            if (!nearbyResponse.ok) {
                                throw new Error(`Nearby search failed: ${nearbyResponse.status}`);
                            }

                            const nearbyData = await nearbyResponse.json();

                            if (!nearbyData.data || nearbyData.data.length === 0) {
                                console.log('No nearby places found');
                                return {
                                    results: [],
                                    center: { lat: finalLat, lng: finalLng },
                                };
                            }

                            // Process each place
                            const detailedPlaces = await Promise.all(
                                nearbyData.data.map(async (place: any) => {
                                    try {
                                        if (!place.location_id) {
                                            console.log(`Skipping place "${place.name}": No location_id`);
                                            return null;
                                        }

                                        // Fetch place details
                                        const detailsResponse = await fetch(
                                            `https://api.content.tripadvisor.com/api/v1/location/${place.location_id}/details?language=en&currency=USD&key=${apiKey}`,
                                            {
                                                method: 'GET',
                                                headers: {
                                                    Accept: 'application/json',
                                                    origin: 'https://mplx.local',
                                                    referer: 'https://mplx.local',
                                                },
                                            },
                                        );

                                        if (!detailsResponse.ok) {
                                            console.log(`Failed to fetch details for "${place.name}"`);
                                            return null;
                                        }

                                        const details = await detailsResponse.json();

                                        console.log(`Place details for "${place.name}":`, details);

                                        // Fetch place photos
                                        let photos = [];
                                        try {
                                            const photosResponse = await fetch(
                                                `https://api.content.tripadvisor.com/api/v1/location/${place.location_id}/photos?language=en&key=${apiKey}`,
                                                {
                                                    method: 'GET',
                                                    headers: {
                                                        Accept: 'application/json',
                                                        origin: 'https://mplx.local',
                                                        referer: 'https://mplx.local',
                                                    },
                                                },
                                            );

                                            if (photosResponse.ok) {
                                                const photosData = await photosResponse.json();
                                                photos =
                                                    photosData.data
                                                        ?.map((photo: any) => ({
                                                            thumbnail: photo.images?.thumbnail?.url,
                                                            small: photo.images?.small?.url,
                                                            medium: photo.images?.medium?.url,
                                                            large: photo.images?.large?.url,
                                                            original: photo.images?.original?.url,
                                                            caption: photo.caption,
                                                        }))
                                                        .filter((photo: any) => photo.medium) || [];
                                            }
                                        } catch (error) {
                                            console.log(`Photo fetch failed for "${place.name}":`, error);
                                        }

                                        // Get timezone for the location
                                        const tzResponse = await fetch(
                                            `https://maps.googleapis.com/maps/api/timezone/json?location=${
                                                details.latitude
                                            },${details.longitude}&timestamp=${Math.floor(Date.now() / 1000)}&key=${
                                                serverEnv.GOOGLE_MAPS_API_KEY
                                            }`,
                                        );
                                        const tzData = await tzResponse.json();
                                        const timezone = tzData.timeZoneId || 'UTC';

                                        // Process hours and status with timezone
                                        const localTime = new Date(
                                            new Date().toLocaleString('en-US', {
                                                timeZone: timezone,
                                            }),
                                        );
                                        const currentDay = localTime.getDay();
                                        const currentHour = localTime.getHours();
                                        const currentMinute = localTime.getMinutes();
                                        const currentTime = currentHour * 100 + currentMinute;

                                        let is_closed = true;
                                        let next_open_close = null;
                                        let next_day = currentDay;

                                        if (details.hours?.periods) {
                                            // Sort periods by day and time for proper handling of overnight hours
                                            const sortedPeriods = [...details.hours.periods].sort((a, b) => {
                                                if (a.open.day !== b.open.day) return a.open.day - b.open.day;
                                                return parseInt(a.open.time) - parseInt(b.open.time);
                                            });

                                            // Find current or next opening period
                                            for (let i = 0; i < sortedPeriods.length; i++) {
                                                const period = sortedPeriods[i];
                                                const openTime = parseInt(period.open.time);
                                                const closeTime = period.close ? parseInt(period.close.time) : 2359;
                                                const periodDay = period.open.day;

                                                // Handle overnight hours
                                                if (closeTime < openTime) {
                                                    // Place is open from previous day
                                                    if (currentDay === periodDay && currentTime < closeTime) {
                                                        is_closed = false;
                                                        next_open_close = period.close.time;
                                                        break;
                                                    }
                                                    // Place is open today and extends to tomorrow
                                                    if (currentDay === periodDay && currentTime >= openTime) {
                                                        is_closed = false;
                                                        next_open_close = period.close.time;
                                                        next_day = (periodDay + 1) % 7;
                                                        break;
                                                    }
                                                } else {
                                                    // Normal hours within same day
                                                    if (
                                                        currentDay === periodDay &&
                                                        currentTime >= openTime &&
                                                        currentTime < closeTime
                                                    ) {
                                                        is_closed = false;
                                                        next_open_close = period.close.time;
                                                        break;
                                                    }
                                                }

                                                // Find next opening time if currently closed
                                                if (is_closed) {
                                                    if (
                                                        periodDay > currentDay ||
                                                        (periodDay === currentDay && openTime > currentTime)
                                                    ) {
                                                        next_open_close = period.open.time;
                                                        next_day = periodDay;
                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                        // Return processed place data
                                        return {
                                            name: place.name || 'Unnamed Place',
                                            location: {
                                                lat: parseFloat(details.latitude || place.latitude || finalLat),
                                                lng: parseFloat(details.longitude || place.longitude || finalLng),
                                            },
                                            timezone,
                                            place_id: place.location_id,
                                            vicinity: place.address_obj?.address_string || '',
                                            distance: parseFloat(place.distance || '0'),
                                            bearing: place.bearing || '',
                                            type: type,
                                            rating: parseFloat(details.rating || '0'),
                                            price_level: details.price_level || '',
                                            cuisine: details.cuisine?.[0]?.name || '',
                                            description: details.description || '',
                                            phone: details.phone || '',
                                            website: details.website || '',
                                            reviews_count: parseInt(details.num_reviews || '0'),
                                            is_closed,
                                            hours: details.hours?.weekday_text || [],
                                            next_open_close,
                                            next_day,
                                            periods: details.hours?.periods || [],
                                            photos,
                                            source: details.source?.name || 'TripAdvisor',
                                        };
                                    } catch (error) {
                                        console.log(`Failed to process place "${place.name}":`, error);
                                        return null;
                                    }
                                }),
                            );

                            // Filter and sort results
                            const validPlaces = detailedPlaces
                                .filter((place) => place !== null)
                                .sort((a, b) => (a?.distance || 0) - (b?.distance || 0));

                            return {
                                results: validPlaces,
                                center: { lat: finalLat, lng: finalLng },
                            };
                        } catch (error) {
                            console.error('Nearby search error:', error);
                            throw error;
                        }
                    },
                }),
                track_flight: tool({
                    description: 'Track flight information and status',
                    parameters: z.object({
                        flight_number: z.string().describe('The flight number to track'),
                    }),
                    execute: async ({ flight_number }: { flight_number: string }) => {
                        try {
                            const response = await fetch(
                                `https://api.aviationstack.com/v1/flights?access_key=${serverEnv.AVIATION_STACK_API_KEY}&flight_iata=${flight_number}`,
                            );
                            return await response.json();
                        } catch (error) {
                            console.error('Flight tracking error:', error);
                            throw error;
                        }
                    },
                }),
            },
            onChunk(event) {
                if (event.chunk.type === 'tool-call') {
                    console.log('[API] Tool called:', event.chunk.toolName);
                }
            },
            onStepFinish(event) {
                if (event.warnings) {
                    console.warn('[API] Step warnings:', event.warnings);
                }
            },
            onFinish(event) {
                if (event.finishReason === 'error') {
                    console.error('[API] Stream finished with error:', event.response);
                } else {
                    console.log('[API] Finish reason:', event.finishReason);
                    console.log('[API] Steps:', event.steps);
                }
            },
        });

        try {
            console.log("[API] Creating stream response");
            return result.toDataStreamResponse({ getErrorMessage: errorHandler });
        } catch (error) {
            console.error('[API] Failed to create stream response:', error);
            throw new Error('Failed to create response stream');
        }
    } catch (error) {
        console.error('[API] Chat route error:', error);
        
        // Enhanced error handling with specific error types
        let statusCode = 500;
        let errorMessage = 'An unexpected error occurred';
        let errorCode = 'INTERNAL_SERVER_ERROR';

        if (error instanceof Error) {
            // Parse validation errors
            if (error.message.includes('parse') || error.message.includes('Invalid')) {
                statusCode = 400;
                errorCode = 'VALIDATION_ERROR';
                errorMessage = error.message;
            } 
            // Configuration errors
            else if (error.message.includes('not configured')) {
                statusCode = 503;
                errorCode = 'SERVICE_UNAVAILABLE';
                errorMessage = 'Service is temporarily unavailable';
            }
            // API rate limits
            else if (error.message.includes('rate limit') || error.message.includes('429')) {
                statusCode = 429;
                errorCode = 'RATE_LIMIT_EXCEEDED';
                errorMessage = 'Rate limit exceeded. Please try again later';
            }
            // Authentication errors
            else if (error.message.includes('unauthorized') || error.message.includes('authentication')) {
                statusCode = 401;
                errorCode = 'UNAUTHORIZED';
                errorMessage = 'Authentication failed';
            }
            // Model errors
            else if (error.message.includes('model')) {
                statusCode = 400;
                errorCode = 'MODEL_ERROR';
                errorMessage = error.message;
            }
            // Stream errors
            else if (error.message.includes('stream')) {
                statusCode = 500;
                errorCode = 'STREAM_ERROR';
                errorMessage = 'Failed to create response stream';
            }
            // Default error handling
            else {
                errorMessage = error.message;
            }
        }

        // Create a detailed error response
        const errorResponse = {
            error: errorMessage,
            code: errorCode,
            status: statusCode,
            timestamp: new Date().toISOString(),
            request_id: crypto.randomUUID(),
            details: process.env.NODE_ENV === 'development' ? {
                stack: error instanceof Error ? error.stack : undefined,
                cause: error instanceof Error ? error.cause : undefined,
                name: error instanceof Error ? error.name : undefined,
            } : undefined,
        };

        // Log the error details for debugging
        console.error('[API] Error details:', {
            ...errorResponse,
            stack: error instanceof Error ? error.stack : undefined,
        });

        return new Response(JSON.stringify(errorResponse), {
            status: statusCode,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, must-revalidate',
                'X-Error-Code': errorCode,
                'X-Request-ID': errorResponse.request_id,
            },
        });
    }
}
