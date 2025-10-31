/**
 * Model representing a component with too strong permissions
 */
export interface TooStrongPermission {
  path: string;
  details: Array<{
    principal: string;
    acl: string[];
    otherPermissions: string[];
  }>;
}

/**
 * Admin permission model
 */
export interface AdminPermission {
  principal: string;
  details: {
    path: string;
    allow: boolean;
    privileges: string[];
  }[];
}

/**
 * Permission report model
 */
export interface PermissionsReport {
  /** Scan admin permissions results */
  adminChecks: AdminPermission[];
  /** Scan too strong permissions results */
  allPermissions: TooStrongPermission[];
}
