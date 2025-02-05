// /lib/utils.ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Globe, Book, YoutubeIcon, Pen } from 'lucide-react'
import { Brain, Code } from '@phosphor-icons/react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type SearchGroupId = 'web' | 'academic' | 'youtube' | 'analysis' | 'fun';

export const searchGroups = [
  {
    id: 'web' as const,
    name: 'Web',
    description: 'Search across the entire internet',
    icon: Globe,
  },
  {
    id: 'analysis' as const,
    name: 'Analysis',
    description: 'Code, stock and currency stuff',
    icon: Code,
  },
  {
    id: 'fun' as const,
    name: 'Fun',
    description: 'Talk to Mojo like a digital friend',
    icon: Pen,
  },
  {
    id: 'academic' as const,
    name: 'Academic',
    description: 'Search academic papers and research powered by Exa',
    icon: Book,
  },
  {
    id: 'youtube' as const,
    name: 'YouTube',
    description: 'Search YouTube videos in real-time powered by Exa',
    icon: YoutubeIcon,
  },
] as const;

export type SearchGroup = typeof searchGroups[number];
