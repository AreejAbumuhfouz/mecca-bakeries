import type { Permission } from './permissions.js';
import type { Role } from './roles.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Restaurant accounts only: the customer they order for. */
  customerId: string | null;
  permissions: Permission[];
};

export type AuthTokens = {
  accessToken: string;
  /** Returned in the body for the mobile app; the dashboard also receives it as an httpOnly cookie. */
  refreshToken: string;
  expiresIn: number;
};

export type LoginResult = AuthTokens & { user: AuthUser };
