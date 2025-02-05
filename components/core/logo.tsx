import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  animate?: boolean;
}

export function Logo({ className }: LogoProps) {
  return (
    <div className={cn("relative", className)}>
      <img 
        src="/images/logo.png"
        alt="Logo"
        className="w-16 h-16 animate-bounce" 
      />
    </div>
  );
} 