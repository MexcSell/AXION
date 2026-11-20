/** Sign-in contracts (owner update u1: name + password, admin approves users and devices). */
export type AccountRole = 'admin' | 'member';
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled';
export type DeviceStatus = 'pending' | 'approved' | 'blocked';
export type DeviceKind = 'desktop' | 'laptop' | 'phone' | 'tablet';

export interface AvatarDto { kind: 'initials' | 'image' | 'robot'; hue: number; image?: string; robot?: string }
export interface DeviceDto { id: string; name: string; kind: DeviceKind; browser: string; status: DeviceStatus; addedAt: number; lastSeenAt: number }
export interface AccountDto {
  id: string; name: string; role: AccountRole; status: AccountStatus; avatar: AvatarDto; devices: DeviceDto[];
  createdAt: number; approvedAt?: number; approvedBy?: string; passwordChangedAt?: number;
}
export interface MeDto { account: AccountDto; deviceId: string; csrf: string }

export interface ConnectBody { name: string; password: string; device: { name: string; kind: DeviceKind; browser: string } }
export type ConnectResult =
  | { state: 'signedIn'; me: MeDto }
  | { state: 'waiting'; reason: 'user' | 'device'; name: string; device: { name: string } };

export const NAME_MIN = 2;
export const NAME_MAX = 48;
export const PASSWORD_MIN = 4;
export const NEW_PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
