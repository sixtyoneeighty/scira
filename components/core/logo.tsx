import { cn } from '@/lib/utils';
import Image from 'next/image';

interface LogoProps {
  className?: string;
  animate?: boolean;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("relative", className)}>
      <Image 
        src="/images/logo.png"
        alt="Logo"
        width={64}
        height={64}
        className="animate-bounce" 
      />
    </div>
  );
} 