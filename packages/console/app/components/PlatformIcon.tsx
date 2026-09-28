import Image from 'next/image';

export function PlatformIcon({
  platform,
  className,
}: {
  platform: 'ios' | 'android';
  className?: string;
}) {
  const src = platform === 'ios' ? '/apple.svg' : '/android.svg';
  const alt = platform === 'ios' ? 'iOS' : 'Android';
  return (
    <Image
      src={src}
      alt={alt}
      width={16}
      height={16}
      className={`dark:invert ${platform === 'android' ? 'opacity-60' : ''} ${className ?? ''}`}
    />
  );
}
