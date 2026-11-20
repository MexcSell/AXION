import { RobotAvatar } from '@/components/art/RobotAvatar';
import { initialsOf, type Account, type AvatarSpec } from '@/store/auth';
import { cx } from '@/lib/format';

/** A human user's avatar: initials on a hue, an uploaded image, or a robot face (Settings › Users). */
export function UserAvatar({ account, avatar, name, size = 36, ring, className }: {
  account?: Pick<Account, 'name' | 'avatar'>; avatar?: AvatarSpec; name?: string; size?: number; ring?: 'good' | 'warn' | 'bad' | 'accent'; className?: string;
}) {
  const av = avatar ?? account?.avatar ?? { kind: 'initials', hue: 220 };
  const nm = name ?? account?.name ?? '?';
  return (
    <span className={cx('uav', ring && 'ring-' + ring, className)} style={{ width: size, height: size, ['--h' as string]: av.hue, fontSize: size * 0.38 }} aria-label={nm} role="img">
      {av.kind === 'image' && av.image ? <img src={av.image} alt="" />
        : av.kind === 'robot' && av.robot ? <RobotAvatar role={av.robot} size={size * 1.05} />
        : <span className="uav-ini">{initialsOf(nm)}</span>}
    </span>
  );
}
