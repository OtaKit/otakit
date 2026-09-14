import Image from 'next/image';

import { founder } from '@/lib/founder';
import { cn } from '@/lib/utils';

export function FounderAvatar({ size, className }: { size: number; className?: string }) {
  return (
    <Image
      src={founder.photo}
      alt={founder.name}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: size, height: size }}
    />
  );
}
