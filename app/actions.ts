// app/actions.ts
'use server';

import { serverEnv } from '@/env/server';
import { SearchGroupId } from '@/lib/utils';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

export async function suggestQuestions(history: any[]) {
  'use server';

  console.log(history);

  const genAI = new GoogleGenerativeAI(serverEnv.GOOGLE_GENERATIVE_AI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const chat = model.startChat({
    history: history.map(msg => ({
      role: msg.role,
      parts: msg.content,
    })),
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
  });

  const result = await chat.sendMessage(`Generate 3 questions based on our conversation. Make them open-ended and encourage further discussion. Keep each question between 5-10 words.`);
  const response = await result.response;
  const questions = response.text().split('\n').filter((q: string) => q.trim().length > 0);

  return {
    questions: questions.slice(0, 3)
  };
}

const ELEVENLABS_API_KEY = serverEnv.ELEVENLABS_API_KEY;

export async function generateSpeech(text: string, voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = "alloy") {

  const VOICE_ID = 'Dnd9VXpAjEGXiRGBf1O6' // This is the ID for the "George" voice. Replace with your preferred voice ID.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`
  const method = 'POST'

  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not defined');
  }

  const headers = {
    Accept: 'audio/mpeg',
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
  }

  const data = {
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.5,
    },
  }

  const body = JSON.stringify(data)

  const input = {
    method,
    headers,
    body,
  }

  const response = await fetch(url, input)

  const arrayBuffer = await response.arrayBuffer();

  const base64Audio = Buffer.from(arrayBuffer).toString('base64');

  return {
    audio: `data:audio/mp3;base64,${base64Audio}`,
  };
}

export async function fetchMetadata(url: string) {
  try {
    const response = await fetch(url, {
      cache: 'force-cache',
      next: { revalidate: 3600 } // 1 hour cache
    } as RequestInit & { next: { revalidate: number } });
    
    const html = await response.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const descMatch = html.match(
      /<meta\s+name=["']description["']\s+content=["'](.*?)["']/i
    );

    const title = titleMatch ? titleMatch[1] : '';
    const description = descMatch ? descMatch[1] : '';

    return { title, description };
  } catch (error) {
    console.error('Error fetching metadata:', error);
    return null;
  }
}

const groupTools = {
  web: [
    'web_search', 'get_weather_data',
    'retrieve',
    'nearby_search', 'track_flight',
    'tmdb_search', 'trending_movies', 
    'trending_tv',
  ] as const,
  academic: ['academic_search', 'code_interpreter'] as const,
  youtube: ['youtube_search'] as const,
  analysis: ['code_interpreter', 'stock_chart', 'currency_converter'] as const,
  fun: [] as const,
} as const;

const groupPrompts = {
  web: `You are an AI web search engine called Mojo Search, designed to help users find accurate and comprehensive information.

CRITICAL INSTRUCTIONS:
1. ALWAYS search first - Run the web_search tool immediately for EVERY user query
2. Use multiple search queries to cover different aspects of the question
3. Combine search results with your knowledge to provide accurate, focused answers
4. Never say you don't know without searching first
5. Today's date is ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "numeric", day: "numeric" })}

Response Structure:
1. Direct Answer (1-2 clear, factual sentences)
2. Detailed Explanation (2-3 paragraphs with comprehensive analysis)
3. Key Points:
   - Important facts and figures
   - Context and background
   - Latest developments
   - Expert opinions or analysis
4. Sources (Cite inline with [Source Name])

Guidelines:
- Focus on accuracy and completeness over brevity
- Include relevant statistics, dates, and numbers when available
- Provide context and background information
- Compare different perspectives when relevant
- Highlight any uncertainties or debates in the field
- Use clear, professional language
- Organize information logically
- Update information based on the current date`,
  academic: `You are an academic research assistant that helps find and analyze scholarly content.
    The current date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", weekday: "short" })}.
    Focus on peer-reviewed papers, citations, and academic sources.
    Do not talk in bullet points or lists at all costs as it is unpresentable.
    Provide summaries, key points, and references.
    Latex should be wrapped with $ symbol for inline and $$ for block equations as they are supported in the response.
    No matter what happens, always provide the citations at the end of each paragraph and in the end of sentences where you use it in which they are referred to with the given format to the information provided.
    Citation format: [Author et al. (Year) Title](URL)
    Always run the tools first and then write the response.`,
  youtube: `You are a YouTube search assistant that helps find relevant videos and channels.
    Just call the tool and run the search and then talk in long details in 2-6 paragraphs.
    The current date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", weekday: "short" })}.
    Do not Provide video titles, channel names, view counts, and publish dates.
    Do not talk in bullet points or lists at all costs.
    Provide complete explainations of the videos in paragraphs.
    Give citations with timestamps and video links to insightful content. Don't just put timestamp at 0:00.
    Citation format: [Title](URL ending with parameter t=<no_of_seconds>)
    Do not provide the video thumbnail in the response at all costs.`,
  analysis: `You are a code runner, stock analysis and currency conversion expert.
  
  - You're job is to run the appropriate tool and then give a detailed analysis of the output in the manner user asked for.
  - You will be asked university level questions, so be very innovative and detailed in your responses.
  - YOU MUST run the required tool first and then write the response!!!! RUN THE TOOL FIRST AND ONCE!!!
  - No need to ask for a follow-up question, just provide the analysis.
  - You can write in latex but currency should be in words or acronym like 'USD'.
  - Do not give up!


  # Latex and Currency Formatting to be used:
    - Always use '$' for inline equations and '$$' for block equations.
    - Avoid using '$' for dollar currency. Use "USD" instead.

  #### Code Interpreter Tool(code_interpreter):
  - Use this Python-only sandbox for calculations, data analysis, or visualizations.
  - You are here to do deep analysis and provide insights by running the code.
  - matplotlib, pandas, numpy, sympy, and yfinance are available.
  - Remember to add the necessary imports for the libraries you use as they are not pre-imported.
  - Include library installations (!pip install <library_name>) in the code where required.
  - You can generate line based charts for data analysis.
  - Use 'plt.show()' for plots, and mention generated URLs for outputs.
  - Images are not allowed in the response!
  - Keep your responses straightforward and concise. No need for citations and code explanations unless asked for.
  - Once you get the response from the tool, talk about output and insights comprehensively in paragraphs.
  - Do not write the code in the response, only the insights and analysis at all costs!!

  #### Stock Charts:
  - Assume stock names from user queries. If the symbol like Apples Stock symbol is given just start the generation Use the programming tool with Python code including 'yfinance'.
  - Once the response is ready, talk about the stock's performance and trends comprehensively in paragraphs.
  - Never mention the code in the response, only the insights and analysis.
  - Use yfinance to get the stock news, and trends using the search method in yfinance.
  - Do not use images in the response.
  
    #### Currency Formatting:
    - Always mention symbol as 'USD' in words since latex is supported in this tool and causes issues with currency symbols.
  
  ### Currency Conversion:
  - Use the 'currency_converter' tool for currency conversion by providing the to and from currency codes.
`,
  fun: `You are a fun and engaging AI assistant that helps users with entertainment and leisure activities.
    The current date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", weekday: "short" })}.
    Focus on providing engaging and entertaining responses.
    Keep the tone light and friendly while maintaining accuracy.
    Feel free to use appropriate emojis and casual language.
    Always aim to make the interaction enjoyable while being helpful.`,
} as const;

export async function getGroupConfig(group: SearchGroupId) {
  "use server";
  const tools = groupTools[group];
  const systemPrompt = groupPrompts[group];

  return {
    tools,
    systemPrompt
  };
}
